// ---------------------------------------------------------------------------
// HHC (Household Meter Commissioning) domain logic.
//
// All HHM business logic lives here — meter listing, current-state reduction
// from Shengda NB-IoT packets, usage history, communications log, health
// evaluation, and commissioning auto-checks. Route handlers in
// routes/hhc.ts are thin wrappers around these functions.
// ---------------------------------------------------------------------------

import { ewaterFetch } from "./ewater-client";
import {
  tryDecodeShengdaLwm2m,
  buildShengdaCurrentState,
  type ShengdaCurrentState,
  type ShengdaDecodedLogEntry,
  type ShengdaLwm2mDecoded,
} from "./shengda-nbiot-decoder";
import {
  listAssets,
  fetchAllKnownImeis,
  extractImeiFromLogSource,
  paginateArray,
  strOrNull,
  type AssetSummary,
  type Page,
} from "./ewater-insights";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Connectivity tolerance multipliers applied to the meter's own reported
 * report cycle (`/84/0` field 0). A meter is:
 *   healthy  — last valid packet within  cycle × HEALTHY_MULTIPLIER
 *   late     — within                    cycle × OFFLINE_MULTIPLIER
 *   offline  — older than that
 *   unknown  — no report cycle established yet (e.g. new meter being
 *              commissioned) or no packets at all — never classed offline.
 */
export const CONNECTIVITY_HEALTHY_MULTIPLIER = 1.5;
export const CONNECTIVITY_OFFLINE_MULTIPLIER = 3;

/** How far back to scan packets when building current state. */
const STATE_WINDOW_HOURS = 14 * 24;

export type ConnectivityStatus = "healthy" | "late" | "offline" | "unknown";

// ---------------------------------------------------------------------------
// Packet fetching (Shengda-decoded, structured)
// ---------------------------------------------------------------------------

export interface HhcPacket {
  id: string;
  timestamp: string;
  imei: string | null;
  pipeline: string | null;
  protocol: string | null;
  valid: boolean | null;
  messageType: string | null;
  messageFunction: string | null;
  description: string | null;
  /** Null when the payload is not a Shengda LwM2M frame. */
  decoded: ShengdaLwm2mDecoded | null;
}

async function fetchPacketsForImei(imei: string, startDate: Date, endDate: Date): Promise<HhcPacket[]> {
  const result = await ewaterFetch("state", "/api/Logs/GetLogsInDateRangeByImei", {
    method: "POST",
    body: JSON.stringify({
      imei,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    }),
  });
  if (result.status !== 200) return [];

  const raw = result.data as Record<string, unknown>;
  const logLines = Array.isArray(raw?.["logLines"]) ? (raw["logLines"] as Record<string, unknown>[]) : [];

  return logLines.map((entry) => {
    const payload = strOrNull(entry["payload"]);
    const decoded = payload ? tryDecodeShengdaLwm2m(payload) : null;
    return {
      id: String(entry["id"] ?? ""),
      timestamp: strOrNull(entry["timeReceived"]) ?? "",
      imei: extractImeiFromLogSource(strOrNull(entry["source"])) ?? imei,
      pipeline: strOrNull(entry["pipeline"]),
      protocol: strOrNull(entry["protocol"]),
      valid: decoded ? decoded.valid : null,
      messageType: decoded?.messageType ?? null,
      messageFunction: decoded?.messageFunction ?? null,
      description: decoded?.description ?? null,
      decoded,
    };
  });
}

/** Fetches all packets for every IMEI known for the asset, newest first. */
export async function fetchHhcPackets(assetId: string, hours: number): Promise<HhcPacket[]> {
  const imeis = await fetchAllKnownImeis(assetId);
  if (imeis.length === 0) return [];
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - hours * 3600 * 1000);
  const perImei = await Promise.all(imeis.map((imei) => fetchPacketsForImei(imei, startDate, endDate)));
  return perImei
    .flat()
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

// ---------------------------------------------------------------------------
// Meter listing
// ---------------------------------------------------------------------------

export function isHouseholdMeter(asset: AssetSummary): boolean {
  return (asset.type ?? "").toLowerCase() === "householdmeter";
}

export interface HouseholdMeterSummary {
  id: string;
  name: string;
  status: string | null;
  location: string | null;
  waterSystemName: string | null;
  countryName: string | null;
  parentId: number | null;
}

function toMeterSummary(a: AssetSummary): HouseholdMeterSummary {
  return {
    id: a.id,
    name: a.name,
    status: a.status,
    location: a.location,
    waterSystemName: a.waterSystemName,
    countryName: a.countryName,
    parentId: a.parentId,
  };
}

export interface ListHouseholdMetersOptions {
  status?: string;
  waterSystemId?: number;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listHouseholdMeters(
  options: ListHouseholdMetersOptions = {},
): Promise<Page<HouseholdMeterSummary>> {
  const assets = await listAssets();
  let meters = assets.filter(isHouseholdMeter);

  if (options.status) {
    const needle = options.status.toLowerCase();
    meters = meters.filter((m) => (m.status ?? "").toLowerCase() === needle);
  }
  if (options.waterSystemId != null) {
    meters = meters.filter((m) => m.parentId === options.waterSystemId);
  }
  if (options.search) {
    const needle = options.search.toLowerCase();
    meters = meters.filter(
      (m) => m.name.toLowerCase().includes(needle) || m.id.includes(needle),
    );
  }

  meters.sort((a, b) => a.name.localeCompare(b.name));
  const page = paginateArray(meters, options.limit, options.offset);
  return { ...page, items: page.items.map(toMeterSummary) };
}

export async function getHouseholdMeter(assetId: string): Promise<HouseholdMeterSummary | null> {
  const assets = await listAssets();
  const asset = assets.find((a) => a.id === assetId);
  if (!asset || !isHouseholdMeter(asset)) return null;
  return toMeterSummary(asset);
}

// ---------------------------------------------------------------------------
// Current state
// ---------------------------------------------------------------------------

export interface HouseholdMeterState {
  assetId: string;
  meter: HouseholdMeterSummary | null;
  state: ShengdaCurrentState;
  connectivity: ConnectivityEvaluation;
  health: HealthEvaluation;
}

export async function getHouseholdMeterState(assetId: string): Promise<HouseholdMeterState> {
  const [meter, packets] = await Promise.all([
    getHouseholdMeter(assetId),
    fetchHhcPackets(assetId, STATE_WINDOW_HOURS),
  ]);

  const entries: ShengdaDecodedLogEntry[] = packets
    .filter((p): p is HhcPacket & { decoded: ShengdaLwm2mDecoded } => p.decoded != null)
    .map((p) => ({ id: p.id, timestamp: p.timestamp, decoded: p.decoded }));

  const state = buildShengdaCurrentState(entries);
  const connectivity = evaluateConnectivity(state);
  const health = calculateHouseholdMeterHealth(state);

  return { assetId, meter, state, connectivity, health };
}

// ---------------------------------------------------------------------------
// Connectivity health — based on the meter's own reported report cycle,
// NOT a universal 48-hour rule.
// ---------------------------------------------------------------------------

export interface ConnectivityEvaluation {
  status: ConnectivityStatus;
  lastValidPacketAt: string | null;
  reportCycleSeconds: number | null;
  /** Seconds since last valid packet, null when never heard. */
  silenceSeconds: number | null;
  reason: string;
}

export function evaluateConnectivity(state: ShengdaCurrentState, now: Date = new Date()): ConnectivityEvaluation {
  const cycleField = state.reporting["reportCycleSeconds"];
  const reportCycleSeconds = typeof cycleField?.value === "number" ? cycleField.value : null;
  const lastValidPacketAt = state.lastValidPacketAt;
  const silenceSeconds = lastValidPacketAt
    ? Math.max(0, Math.round((now.getTime() - new Date(lastValidPacketAt).getTime()) / 1000))
    : null;

  if (lastValidPacketAt === null) {
    return {
      status: "unknown",
      lastValidPacketAt,
      reportCycleSeconds,
      silenceSeconds,
      reason: "No valid packets received yet",
    };
  }
  if (reportCycleSeconds === null || reportCycleSeconds <= 0) {
    // New-meter commissioning: no established cycle → never classify offline.
    return {
      status: "unknown",
      lastValidPacketAt,
      reportCycleSeconds,
      silenceSeconds,
      reason: "No report cycle established yet — connectivity cannot be classified",
    };
  }

  const silence = silenceSeconds ?? 0;
  if (silence <= reportCycleSeconds * CONNECTIVITY_HEALTHY_MULTIPLIER) {
    return {
      status: "healthy",
      lastValidPacketAt,
      reportCycleSeconds,
      silenceSeconds,
      reason: `Last report within ${CONNECTIVITY_HEALTHY_MULTIPLIER}× the ${reportCycleSeconds}s report cycle`,
    };
  }
  if (silence <= reportCycleSeconds * CONNECTIVITY_OFFLINE_MULTIPLIER) {
    return {
      status: "late",
      lastValidPacketAt,
      reportCycleSeconds,
      silenceSeconds,
      reason: `Last report overdue (between ${CONNECTIVITY_HEALTHY_MULTIPLIER}× and ${CONNECTIVITY_OFFLINE_MULTIPLIER}× the report cycle)`,
    };
  }
  return {
    status: "offline",
    lastValidPacketAt,
    reportCycleSeconds,
    silenceSeconds,
    reason: `No report for more than ${CONNECTIVITY_OFFLINE_MULTIPLIER}× the ${reportCycleSeconds}s report cycle`,
  };
}

// ---------------------------------------------------------------------------
// Health — transparent reason list, no black-box score.
// ---------------------------------------------------------------------------

export type HealthSeverity = "ok" | "warning" | "critical";

export interface HealthReason {
  severity: HealthSeverity;
  code: string;
  message: string;
  observedAt: string | null;
}

export interface HealthEvaluation {
  status: "healthy" | "warning" | "critical" | "unknown";
  reasons: HealthReason[];
}

function fieldVal(section: Record<string, { value: string | number | boolean; observedAt: string } | null>, key: string) {
  const f = section[key];
  return f ? { value: f.value, observedAt: f.observedAt } : null;
}

export function calculateHouseholdMeterHealth(state: ShengdaCurrentState): HealthEvaluation {
  const reasons: HealthReason[] = [];

  if (state.lastValidPacketAt === null) {
    return {
      status: "unknown",
      reasons: [
        { severity: "warning", code: "no-data", message: "No valid packets received — health unknown", observedAt: null },
      ],
    };
  }

  const push = (severity: HealthSeverity, code: string, message: string, observedAt: string | null) =>
    reasons.push({ severity, code, message, observedAt });

  // Alarms
  const alarmChecks: [string, string][] = [
    ["magneticAttack", "Magnetic attack detected"],
    ["antiDemolition", "Anti-demolition (tamper) alarm active"],
    ["leak", "Leak alarm active"],
    ["overflow", "Overflow alarm active"],
    ["reverseFlow", "Reverse flow detected"],
  ];
  for (const [key, message] of alarmChecks) {
    const f = fieldVal(state.alarms, key);
    if (f?.value === true) push("critical", `alarm-${key}`, message, f.observedAt);
  }
  const waterErr = fieldVal(state.alarms, "waterErrorCode");
  if (typeof waterErr?.value === "number" && waterErr.value !== 0) {
    push("warning", "water-error-code", `Water error code ${waterErr.value}`, waterErr.observedAt);
  }

  // Valve
  const valveFailure = fieldVal(state.valve, "failureStatus");
  if (valveFailure && String(valveFailure.value).toLowerCase() === "failure") {
    push("critical", "valve-failure", "Valve failure reported", valveFailure.observedAt);
  }

  // Battery
  const batteryStatus = fieldVal(state.device, "batteryStatus");
  if (batteryStatus) {
    const s = String(batteryStatus.value).toLowerCase();
    if (s.includes("low") || s.includes("damaged")) {
      push("warning", "battery-status", `Battery status: ${batteryStatus.value}`, batteryStatus.observedAt);
    }
  }
  const voltage = fieldVal(state.meter, "batteryVoltage") ?? fieldVal(state.device, "powerSupplyVoltage");
  if (typeof voltage?.value === "number" && voltage.value > 0 && voltage.value < 3.2) {
    push("warning", "low-voltage", `Supply voltage low (${voltage.value.toFixed(2)} V)`, voltage.observedAt);
  }

  // Signal
  const rsrp = fieldVal(state.network, "rsrp");
  if (typeof rsrp?.value === "number" && rsrp.value !== 0 && rsrp.value < -110) {
    push("warning", "weak-signal", `Weak NB-IoT signal (RSRP ${rsrp.value})`, rsrp.observedAt);
  }

  // Prepay balance
  const insufficient = fieldVal(state.alarms, "availableWaterInsufficient");
  if (insufficient?.value === true) {
    push("warning", "prepay-low", "Available water allowance insufficient", insufficient.observedAt);
  }

  // Invalid packets recently
  if (state.invalidPackets.length > 0) {
    push(
      "warning",
      "invalid-packets",
      `${state.invalidPackets.length} packet(s) with invalid CRC in the state window`,
      state.invalidPackets[0]?.timestamp ?? null,
    );
  }

  const status = reasons.some((r) => r.severity === "critical")
    ? "critical"
    : reasons.some((r) => r.severity === "warning")
      ? "warning"
      : "healthy";

  if (reasons.length === 0) {
    push("ok", "all-clear", "No alarms, valve normal, battery and signal within range", state.lastValidPacketAt);
  }

  return { status, reasons };
}

// ---------------------------------------------------------------------------
// Usage history — cumulative meter-reading diffs bucketed over the period.
// Counter resets (negative diff) are marked as discontinuities, never
// emitted as negative consumption.
// ---------------------------------------------------------------------------

export type HistoryPeriod = "24h" | "7d" | "30d" | "90d";

const PERIOD_CONFIG: Record<HistoryPeriod, { hours: number; bucketHours: number }> = {
  "24h": { hours: 24, bucketHours: 1 },
  "7d": { hours: 7 * 24, bucketHours: 24 },
  "30d": { hours: 30 * 24, bucketHours: 24 },
  "90d": { hours: 90 * 24, bucketHours: 24 },
};

export interface HistoryBucket {
  bucketStart: string;
  bucketEnd: string;
  consumptionLitres: number | null;
  /** True when a counter reset (negative diff) fell in this bucket. */
  discontinuity: boolean;
  /** Number of meter readings observed inside the bucket. */
  readingCount: number;
}

export interface HouseholdMeterHistory {
  assetId: string;
  period: HistoryPeriod;
  buckets: HistoryBucket[];
  totalConsumptionLitres: number | null;
  firstReadingLitres: number | null;
  lastReadingLitres: number | null;
  discontinuityCount: number;
}

export async function getHouseholdMeterHistory(
  assetId: string,
  period: HistoryPeriod,
): Promise<HouseholdMeterHistory> {
  const cfg = PERIOD_CONFIG[period];
  const packets = await fetchHhcPackets(assetId, cfg.hours);

  // Oldest-first readings from valid packets that carry a meter reading
  const readings = packets
    .filter((p) => p.decoded?.valid && p.decoded.state.meter.meterReadingLitres != null)
    .map((p) => ({
      time: new Date(p.timestamp).getTime(),
      litres: p.decoded!.state.meter.meterReadingLitres!,
    }))
    .sort((a, b) => a.time - b.time);

  const end = Date.now();
  const start = end - cfg.hours * 3600 * 1000;
  const bucketMs = cfg.bucketHours * 3600 * 1000;
  const bucketCount = Math.ceil((cfg.hours * 3600 * 1000) / bucketMs);

  const buckets: HistoryBucket[] = [];
  let prev: { time: number; litres: number } | null = null;
  let total: number | null = null;
  let discontinuityCount = 0;

  for (let i = 0; i < bucketCount; i++) {
    const bStart = start + i * bucketMs;
    const bEnd = Math.min(bStart + bucketMs, end);
    const inBucket = readings.filter((r) => r.time >= bStart && r.time < bEnd);

    let consumption: number | null = null;
    let discontinuity = false;

    for (const r of inBucket) {
      if (prev !== null) {
        const diff = r.litres - prev.litres;
        if (diff < 0) {
          // Counter reset — mark, don't emit negative consumption.
          discontinuity = true;
          discontinuityCount += 1;
        } else {
          consumption = (consumption ?? 0) + diff;
        }
      }
      prev = r;
    }

    if (consumption !== null) total = (total ?? 0) + consumption;
    buckets.push({
      bucketStart: new Date(bStart).toISOString(),
      bucketEnd: new Date(bEnd).toISOString(),
      consumptionLitres: consumption,
      discontinuity,
      readingCount: inBucket.length,
    });
  }

  return {
    assetId,
    period,
    buckets,
    totalConsumptionLitres: total,
    firstReadingLitres: readings[0]?.litres ?? null,
    lastReadingLitres: readings[readings.length - 1]?.litres ?? null,
    discontinuityCount,
  };
}

// ---------------------------------------------------------------------------
// Communications log
// ---------------------------------------------------------------------------

export interface GetCommunicationsOptions {
  hours?: number;
  validOnly?: boolean;
  messageFunction?: string;
  limit?: number;
  offset?: number;
}

export interface HouseholdMeterCommunication {
  id: string;
  timestamp: string;
  imei: string | null;
  pipeline: string | null;
  protocol: string | null;
  valid: boolean | null;
  messageType: string | null;
  messageFunction: string | null;
  meterReadingLitres: number | null;
  description: string | null;
}

export async function getHouseholdMeterCommunications(
  assetId: string,
  options: GetCommunicationsOptions = {},
): Promise<Page<HouseholdMeterCommunication>> {
  const hours = Math.min(Math.max(options.hours ?? 72, 1), 30 * 24);
  let packets = await fetchHhcPackets(assetId, hours);

  if (options.validOnly) packets = packets.filter((p) => p.valid === true);
  if (options.messageFunction) {
    const needle = options.messageFunction.toLowerCase();
    packets = packets.filter((p) => (p.messageFunction ?? "").toLowerCase().includes(needle));
  }

  const page = paginateArray(packets, options.limit, options.offset);
  return {
    ...page,
    items: page.items.map((p) => ({
      id: p.id,
      timestamp: p.timestamp,
      imei: p.imei,
      pipeline: p.pipeline,
      protocol: p.protocol,
      valid: p.valid,
      messageType: p.messageType,
      messageFunction: p.messageFunction,
      meterReadingLitres: p.decoded?.state.meter.meterReadingLitres ?? null,
      description: p.description,
    })),
  };
}

// ---------------------------------------------------------------------------
// Commissioning checks
// ---------------------------------------------------------------------------

export type CheckStatus = "pass" | "fail" | "unknown";

export interface CommissioningCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  observedAt: string | null;
}

export interface CommissioningStatus {
  assetId: string;
  overall: "ready" | "attention" | "insufficient-data";
  checks: CommissioningCheck[];
  connectivity: ConnectivityEvaluation;
  evaluatedAt: string;
}

export async function evaluateCommissioningChecks(assetId: string): Promise<CommissioningStatus> {
  const { state, connectivity } = await getHouseholdMeterState(assetId);
  const checks: CommissioningCheck[] = [];

  const get = (section: keyof Pick<ShengdaCurrentState, "device" | "meter" | "valve" | "alarms" | "reporting" | "network">, key: string) =>
    fieldVal(state[section], key);

  const add = (id: string, label: string, status: CheckStatus, detail: string, observedAt: string | null = null) =>
    checks.push({ id, label, status, detail, observedAt });

  // 1. Device has reported at all
  if (state.lastValidPacketAt) {
    add("first-report", "Device has reported", "pass", `Last valid packet at ${state.lastValidPacketAt}`, state.lastValidPacketAt);
  } else {
    add("first-report", "Device has reported", "fail", "No valid packets received");
  }

  // 2. Network identity established
  const imei = get("network", "imei");
  const iccid = get("network", "iccid");
  if (imei || iccid) {
    add("network-identity", "Network identity reported (IMEI/ICCID)", "pass",
      [imei ? `IMEI ${imei.value}` : null, iccid ? `ICCID ${iccid.value}` : null].filter(Boolean).join(", "),
      imei?.observedAt ?? iccid?.observedAt ?? null);
  } else {
    add("network-identity", "Network identity reported (IMEI/ICCID)", state.lastValidPacketAt ? "fail" : "unknown", "No IMEI or ICCID observed");
  }

  // 3. Signal quality
  const rsrp = get("network", "rsrp");
  if (typeof rsrp?.value === "number" && rsrp.value !== 0) {
    add("signal", "NB-IoT signal acceptable (RSRP ≥ -110)", rsrp.value >= -110 ? "pass" : "fail", `RSRP ${rsrp.value}`, rsrp.observedAt);
  } else {
    add("signal", "NB-IoT signal acceptable (RSRP ≥ -110)", "unknown", "No RSRP observed");
  }

  // 4. Meter reading present
  const reading = get("meter", "meterReadingLitres");
  if (typeof reading?.value === "number") {
    add("meter-reading", "Meter reading reported", "pass", `${reading.value} L`, reading.observedAt);
  } else {
    add("meter-reading", "Meter reading reported", state.lastValidPacketAt ? "fail" : "unknown", "No meter reading observed");
  }

  // 5. Valve state known and no failure
  const valveStatus = get("valve", "status");
  const valveFailure = get("valve", "failureStatus");
  if (valveStatus) {
    const failed = valveFailure && String(valveFailure.value).toLowerCase() === "failure";
    add("valve", "Valve status reported without failure", failed ? "fail" : "pass",
      `Valve ${valveStatus.value}${failed ? " — failure reported" : ""}`, valveStatus.observedAt);
  } else {
    add("valve", "Valve status reported without failure", "unknown", "No valve status observed");
  }

  // 6. Report cycle configured
  const cycle = get("reporting", "reportCycleSeconds");
  if (typeof cycle?.value === "number" && cycle.value > 0) {
    add("report-cycle", "Report cycle configured", "pass", `${cycle.value} s`, cycle.observedAt);
  } else {
    add("report-cycle", "Report cycle configured", "unknown", "No report cycle observed yet");
  }

  // 7. No active alarms
  const activeAlarms = ["magneticAttack", "antiDemolition", "leak", "overflow", "reverseFlow"]
    .map((k) => ({ k, f: get("alarms", k) }))
    .filter(({ f }) => f?.value === true);
  if (state.lastValidPacketAt === null) {
    add("alarms", "No active alarms", "unknown", "No data");
  } else if (activeAlarms.length > 0) {
    add("alarms", "No active alarms", "fail", `Active: ${activeAlarms.map((a) => a.k).join(", ")}`,
      activeAlarms[0]?.f?.observedAt ?? null);
  } else {
    add("alarms", "No active alarms", "pass", "No alarm flags set", state.lastValidPacketAt);
  }

  // 8. CRC integrity
  if (state.validPacketCount === 0 && state.invalidPackets.length === 0) {
    add("crc", "Packet CRC integrity", "unknown", "No packets to evaluate");
  } else if (state.invalidPackets.length > 0) {
    add("crc", "Packet CRC integrity", "fail",
      `${state.invalidPackets.length} of ${state.validPacketCount + state.invalidPackets.length} packets had invalid CRC`,
      state.invalidPackets[0]?.timestamp ?? null);
  } else {
    add("crc", "Packet CRC integrity", "pass", `All ${state.validPacketCount} packets valid`, state.lastValidPacketAt);
  }

  const anyFail = checks.some((c) => c.status === "fail");
  const anyPass = checks.some((c) => c.status === "pass");
  const overall: CommissioningStatus["overall"] = anyFail ? "attention" : anyPass ? "ready" : "insufficient-data";

  return {
    assetId,
    overall,
    checks,
    connectivity,
    evaluatedAt: new Date().toISOString(),
  };
}

export async function getHouseholdMeterCommissioningStatus(assetId: string): Promise<CommissioningStatus> {
  return evaluateCommissioningChecks(assetId);
}

// ---------------------------------------------------------------------------
// Bounded concurrency helper for per-meter enrichment.
// ---------------------------------------------------------------------------

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}
