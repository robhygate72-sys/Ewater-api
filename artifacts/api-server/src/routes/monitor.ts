import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  assetFavouritesTable,
  pushSubscriptionsTable,
  alertRulesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { sendPush, isPushEnabled } from "../lib/push-client";
import { checkAlerts, getCheckLog } from "../lib/alert-checker";
import { lastCheckAt, CHECK_INTERVAL_MS } from "../lib/check-state";

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

const BulkAddFavouritesBody = z.object({
  assets: z.array(z.object({ assetId: z.string(), assetName: z.string() })).min(1).max(500),
});

router.post("/ewater/favourites/bulk", async (req, res): Promise<void> => {
  const parsed = BulkAddFavouritesBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  for (const asset of parsed.data.assets) {
    await db.insert(assetFavouritesTable).values(asset).onConflictDoUpdate({
      target: assetFavouritesTable.assetId,
      set: { assetName: asset.assetName },
    });
  }
  res.json({ ok: true, count: parsed.data.assets.length });
});

const BulkRemoveFavouritesBody = z.object({
  assetIds: z.array(z.string()).min(1).max(500),
});

router.delete("/ewater/favourites/bulk", async (req, res): Promise<void> => {
  const parsed = BulkRemoveFavouritesBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  await db.delete(assetFavouritesTable).where(inArray(assetFavouritesTable.assetId, parsed.data.assetIds));
  res.json({ ok: true, count: parsed.data.assetIds.length });
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
  priceCheckEnabled: false, targetPrice: 1.5, priceDeviancePercent: 0.5,
  cooldownMinutes: 60,
  sensorRangeMetres1: null as number | null,
  sensorRangeMetres2: null as number | null,
  sensorRangeMetres3: null as number | null,
};

function rowToJson(r: typeof DEFAULT_RULES & { assetId?: string }) {
  return {
    offlineEnabled: r.offlineEnabled, offlineHours: r.offlineHours,
    lowBatteryEnabled: r.lowBatteryEnabled, lowBatteryVoltage: r.lowBatteryVoltage,
    lowTankEnabled: r.lowTankEnabled, lowTankPercent: r.lowTankPercent,
    lowFlowEnabled: r.lowFlowEnabled, lowFlowLitres: r.lowFlowLitres,
    highFlowEnabled: r.highFlowEnabled, highFlowLitres: r.highFlowLitres,
    stuckValveEnabled: r.stuckValveEnabled,
    priceCheckEnabled: r.priceCheckEnabled, targetPrice: r.targetPrice, priceDeviancePercent: r.priceDeviancePercent,
    cooldownMinutes: r.cooldownMinutes,
    sensorRangeMetres1: r.sensorRangeMetres1 ?? null,
    sensorRangeMetres2: r.sensorRangeMetres2 ?? null,
    sensorRangeMetres3: r.sensorRangeMetres3 ?? null,
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
  priceCheckEnabled: z.boolean().optional(),
  targetPrice: z.number().positive().optional(),
  priceDeviancePercent: z.number().min(0).optional(),
  cooldownMinutes: z.number().optional(),
  sensorRangeMetres1: z.number().positive().nullable().optional(),
  sensorRangeMetres2: z.number().positive().nullable().optional(),
  sensorRangeMetres3: z.number().positive().nullable().optional(),
});

const CopyAlertRulesBody = z.object({
  fromAssetId: z.string(),
  toAssetIds: z.array(z.string()).min(1).max(500),
});

router.post("/ewater/alert-rules/copy", async (req, res): Promise<void> => {
  const parsed = CopyAlertRulesBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { fromAssetId, toAssetIds } = parsed.data;
  const sourceRows = await db.select().from(alertRulesTable).where(eq(alertRulesTable.assetId, fromAssetId)).limit(1);
  const rulesToCopy = sourceRows.length > 0 ? rowToJson(sourceRows[0]!) : DEFAULT_RULES;
  for (const toAssetId of toAssetIds) {
    const existing = await db.select({ id: alertRulesTable.id }).from(alertRulesTable).where(eq(alertRulesTable.assetId, toAssetId)).limit(1);
    if (existing.length === 0) {
      await db.insert(alertRulesTable).values({ assetId: toAssetId, ...rulesToCopy });
    } else {
      await db.update(alertRulesTable).set(rulesToCopy).where(eq(alertRulesTable.assetId, toAssetId));
    }
  }
  res.json({ ok: true, count: toAssetIds.length });
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
// Test push notification
// ---------------------------------------------------------------------------

router.post("/ewater/push/test", async (req, res): Promise<void> => {
  try {
    const subscriptions = await db.select().from(pushSubscriptionsTable);
    if (subscriptions.length === 0) {
      res.status(400).json({ error: "No push subscriptions registered on this device yet." });
      return;
    }
    let sent = 0;
    for (const sub of subscriptions) {
      try {
        await sendPush(sub, {
          title: "✅ eWater Test Notification",
          body: "Push notifications are working correctly.",
          tag: "ewater-test",
          url: "/notifications",
        });
        sent++;
      } catch (err: unknown) {
        if ((err as Record<string, unknown>)["expired"]) {
          await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, sub.endpoint));
        } else {
          req.log.error({ err }, "Test push failed");
        }
      }
    }
    res.json({ sent });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Test push error");
    res.status(500).json({ error: msg });
  }
});

// Alert check status (timer + last run)
// ---------------------------------------------------------------------------

router.get("/ewater/alert-check-status", (_req, res): void => {
  const now = Date.now();
  const lastMs = lastCheckAt ? lastCheckAt.getTime() : null;
  const nextMs = lastMs ? lastMs + CHECK_INTERVAL_MS : null;
  res.json({
    lastCheckAt: lastCheckAt ? lastCheckAt.toISOString() : null,
    nextCheckAt: nextMs ? new Date(nextMs).toISOString() : null,
    intervalMs: CHECK_INTERVAL_MS,
    secondsUntilNext: nextMs ? Math.max(0, Math.round((nextMs - now) / 1000)) : null,
  });
});

// Alert check log
// ---------------------------------------------------------------------------

router.get("/ewater/alert-check-log", async (req, res): Promise<void> => {
  try {
    const limit = Math.min(Number(req.query["limit"] ?? 10), 50);
    const runs = await getCheckLog(limit);
    res.json(runs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Failed to fetch check log");
    res.status(500).json({ error: msg });
  }
});

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
