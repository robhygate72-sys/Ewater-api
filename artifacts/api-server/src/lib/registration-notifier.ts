/**
 * Registration Notifier
 *
 * Every `refreshMinutes` (configured in DB, default 30), gathers live
 * registration and water-usage numbers for the configured water systems
 * from the eWater State/Query APIs and POSTs a JSON summary to the
 * configured webhook URL.
 *
 * NOTE (accepted limitation): a tag registered under some third system
 * but whose home tap is in a configured system will be missed, because
 * candidate tag enumeration only covers the configured systems.
 */

import { db } from "@workspace/db";
import { webhookSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  getRegisteredTagIds,
  getTagInfo,
  getHouseholdInfo,
  getAssetsInWaterSystem,
  getLitresDispensedToday,
} from "./ewater-insights";
import { getCredentials } from "./ewater-client";
import { logger } from "./logger";

const KENYA_UTC_OFFSET_MS = 3 * 60 * 60 * 1000; // EAT = UTC+3, no DST — never use tz databases

export interface SystemConfig {
  id: number;
  name: string;
}

export interface SystemResult {
  waterSystemId: number;
  name: string;
  total: number;
  today: number;
  lastWindow: number;
  litresToday: number;
}

/** Parse signUpDt (UTC, naive, mixed precision, optional trailing Z) → UTC epoch ms or null. */
function parseSignUpDt(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const d = new Date(ts.replace(/Z$/, "") + "Z");
  return isNaN(d.getTime()) ? null : d.getTime();
}

/** Format EAT time as HH:MM. */
function formatEatTime(utcMs: number): string {
  const eat = new Date(utcMs + KENYA_UTC_OFFSET_MS);
  return `${String(eat.getUTCHours()).padStart(2, "0")}:${String(eat.getUTCMinutes()).padStart(2, "0")}`;
}

/** Derive EAT calendar date string and Kenya midnight UTC ms from epoch ms. */
function getEatDateInfo(nowUtcMs: number): {
  eatDateStr: string;
  kenyaMidnightUtcMs: number;
} {
  const eat = new Date(nowUtcMs + KENYA_UTC_OFFSET_MS);
  const y = eat.getUTCFullYear();
  const m = eat.getUTCMonth();
  const d = eat.getUTCDate();
  const eatDateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const kenyaMidnightUtcMs = Date.UTC(y, m, d) - KENYA_UTC_OFFSET_MS;
  return { eatDateStr, kenyaMidnightUtcMs };
}

/** Retrieve or create the webhook settings row (id = 1, single-row semantics). */
export async function getOrCreateSettings() {
  const rows = await db
    .select()
    .from(webhookSettingsTable)
    .where(eq(webhookSettingsTable.id, 1))
    .limit(1);
  if (rows.length > 0) return rows[0]!;

  await db.insert(webhookSettingsTable).values({
    id: 1,
    webhookUrl: null,
    enabled: false,
    refreshMinutes: 30,
    systems: [
      { id: 217, name: "Kajire" },
      { id: 218, name: "Sagalla" },
    ],
  });
  const created = await db
    .select()
    .from(webhookSettingsTable)
    .where(eq(webhookSettingsTable.id, 1))
    .limit(1);
  return created[0]!;
}

async function postWebhook(webhookUrl: string, payload: object): Promise<void> {
  const urlObj = new URL(webhookUrl);
  const maskedUrl = `${urlObj.protocol}//${urlObj.hostname}/…`;
  logger.debug({ maskedUrl }, "POSTing to webhook");

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`Webhook returned HTTP ${res.status}`);
  }
}

/**
 * Run one full gather cycle: enumerate tags, attribute to systems, fetch
 * litres. Returns per-system results and the formatted text line.
 */
export async function runGather(
  systems: SystemConfig[],
  refreshMinutes: number,
): Promise<{ results: SystemResult[]; text: string }> {
  const nowUtcMs = Date.now();
  const { eatDateStr, kenyaMidnightUtcMs } = getEatDateInfo(nowUtcMs);
  const windowMs = refreshMinutes * 60_000;
  const configuredSystemIds = new Set(systems.map((s) => s.id));

  // 1. Candidate tags = union of all configured systems' registered tag IDs
  const candidateTagSet = new Set<string>();
  for (const sys of systems) {
    const page = await getRegisteredTagIds(sys.id, 0, 10_000);
    for (const tagId of page.items) candidateTagSet.add(tagId);
  }
  const candidateTags = [...candidateTagSet].sort(); // deterministic string sort

  // 2. Asset → system map
  const assetToSystem = new Map<number, number>();
  for (const sys of systems) {
    const assetIds = await getAssetsInWaterSystem(sys.id);
    for (const assetId of assetIds) assetToSystem.set(assetId, sys.id);
  }

  // 3. Per-system counters
  const counters = new Map<number, { total: number; today: number; lastWindow: number }>();
  for (const sys of systems) counters.set(sys.id, { total: 0, today: 0, lastWindow: 0 });

  // 4. Household cache (many tags share a household — do not refetch)
  const householdCache = new Map<string, Awaited<ReturnType<typeof getHouseholdInfo>>>();

  // 5. Tag loop (sequential; a few hundred calls expected at 30-min cadence)
  for (const tagId of candidateTags) {
    const info = await getTagInfo(tagId);
    if (!info) continue;

    const signUpMs = parseSignUpDt(info.signUpDt);
    if (signUpMs === null) continue; // signUpDt missing or unparseable → skip
    if (!info.householdId) continue; // no household → skip

    let household = householdCache.get(info.householdId);
    if (household === undefined) {
      household = await getHouseholdInfo(info.householdId);
      householdCache.set(info.householdId, household);
    }
    if (!household) continue;

    // Attribution: home tap asset first, then household.systemId as fallback
    let homeSystemId: number | undefined;
    if (household.assetId != null) {
      homeSystemId = assetToSystem.get(household.assetId);
    }
    if (
      homeSystemId === undefined &&
      household.systemId != null &&
      configuredSystemIds.has(household.systemId)
    ) {
      homeSystemId = household.systemId;
    }
    if (homeSystemId === undefined) continue;

    const c = counters.get(homeSystemId);
    if (!c) continue;

    c.total += 1;
    if (signUpMs >= kenyaMidnightUtcMs) c.today += 1;
    if (signUpMs >= nowUtcMs - windowMs) c.lastWindow += 1;
  }

  // 6. Litres per system (Query API)
  const results: SystemResult[] = [];
  for (const sys of systems) {
    const c = counters.get(sys.id) ?? { total: 0, today: 0, lastWindow: 0 };
    const litresToday = await getLitresDispensedToday(sys.id, eatDateStr);
    results.push({
      waterSystemId: sys.id,
      name: sys.name,
      total: c.total,
      today: c.today,
      lastWindow: c.lastWindow,
      litresToday,
    });
  }

  // 7. Summary text (one line per system, in configured order)
  const text = results
    .map(
      (r) =>
        `${r.name}: Total = ${r.total}, ${r.today} today, ${r.lastWindow} in ${refreshMinutes} mins, ${r.litresToday} litres today`,
    )
    .join("\n");

  return { results, text };
}

/**
 * Full gather + webhook POST cycle.
 * Returns the summary text on success.
 * Throws on failure (caller should catch and post error payload).
 */
export async function gatherAndSend(
  webhookUrl: string,
  systems: SystemConfig[],
  refreshMinutes: number,
): Promise<string> {
  const { results, text } = await runGather(systems, refreshMinutes);
  const nowUtcMs = Date.now();
  const eatTime = formatEatTime(nowUtcMs);

  const payload = {
    event: "ewater.registrations.summary",
    title: `eWATER Registrations ${eatTime} EAT`,
    text,
    generatedAt: new Date(nowUtcMs).toISOString(),
    refreshMinutes,
    systems: results,
  };

  await postWebhook(webhookUrl, payload);
  logger.info(`sent: ${text.replace(/\n/g, " | ")}`);
  return text;
}

/**
 * The main tick function invoked by the scheduler.
 * Reads settings fresh from the DB each tick so cadence changes take effect
 * without a server restart.
 */
export async function notifierTick(): Promise<"sent" | "failed" | "skipped"> {
  if (!getCredentials()) {
    logger.warn("Registration notifier: eWater credentials not configured — skipping cycle");
    return "skipped";
  }

  const settings = await getOrCreateSettings();

  if (!settings.enabled) {
    logger.debug("Registration notifier: disabled — skipping");
    return "skipped";
  }

  const webhookUrl = settings.webhookUrl?.trim() ?? "";
  if (!webhookUrl) {
    logger.debug("Registration notifier: no webhook URL — skipping");
    return "skipped";
  }

  const systems = (settings.systems ?? []) as SystemConfig[];
  const refreshMinutes = settings.refreshMinutes ?? 30;

  try {
    await gatherAndSend(webhookUrl, systems, refreshMinutes);
    return "sent";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Registration notifier cycle failed");

    // Best-effort error webhook
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "ewater.registrations.error",
          title: "eWATER Registrations - error",
          text: "Registrations refresh FAILED - see log",
          generatedAt: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      // swallow — best effort only
    }

    throw new Error(message);
  }
}
