import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  assetFavouritesTable,
  pushSubscriptionsTable,
  alertRulesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { sendPush, isPushEnabled } from "../lib/push-client";
import { checkAlerts } from "../lib/alert-checker";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Favourites
// ---------------------------------------------------------------------------

router.get("/ewater/favourites", async (_req, res): Promise<void> => {
  const rows = await db.select().from(assetFavouritesTable).orderBy(assetFavouritesTable.createdAt);
  res.json(rows.map((r) => ({ assetId: r.assetId, assetName: r.assetName, createdAt: r.createdAt.toISOString() })));
});

const AddFavouriteBody = z.object({ assetId: z.string(), assetName: z.string() });

router.post("/ewater/favourites", async (req, res): Promise<void> => {
  const parsed = AddFavouriteBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  await db.insert(assetFavouritesTable).values(parsed.data).onConflictDoUpdate({
    target: assetFavouritesTable.assetId,
    set: { assetName: parsed.data.assetName },
  });
  res.json({ ok: true });
});

router.delete("/ewater/favourites/:assetId", async (req, res): Promise<void> => {
  const { assetId } = req.params;
  await db.delete(assetFavouritesTable).where(eq(assetFavouritesTable.assetId, assetId));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Alert rules — per asset
// ---------------------------------------------------------------------------

const DEFAULT_RULES = {
  offlineEnabled: true, offlineHours: 48,
  lowBatteryEnabled: true, lowBatteryVoltage: 11.5,
  lowTankEnabled: true, lowTankPercent: 20,
  lowFlowEnabled: false, lowFlowLitres: 10,
  highFlowEnabled: false, highFlowLitres: 500,
  stuckValveEnabled: false,
  cooldownMinutes: 60,
};

function rowToJson(r: typeof DEFAULT_RULES & { assetId?: string }) {
  return {
    offlineEnabled: r.offlineEnabled, offlineHours: r.offlineHours,
    lowBatteryEnabled: r.lowBatteryEnabled, lowBatteryVoltage: r.lowBatteryVoltage,
    lowTankEnabled: r.lowTankEnabled, lowTankPercent: r.lowTankPercent,
    lowFlowEnabled: r.lowFlowEnabled, lowFlowLitres: r.lowFlowLitres,
    highFlowEnabled: r.highFlowEnabled, highFlowLitres: r.highFlowLitres,
    stuckValveEnabled: r.stuckValveEnabled,
    cooldownMinutes: r.cooldownMinutes,
  };
}

router.get("/ewater/alert-rules/:assetId", async (req, res): Promise<void> => {
  const { assetId } = req.params;
  const rows = await db.select().from(alertRulesTable).where(eq(alertRulesTable.assetId, assetId)).limit(1);
  res.json(rows.length === 0 ? DEFAULT_RULES : rowToJson(rows[0]!));
});

const AlertRulesBody = z.object({
  offlineEnabled: z.boolean().optional(),
  offlineHours: z.number().optional(),
  lowBatteryEnabled: z.boolean().optional(),
  lowBatteryVoltage: z.number().optional(),
  lowTankEnabled: z.boolean().optional(),
  lowTankPercent: z.number().optional(),
  lowFlowEnabled: z.boolean().optional(),
  lowFlowLitres: z.number().optional(),
  highFlowEnabled: z.boolean().optional(),
  highFlowLitres: z.number().optional(),
  stuckValveEnabled: z.boolean().optional(),
  cooldownMinutes: z.number().optional(),
});

router.put("/ewater/alert-rules/:assetId", async (req, res): Promise<void> => {
  const { assetId } = req.params;
  const parsed = AlertRulesBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const existing = await db.select().from(alertRulesTable).where(eq(alertRulesTable.assetId, assetId)).limit(1);
  if (existing.length === 0) {
    await db.insert(alertRulesTable).values({ assetId, ...parsed.data });
  } else {
    await db.update(alertRulesTable).set(parsed.data).where(eq(alertRulesTable.assetId, assetId));
  }
  const updated = await db.select().from(alertRulesTable).where(eq(alertRulesTable.assetId, assetId)).limit(1);
  res.json(rowToJson(updated[0]!));
});

// ---------------------------------------------------------------------------
// Push subscriptions
// ---------------------------------------------------------------------------

router.get("/ewater/push/vapid-key", (_req, res): void => {
  const publicKey = process.env["VAPID_PUBLIC_KEY"];
  if (!publicKey) { res.status(503).json({ error: "Push not configured" }); return; }
  res.json({ publicKey });
});

const PushSubscribeBody = z.object({
  endpoint: z.string(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

router.post("/ewater/push/subscribe", async (req, res): Promise<void> => {
  const parsed = PushSubscribeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { endpoint, keys } = parsed.data;
  await db.insert(pushSubscriptionsTable)
    .values({ endpoint, p256dh: keys.p256dh, auth: keys.auth })
    .onConflictDoUpdate({ target: pushSubscriptionsTable.endpoint, set: { p256dh: keys.p256dh, auth: keys.auth } });

  if (isPushEnabled()) {
    try {
      await sendPush({ endpoint, p256dh: keys.p256dh, auth: keys.auth }, {
        title: "✅ eWater Alerts Enabled",
        body: "You'll receive push notifications for monitored assets.",
        tag: "welcome",
        url: "/notifications",
      });
    } catch { /* non-fatal */ }
  }
  res.json({ ok: true });
});

const PushUnsubscribeBody = z.object({ endpoint: z.string() });

router.delete("/ewater/push/subscribe", async (req, res): Promise<void> => {
  const parsed = PushUnsubscribeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, parsed.data.endpoint));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Manual alert check
// ---------------------------------------------------------------------------

router.post("/ewater/check-alerts", async (req, res): Promise<void> => {
  try {
    const result = await checkAlerts();
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Alert check failed");
    res.status(500).json({ error: msg });
  }
});

export default router;
