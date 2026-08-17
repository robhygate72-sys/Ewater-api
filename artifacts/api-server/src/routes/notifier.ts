import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { webhookSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  getOrCreateSettings,
  gatherAndSend,
  type SystemConfig,
} from "../lib/registration-notifier";
import {
  lastRunAt,
  lastResult,
  lastError,
} from "../lib/notifier-state";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/notifier/settings
// ---------------------------------------------------------------------------

router.get("/notifier/settings", async (_req, res): Promise<void> => {
  const settings = await getOrCreateSettings();
  res.json({
    webhookUrl: settings.webhookUrl ?? null,
    enabled: settings.enabled,
    refreshMinutes: settings.refreshMinutes,
    systems: settings.systems,
    updatedAt: settings.updatedAt.toISOString(),
    lastRunAt: lastRunAt ? lastRunAt.toISOString() : null,
    lastResult: lastResult ?? null,
    lastError: lastError ?? null,
  });
});

// ---------------------------------------------------------------------------
// PUT /api/notifier/settings
// ---------------------------------------------------------------------------

const SystemConfigSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
});

const NotifierSettingsBody = z.object({
  webhookUrl: z
    .string()
    .refine((v) => v === "" || /^https?:\/\//.test(v), {
      message: "Webhook URL must be an http(s):// URL or empty",
    })
    .optional(),
  enabled: z.boolean().optional(),
  refreshMinutes: z.number().int().min(5).max(1440).optional(),
  systems: z.array(SystemConfigSchema).min(1).optional(),
});

router.put("/notifier/settings", async (req, res): Promise<void> => {
  const parsed = NotifierSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.webhookUrl !== undefined)
    update["webhookUrl"] = parsed.data.webhookUrl || null;
  if (parsed.data.enabled !== undefined) update["enabled"] = parsed.data.enabled;
  if (parsed.data.refreshMinutes !== undefined)
    update["refreshMinutes"] = parsed.data.refreshMinutes;
  if (parsed.data.systems !== undefined) update["systems"] = parsed.data.systems;

  const existing = await db
    .select({ id: webhookSettingsTable.id })
    .from(webhookSettingsTable)
    .where(eq(webhookSettingsTable.id, 1))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(webhookSettingsTable).values({
      id: 1,
      webhookUrl: (update["webhookUrl"] as string | null) ?? null,
      enabled: (update["enabled"] as boolean | undefined) ?? false,
      refreshMinutes: (update["refreshMinutes"] as number | undefined) ?? 30,
      systems: (update["systems"] as SystemConfig[] | undefined) ?? [
        { id: 217, name: "Kajire" },
        { id: 218, name: "Sagalla" },
      ],
    });
  } else {
    await db
      .update(webhookSettingsTable)
      .set(update)
      .where(eq(webhookSettingsTable.id, 1));
  }

  const row = await db
    .select()
    .from(webhookSettingsTable)
    .where(eq(webhookSettingsTable.id, 1))
    .limit(1);

  const r = row[0]!;
  res.json({
    webhookUrl: r.webhookUrl ?? null,
    enabled: r.enabled,
    refreshMinutes: r.refreshMinutes,
    systems: r.systems,
    updatedAt: r.updatedAt.toISOString(),
    lastRunAt: lastRunAt ? lastRunAt.toISOString() : null,
    lastResult: lastResult ?? null,
    lastError: lastError ?? null,
  });
});

// ---------------------------------------------------------------------------
// POST /api/notifier/test
// ---------------------------------------------------------------------------

router.post("/notifier/test", async (req, res): Promise<void> => {
  const settings = await getOrCreateSettings();

  const webhookUrl = settings.webhookUrl?.trim() ?? "";
  if (!webhookUrl) {
    res.status(400).json({ ok: false, error: "No webhook URL configured" });
    return;
  }

  const systems = (settings.systems ?? []) as SystemConfig[];
  const refreshMinutes = settings.refreshMinutes ?? 30;

  try {
    const text = await gatherAndSend(webhookUrl, systems, refreshMinutes);
    res.json({ ok: true, text });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Notifier test failed");
    res.status(500).json({ ok: false, error: message });
  }
});

export default router;
