import { db } from "@workspace/db";
import {
  assetFavouritesTable,
  pushSubscriptionsTable,
  alertRulesTable,
  alertSentLogTable,
} from "@workspace/db";
import { eq, and, gte } from "drizzle-orm";
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

async function fetchTech(assetId: string): Promise<TechStatus | null> {
  try {
    const [techRes, eSenseRes] = await Promise.allSettled([
      ewaterFetch("query", `/api/Asset/AssetConnectivityStatus?assetId=${encodeURIComponent(assetId)}`),
      ewaterFetch("query", `/api/Asset/AssetUsageStatus?assetId=${encodeURIComponent(assetId)}`),
    ]);

    const conn =
      techRes.status === "fulfilled" && techRes.value.status === 200
        ? (techRes.value.data as Record<string, unknown>)
        : null;
    const usage =
      eSenseRes.status === "fulfilled" && eSenseRes.value.status === 200
        ? (eSenseRes.value.data as Record<string, unknown>)
        : null;

    // Also try to get tank height from esense chart
    const chartRes = await ewaterFetch(
      "query",
      `/api/Asset/GetESenseChartDataForAsset?assetId=${encodeURIComponent(assetId)}&startDate=${new Date(Date.now() - 2 * 3600 * 1000).toISOString()}&endDate=${new Date().toISOString()}`
    ).catch(() => null);

    let tankHeightPercent: number | null = null;
    if (chartRes && chartRes.status === 200) {
      const cd = chartRes.data as Record<string, unknown>;
      const readings = Array.isArray(cd["readings"]) ? cd["readings"] as Record<string, unknown>[] : [];
      if (readings.length > 0) {
        const last = readings[readings.length - 1];
        const raw = Number(last?.["waterTank"] ?? last?.["waterTankPercent"] ?? NaN);
        if (!isNaN(raw)) tankHeightPercent = raw;
      }
    }

    return {
      lastCommsDt: conn ? String(conn["lastCommsDt"] ?? "") || null : null,
      batteryVoltage: conn ? (Number(conn["lastKnownVoltage"] ?? NaN) || null) : null,
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

export async function checkAlerts(): Promise<{ checked: number; notified: number }> {
  if (!getCredentials()) return { checked: 0, notified: 0 };

  const [favourites, subscriptions, rulesRows] = await Promise.all([
    db.select().from(assetFavouritesTable),
    db.select().from(pushSubscriptionsTable),
    db.select().from(alertRulesTable).limit(1),
  ]);

  if (favourites.length === 0 || subscriptions.length === 0) {
    return { checked: 0, notified: 0 };
  }

  const rules = rulesRows[0] ?? {
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

  let notified = 0;

  for (const fav of favourites) {
    const tech = await fetchTech(fav.assetId);
    if (!tech) continue;

    const alerts: { type: string; title: string; body: string }[] = [];

    // Offline check
    if (rules.offlineEnabled && tech.lastCommsDt) {
      const hoursAgo = (Date.now() - new Date(tech.lastCommsDt).getTime()) / 3600000;
      if (hoursAgo > rules.offlineHours) {
        alerts.push({
          type: "offline",
          title: `⚠️ Asset Offline: ${fav.assetName}`,
          body: `No communication for ${Math.round(hoursAgo)}h (threshold: ${rules.offlineHours}h)`,
        });
      }
    }

    // Low battery
    if (rules.lowBatteryEnabled && tech.batteryVoltage != null && tech.batteryVoltage < rules.lowBatteryVoltage) {
      alerts.push({
        type: "low_battery",
        title: `🔋 Low Battery: ${fav.assetName}`,
        body: `Battery at ${tech.batteryVoltage.toFixed(2)}V (threshold: ${rules.lowBatteryVoltage}V)`,
      });
    }

    // Low tank
    if (rules.lowTankEnabled && tech.tankHeightPercent != null && tech.tankHeightPercent < rules.lowTankPercent) {
      alerts.push({
        type: "low_tank",
        title: `💧 Low Tank: ${fav.assetName}`,
        body: `Tank at ${tech.tankHeightPercent.toFixed(0)}% (threshold: ${rules.lowTankPercent}%)`,
      });
    }

    // Low daily flow
    if (rules.lowFlowEnabled && tech.litresDispensedToday != null && tech.litresDispensedToday < rules.lowFlowLitres) {
      alerts.push({
        type: "low_flow",
        title: `🌊 Low Flow: ${fav.assetName}`,
        body: `Only ${tech.litresDispensedToday.toFixed(0)}L dispensed today (threshold: ${rules.lowFlowLitres}L)`,
      });
    }

    // High daily flow (anomaly)
    if (rules.highFlowEnabled && tech.litresDispensedToday != null && tech.litresDispensedToday > rules.highFlowLitres) {
      alerts.push({
        type: "high_flow",
        title: `🌊 High Flow Anomaly: ${fav.assetName}`,
        body: `${tech.litresDispensedToday.toFixed(0)}L dispensed today (threshold: ${rules.highFlowLitres}L) — possible leak`,
      });
    }

    // Stuck valve: tap events today = 0 but no offline alert
    if (rules.stuckValveEnabled && tech.tapEventsPerMinuteToday === 0 && tech.litresDispensedToday === 0) {
      alerts.push({
        type: "stuck_valve",
        title: `🔒 Possible Stuck Valve: ${fav.assetName}`,
        body: `Zero tap events and zero flow today`,
      });
    }

    for (const alert of alerts) {
      const inCooldown = await wasCooldownNotified(fav.assetId, alert.type, rules.cooldownMinutes);
      if (inCooldown) continue;

      for (const sub of subscriptions) {
        try {
          await sendPush(sub, {
            title: alert.title,
            body: alert.body,
            tag: `${alert.type}-${fav.assetId}`,
            url: `/assets/${fav.assetId}`,
          });
        } catch (err: unknown) {
          if ((err as Record<string, unknown>)["expired"]) {
            await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, sub.endpoint));
          } else {
            logger.error({ err }, "Failed to send push notification");
          }
        }
      }

      await logNotification(fav.assetId, alert.type);
      notified++;
    }
  }

  return { checked: favourites.length, notified };
}
