import { db } from "@workspace/db";
import {
  assetFavouritesTable,
  pushSubscriptionsTable,
  alertRulesTable,
  alertSentLogTable,
  alertCheckLogTable,
} from "@workspace/db";
import { eq, and, gte, desc, lt } from "drizzle-orm";
import { getCredentials, ewaterFetch } from "./ewater-client";
import { sendPush } from "./push-client";
import { logger } from "./logger";

type TechStatus = {
  lastCommsDt?: string | null;
  batteryVoltage?: number | null;
  litresDispensedToday?: number | null;
  tapEventsPerMinuteToday?: number | null;
  tankHeightPercent?: number | null;
};

const DEFAULT_RULES = {
  offlineEnabled: true,
  offlineHours: 48,
  lowBatteryEnabled: true,
  lowBatteryVoltage: 11.5,
  lowTankEnabled: true,
  lowTankPercent: 20,
  lowFlowEnabled: false,
  lowFlowLitres: 10,
  highFlowEnabled: false,
  highFlowLitres: 500,
  stuckValveEnabled: false,
  cooldownMinutes: 60,
};

async function fetchTech(assetId: string): Promise<TechStatus | null> {
  try {
    const [connRes, powerRes, usageRes, tankRes] = await Promise.allSettled([
      ewaterFetch("query", `/api/Asset/AssetConnectivityStatus?assetId=${encodeURIComponent(assetId)}`),
      ewaterFetch("query", `/api/Asset/AssetPowerStatus?assetId=${encodeURIComponent(assetId)}`),
      ewaterFetch("query", `/api/Asset/AssetUsageStatus?assetId=${encodeURIComponent(assetId)}`),
      ewaterFetch("state", `/api/Asset/GetTankHeightSamplesForAsset?assetId=${encodeURIComponent(assetId)}&numberOfSamples=1`),
    ]);

    const conn =
      connRes.status === "fulfilled" && connRes.value.status === 200
        ? (connRes.value.data as Record<string, unknown>)
        : null;

    const power =
      powerRes.status === "fulfilled" && powerRes.value.status === 200
        ? (powerRes.value.data as Record<string, unknown>)
        : null;

    const usage =
      usageRes.status === "fulfilled" && usageRes.value.status === 200
        ? (usageRes.value.data as Record<string, unknown>)
        : null;

    const tank =
      tankRes.status === "fulfilled" && tankRes.value.status === 200
        ? (tankRes.value.data as Record<string, unknown>)
        : null;

    // Tank height: waterTankAverageLastHour is a 0–1 fraction → convert to %
    let tankHeightPercent: number | null = null;
    if (tank && tank["waterTankConnected"] === true) {
      const raw = Number(tank["waterTankAverageLastHour"] ?? NaN);
      if (!isNaN(raw)) tankHeightPercent = Math.round(raw * 100);
    }

    return {
      lastCommsDt: conn ? String(conn["lastCommsDt"] ?? "") || null : null,
      batteryVoltage: power ? (Number(power["lastKnownVoltage"] ?? NaN) || null) : null,
      litresDispensedToday: usage ? (Number(usage["litresDispensedToday"] ?? NaN) || null) : null,
      tapEventsPerMinuteToday: conn ? (Number(conn["tapEventsPerMinuteToday"] ?? NaN) || null) : null,
      tankHeightPercent,
    };
  } catch {
    return null;
  }
}

async function wasCooldownNotified(
  assetId: string,
  alertType: string,
  cooldownMinutes: number
): Promise<boolean> {
  const since = new Date(Date.now() - cooldownMinutes * 60 * 1000);
  const rows = await db
    .select()
    .from(alertSentLogTable)
    .where(
      and(
        eq(alertSentLogTable.assetId, assetId),
        eq(alertSentLogTable.alertType, alertType),
        gte(alertSentLogTable.sentAt, since)
      )
    )
    .limit(1);
  return rows.length > 0;
}

async function logNotification(assetId: string, alertType: string): Promise<void> {
  await db.insert(alertSentLogTable).values({ assetId, alertType });
}

export type CheckLogEntry = {
  assetId: string;
  assetName: string;
  alertType: string;
  enabled: boolean;
  triggered: boolean;
  notified: boolean;
  detail: string;
};

export type CheckRun = {
  runId: string;
  checkedAt: Date;
  entries: CheckLogEntry[];
};

export async function checkAlerts(): Promise<{ checked: number; notified: number }> {
  if (!getCredentials()) return { checked: 0, notified: 0 };

  const [favourites, subscriptions, allRulesRows] = await Promise.all([
    db.select().from(assetFavouritesTable),
    db.select().from(pushSubscriptionsTable),
    db.select().from(alertRulesTable),
  ]);

  if (favourites.length === 0) return { checked: 0, notified: 0 };

  const rulesMap = new Map(allRulesRows.map((r) => [r.assetId, r]));
  const runId = `run-${Date.now()}`;
  const checkedAt = new Date();

  let notified = 0;
  const logRows: typeof alertCheckLogTable.$inferInsert[] = [];

  for (const fav of favourites) {
    const tech = await fetchTech(fav.assetId);
    if (!tech) {
      logRows.push({
        runId,
        checkedAt,
        assetId: fav.assetId,
        assetName: fav.assetName,
        alertType: "fetch",
        enabled: true,
        triggered: false,
        notified: false,
        detail: "Failed to fetch asset data from eWater API",
      });
      continue;
    }

    const rules = rulesMap.get(fav.assetId) ?? DEFAULT_RULES;
    const alerts: { type: string; title: string; body: string }[] = [];

    // --- offline ---
    if (rules.offlineEnabled) {
      if (tech.lastCommsDt) {
        const hoursAgo = (Date.now() - new Date(tech.lastCommsDt).getTime()) / 3600000;
        const triggered = hoursAgo > rules.offlineHours;
        logRows.push({
          runId, checkedAt,
          assetId: fav.assetId, assetName: fav.assetName,
          alertType: "offline", enabled: true, triggered, notified: false,
          detail: triggered
            ? `FAIL — offline ${Math.round(hoursAgo)}h, threshold ${rules.offlineHours}h`
            : `OK — last comms ${Math.round(hoursAgo)}h ago, threshold ${rules.offlineHours}h`,
        });
        if (triggered) alerts.push({ type: "offline", title: `⚠️ Asset Offline: ${fav.assetName}`, body: `No communication for ${Math.round(hoursAgo)}h (threshold: ${rules.offlineHours}h)` });
      } else {
        logRows.push({ runId, checkedAt, assetId: fav.assetId, assetName: fav.assetName, alertType: "offline", enabled: true, triggered: false, notified: false, detail: "SKIP — no lastCommsDt available" });
      }
    }

    // --- low battery ---
    if (rules.lowBatteryEnabled) {
      if (tech.batteryVoltage != null) {
        const triggered = tech.batteryVoltage < rules.lowBatteryVoltage;
        logRows.push({
          runId, checkedAt,
          assetId: fav.assetId, assetName: fav.assetName,
          alertType: "low_battery", enabled: true, triggered, notified: false,
          detail: triggered
            ? `FAIL — battery ${tech.batteryVoltage.toFixed(2)}V, threshold ${rules.lowBatteryVoltage}V`
            : `OK — battery ${tech.batteryVoltage.toFixed(2)}V, threshold ${rules.lowBatteryVoltage}V`,
        });
        if (triggered) alerts.push({ type: "low_battery", title: `🔋 Low Battery: ${fav.assetName}`, body: `Battery at ${tech.batteryVoltage.toFixed(2)}V (threshold: ${rules.lowBatteryVoltage}V)` });
      } else {
        logRows.push({ runId, checkedAt, assetId: fav.assetId, assetName: fav.assetName, alertType: "low_battery", enabled: true, triggered: false, notified: false, detail: "SKIP — no battery voltage available" });
      }
    }

    // --- low tank ---
    if (rules.lowTankEnabled) {
      if (tech.tankHeightPercent != null) {
        const triggered = tech.tankHeightPercent < rules.lowTankPercent;
        logRows.push({
          runId, checkedAt,
          assetId: fav.assetId, assetName: fav.assetName,
          alertType: "low_tank", enabled: true, triggered, notified: false,
          detail: triggered
            ? `FAIL — tank ${tech.tankHeightPercent.toFixed(0)}%, threshold ${rules.lowTankPercent}%`
            : `OK — tank ${tech.tankHeightPercent.toFixed(0)}%, threshold ${rules.lowTankPercent}%`,
        });
        if (triggered) alerts.push({ type: "low_tank", title: `💧 Low Tank: ${fav.assetName}`, body: `Tank at ${tech.tankHeightPercent.toFixed(0)}% (threshold: ${rules.lowTankPercent}%)` });
      } else {
        logRows.push({ runId, checkedAt, assetId: fav.assetId, assetName: fav.assetName, alertType: "low_tank", enabled: true, triggered: false, notified: false, detail: "SKIP — no tank height available" });
      }
    }

    // --- low flow ---
    if (rules.lowFlowEnabled) {
      if (tech.litresDispensedToday != null) {
        const triggered = tech.litresDispensedToday < rules.lowFlowLitres;
        logRows.push({
          runId, checkedAt,
          assetId: fav.assetId, assetName: fav.assetName,
          alertType: "low_flow", enabled: true, triggered, notified: false,
          detail: triggered
            ? `FAIL — ${tech.litresDispensedToday.toFixed(0)}L today, threshold ${rules.lowFlowLitres}L`
            : `OK — ${tech.litresDispensedToday.toFixed(0)}L today, threshold ${rules.lowFlowLitres}L`,
        });
        if (triggered) alerts.push({ type: "low_flow", title: `🌊 Low Flow: ${fav.assetName}`, body: `Only ${tech.litresDispensedToday.toFixed(0)}L dispensed today (threshold: ${rules.lowFlowLitres}L)` });
      } else {
        logRows.push({ runId, checkedAt, assetId: fav.assetId, assetName: fav.assetName, alertType: "low_flow", enabled: true, triggered: false, notified: false, detail: "SKIP — no flow data available" });
      }
    }

    // --- high flow ---
    if (rules.highFlowEnabled) {
      if (tech.litresDispensedToday != null) {
        const triggered = tech.litresDispensedToday > rules.highFlowLitres;
        logRows.push({
          runId, checkedAt,
          assetId: fav.assetId, assetName: fav.assetName,
          alertType: "high_flow", enabled: true, triggered, notified: false,
          detail: triggered
            ? `FAIL — ${tech.litresDispensedToday.toFixed(0)}L today, threshold ${rules.highFlowLitres}L`
            : `OK — ${tech.litresDispensedToday.toFixed(0)}L today, threshold ${rules.highFlowLitres}L`,
        });
        if (triggered) alerts.push({ type: "high_flow", title: `🌊 High Flow: ${fav.assetName}`, body: `${tech.litresDispensedToday.toFixed(0)}L today (threshold: ${rules.highFlowLitres}L) — possible leak` });
      } else {
        logRows.push({ runId, checkedAt, assetId: fav.assetId, assetName: fav.assetName, alertType: "high_flow", enabled: true, triggered: false, notified: false, detail: "SKIP — no flow data available" });
      }
    }

    // --- stuck valve ---
    if (rules.stuckValveEnabled) {
      const triggered = tech.tapEventsPerMinuteToday === 0 && tech.litresDispensedToday === 0;
      logRows.push({
        runId, checkedAt,
        assetId: fav.assetId, assetName: fav.assetName,
        alertType: "stuck_valve", enabled: true, triggered, notified: false,
        detail: triggered ? "FAIL — zero tap events and zero flow today" : "OK — tap events or flow present",
      });
      if (triggered) alerts.push({ type: "stuck_valve", title: `🔒 Possible Stuck Valve: ${fav.assetName}`, body: "Zero tap events and zero flow today" });
    }

    // --- send alerts and update notified flag ---
    for (const alert of alerts) {
      const inCooldown = await wasCooldownNotified(fav.assetId, alert.type, rules.cooldownMinutes);
      const row = logRows.find(r => r.runId === runId && r.assetId === fav.assetId && r.alertType === alert.type);

      if (inCooldown) {
        if (row) row.detail += ` (cooldown active — suppressed)`;
        continue;
      }

      let didNotify = false;
      if (subscriptions.length > 0) {
        for (const sub of subscriptions) {
          try {
            await sendPush(sub, {
              title: alert.title,
              body: alert.body,
              tag: `${alert.type}-${fav.assetId}`,
              url: `/assets/${fav.assetId}`,
            });
            didNotify = true;
          } catch (err: unknown) {
            if ((err as Record<string, unknown>)["expired"]) {
              await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, sub.endpoint));
            } else {
              logger.error({ err }, "Failed to send push notification");
            }
          }
        }
      } else {
        if (row) row.detail += ` (no push subscribers)`;
      }

      if (didNotify) {
        if (row) row.notified = true;
        await logNotification(fav.assetId, alert.type);
        notified++;
      }
    }
  }

  // Persist log rows
  if (logRows.length > 0) {
    await db.insert(alertCheckLogTable).values(logRows);
  }

  // Prune old log entries (keep last 7 days)
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  await db.delete(alertCheckLogTable).where(lt(alertCheckLogTable.checkedAt, cutoff));

  return { checked: favourites.length, notified };
}

export async function getCheckLog(limit = 10): Promise<CheckRun[]> {
  const rows = await db
    .select()
    .from(alertCheckLogTable)
    .orderBy(desc(alertCheckLogTable.checkedAt), desc(alertCheckLogTable.id))
    .limit(limit * 20);

  const byRun = new Map<string, CheckRun>();
  for (const row of rows) {
    if (!byRun.has(row.runId)) {
      byRun.set(row.runId, { runId: row.runId, checkedAt: row.checkedAt, entries: [] });
    }
    byRun.get(row.runId)!.entries.push({
      assetId: row.assetId,
      assetName: row.assetName,
      alertType: row.alertType,
      enabled: row.enabled,
      triggered: row.triggered,
      notified: row.notified,
      detail: row.detail,
    });
  }

  return Array.from(byRun.values()).slice(0, limit);
}
