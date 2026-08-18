// ---------------------------------------------------------------------------
// HHC commissioning workflow — persisted sessions, three-gate QC checklist,
// auto-check engine (computed from live Shengda data, never from operator
// ticks), the three-communication commissioning test, RTC drift check,
// Gate 3 sampling, blockers, approval + authorised override, and the global
// HHC configuration.
//
// Route handlers in routes/hhc.ts are thin wrappers around these functions.
// ---------------------------------------------------------------------------

import { desc, eq, sql } from "drizzle-orm";
import {
  db,
  hhcCommissioningSessionsTable,
  hhcQcResultsTable,
  hhcConfigurationTable,
  hhcActionAuditTable,
  type HhcCommissioningSessionRow,
  type HhcConfigurationRow,
} from "@workspace/db";
import {
  fetchHhcPackets,
  evaluateConnectivity,
  type HhcPacket,
  type ConnectivityEvaluation,
} from "./hhc-insights";
import {
  buildShengdaCurrentState,
  type ShengdaCurrentState,
  type ShengdaDecodedLogEntry,
} from "./shengda-nbiot-decoder";

const STATE_WINDOW_HOURS = 14 * 24;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface HhcConfiguration {
  batteryCriticalVoltage: number;
  batteryWarningVoltage: number;
  gate3SamplePct: number;
  rtcToleranceSeconds: number | null;
  requiredOverdraftLitres: number;
  tariffKesPer1000L: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

function toConfig(row: HhcConfigurationRow): HhcConfiguration {
  return {
    batteryCriticalVoltage: row.batteryCriticalVoltage,
    batteryWarningVoltage: row.batteryWarningVoltage,
    gate3SamplePct: row.gate3SamplePct,
    rtcToleranceSeconds: row.rtcToleranceSeconds,
    requiredOverdraftLitres: row.requiredOverdraftLitres,
    tariffKesPer1000L: row.tariffKesPer1000L,
    updatedAt: row.updatedAt?.toISOString() ?? null,
    updatedBy: row.updatedBy,
  };
}

const CONFIG_ID = 1 as const;

/**
 * Returns the singleton configuration row.
 *
 * Uses INSERT … ON CONFLICT DO UPDATE to guarantee exactly one row even under
 * concurrent first-access — the upsert is idempotent because id is always 1.
 */
export async function getHhcConfiguration(): Promise<HhcConfiguration> {
  const rows = await db
    .insert(hhcConfigurationTable)
    .values({ id: CONFIG_ID })
    .onConflictDoUpdate({
      target: hhcConfigurationTable.id,
      set: { id: sql`excluded.id` }, // no-op update keeps existing values
    })
    .returning();
  return toConfig(rows[0]!);
}

export interface HhcConfigurationUpdate {
  batteryCriticalVoltage?: number;
  batteryWarningVoltage?: number;
  gate3SamplePct?: number;
  rtcToleranceSeconds?: number | null;
  requiredOverdraftLitres?: number;
  tariffKesPer1000L?: number;
}

export async function updateHhcConfiguration(
  update: HhcConfigurationUpdate,
  operator: string,
): Promise<HhcConfiguration> {
  // Upsert ensures the row exists; then immediately update the stable id = 1 row.
  await getHhcConfiguration();
  const updated = await db
    .update(hhcConfigurationTable)
    .set({ ...update, updatedBy: operator })
    .where(eq(hhcConfigurationTable.id, CONFIG_ID))
    .returning();
  await recordAudit(null, "config-update", operator, null, update as Record<string, unknown>);
  return toConfig(updated[0]!);
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export async function recordAudit(
  assetId: string | null,
  action: string,
  operator: string,
  reason: string | null,
  detail: Record<string, unknown> | null,
): Promise<void> {
  await db.insert(hhcActionAuditTable).values({ assetId, action, operator, reason, detail });
}

export interface HhcActionAuditEntry {
  id: number;
  assetId: string | null;
  action: string;
  operator: string;
  reason: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export async function listAudit(assetId: string, limit = 50): Promise<HhcActionAuditEntry[]> {
  const rows = await db
    .select()
    .from(hhcActionAuditTable)
    .where(eq(hhcActionAuditTable.assetId, assetId))
    .orderBy(desc(hhcActionAuditTable.createdAt), desc(hhcActionAuditTable.id))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map((r) => ({
    id: r.id,
    assetId: r.assetId,
    action: r.action,
    operator: r.operator,
    reason: r.reason,
    detail: (r.detail as Record<string, unknown> | null) ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export type CommissioningStage = "gate1" | "gate2" | "gate3" | "approved";
export const STAGES: CommissioningStage[] = ["gate1", "gate2", "gate3", "approved"];

export interface CommissioningSession {
  assetId: string;
  stage: CommissioningStage;
  commissioningTestStartedAt: string | null;
  batchSize: number | null;
  approvedAt: string | null;
  approvedBy: string | null;
  overrideReason: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
}

function toSession(row: HhcCommissioningSessionRow): CommissioningSession {
  return {
    assetId: row.assetId,
    stage: (STAGES.includes(row.stage as CommissioningStage) ? row.stage : "gate1") as CommissioningStage,
    commissioningTestStartedAt: row.commissioningTestStartedAt?.toISOString() ?? null,
    batchSize: row.batchSize,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    approvedBy: row.approvedBy,
    overrideReason: row.overrideReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

/** Fetches (creating on first access) the commissioning session for a meter. */
async function getOrCreateSessionRow(assetId: string): Promise<HhcCommissioningSessionRow> {
  const rows = await db
    .select()
    .from(hhcCommissioningSessionsTable)
    .where(eq(hhcCommissioningSessionsTable.assetId, assetId))
    .limit(1);
  if (rows.length > 0) return rows[0]!;
  const inserted = await db
    .insert(hhcCommissioningSessionsTable)
    .values({ assetId })
    .onConflictDoNothing()
    .returning();
  if (inserted.length > 0) return inserted[0]!;
  const again = await db
    .select()
    .from(hhcCommissioningSessionsTable)
    .where(eq(hhcCommissioningSessionsTable.assetId, assetId))
    .limit(1);
  return again[0]!;
}

// ---------------------------------------------------------------------------
// Check catalogue — the three-gate model.
// ---------------------------------------------------------------------------

export type QcSource = "AUTO" | "MANUAL";
export type QcResultState = "PASS" | "FAIL" | "PENDING";

export interface QcCheckDef {
  code: string;
  gate: 1 | 2 | 3;
  source: QcSource;
  label: string;
  mandatory: boolean;
}

export const QC_CHECKS: QcCheckDef[] = [
  // Gate 1 — Manufacturer QC
  { code: "g1-device-identity", gate: 1, source: "AUTO", label: "Device identity reported (manufacturer, model, serial)", mandatory: true },
  { code: "g1-visual-inspection", gate: 1, source: "MANUAL", label: "Visual inspection — housing, seals, display intact", mandatory: true },
  { code: "g1-factory-calibration", gate: 1, source: "MANUAL", label: "Factory calibration certificate verified", mandatory: true },
  // Gate 2 — Gearbox bench test
  { code: "g2-battery-voltage", gate: 2, source: "AUTO", label: "Battery voltage above warning threshold", mandatory: true },
  { code: "g2-signal", gate: 2, source: "AUTO", label: "NB-IoT signal acceptable (RSRP ≥ -110)", mandatory: true },
  { code: "g2-meter-reading", gate: 2, source: "AUTO", label: "Meter reading reported", mandatory: true },
  { code: "g2-valve", gate: 2, source: "AUTO", label: "Valve status reported without failure", mandatory: true },
  { code: "g2-crc", gate: 2, source: "AUTO", label: "Packet CRC integrity", mandatory: true },
  { code: "g2-bench-flow-test", gate: 2, source: "MANUAL", label: "Bench flow test within tolerance", mandatory: true },
  { code: "g2-modem-iccid", gate: 2, source: "MANUAL", label: "Modem ICCID recorded in Pulse parts inventory", mandatory: false },
  // Gate 3 — eWATER Kenya acceptance
  { code: "g3-three-comms", gate: 3, source: "AUTO", label: "Three-communication commissioning test", mandatory: true },
  { code: "g3-rtc-drift", gate: 3, source: "AUTO", label: "Device RTC within configured drift tolerance", mandatory: true },
  { code: "g3-alarms", gate: 3, source: "AUTO", label: "No active alarms", mandatory: true },
  { code: "g3-report-cycle", gate: 3, source: "AUTO", label: "Report cycle configured", mandatory: false },
  { code: "g3-field-acceptance", gate: 3, source: "MANUAL", label: "Field installation acceptance (eWATER Kenya)", mandatory: true },
];

const AUTO_CODES = new Set(QC_CHECKS.filter((c) => c.source === "AUTO").map((c) => c.code));
export function isAutoCheckCode(code: string): boolean {
  return AUTO_CODES.has(code);
}
export function findCheckDef(code: string): QcCheckDef | undefined {
  return QC_CHECKS.find((c) => c.code === code);
}

// ---------------------------------------------------------------------------
// QC result shape returned by the API
// ---------------------------------------------------------------------------

export interface QcEvidence {
  /** Machine-readable source reference, e.g. "Shengda /80/0 field 37". */
  sourceField?: string;
  observedValue?: string | number | boolean | null;
  expectedValue?: string | number | boolean | null;
  observedAt?: string | null;
  packetId?: string | null;
  imei?: string | null;
  receivedAt?: string | null;
  [key: string]: unknown;
}

export interface QcResult {
  checkCode: string;
  gate: number;
  source: QcSource;
  label: string;
  mandatory: boolean;
  result: QcResultState;
  detail: string;
  evidence: QcEvidence | null;
  operator: string | null;
  recordedAt: string | null;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Auto-check engine
// ---------------------------------------------------------------------------

interface PacketContext {
  packets: HhcPacket[];
  state: ShengdaCurrentState;
}

/**
 * Finds the newest valid packet whose decoded state carried the given
 * predicate — used to attach packet-level provenance to evidence.
 */
function newestValidPacket(packets: HhcPacket[]): HhcPacket | null {
  return packets.find((p) => p.valid === true) ?? null;
}

function fieldObs(
  section: Record<string, { value: string | number | boolean; observedAt: string } | null>,
  key: string,
): { value: string | number | boolean; observedAt: string } | null {
  return section[key] ?? null;
}

/** Locates the packet that produced an observation timestamp (best effort). */
function packetAt(packets: HhcPacket[], observedAt: string | null): HhcPacket | null {
  if (!observedAt) return null;
  return packets.find((p) => p.valid === true && p.timestamp === observedAt) ?? null;
}

function evidenceFor(
  ctx: PacketContext,
  sourceField: string,
  obs: { value: string | number | boolean; observedAt: string } | null,
  expectedValue: string | number | boolean | null,
): QcEvidence {
  const pkt = packetAt(ctx.packets, obs?.observedAt ?? null) ?? newestValidPacket(ctx.packets);
  return {
    sourceField,
    observedValue: obs?.value ?? null,
    expectedValue,
    observedAt: obs?.observedAt ?? null,
    packetId: pkt?.id ?? null,
    imei: pkt?.imei ?? null,
    receivedAt: pkt?.timestamp ?? null,
  };
}

export interface CommsDelivery {
  packetId: string;
  receivedAt: string;
  deviceTime: string | null;
  crcValid: boolean;
  counted: boolean;
}

export interface CommsTestStatus {
  startedAt: string | null;
  requiredCount: number;
  validCount: number;
  deliveries: CommsDelivery[];
}

export const COMMS_TEST_REQUIRED = 3;

export function evaluateCommsTest(packets: HhcPacket[], startedAt: string | null): CommsTestStatus {
  if (!startedAt) return { startedAt: null, requiredCount: COMMS_TEST_REQUIRED, validCount: 0, deliveries: [] };
  const startMs = new Date(startedAt).getTime();
  const after = packets.filter((p) => new Date(p.timestamp).getTime() >= startMs && p.decoded != null);
  const deliveries: CommsDelivery[] = after
    .map((p) => ({
      packetId: p.id,
      receivedAt: p.timestamp,
      deviceTime: p.decoded?.state.device.rtcTime ?? null,
      crcValid: p.valid === true,
      counted: p.valid === true,
    }))
    .sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());
  return {
    startedAt,
    requiredCount: COMMS_TEST_REQUIRED,
    validCount: deliveries.filter((d) => d.counted).length,
    deliveries,
  };
}

export interface RtcDriftStatus {
  deviceTime: string | null;
  serverReceivedAt: string | null;
  driftSeconds: number | null;
  toleranceSeconds: number | null;
  packetId: string | null;
}

export function evaluateRtcDrift(packets: HhcPacket[], toleranceSeconds: number | null): RtcDriftStatus {
  const pkt = packets.find((p) => p.valid === true && p.decoded?.state.device.rtcTime != null) ?? null;
  if (!pkt) {
    return { deviceTime: null, serverReceivedAt: null, driftSeconds: null, toleranceSeconds, packetId: null };
  }
  const deviceTime = pkt.decoded!.state.device.rtcTime!;
  const drift = Math.round(
    Math.abs(new Date(pkt.timestamp).getTime() - new Date(deviceTime).getTime()) / 1000,
  );
  return {
    deviceTime,
    serverReceivedAt: pkt.timestamp,
    driftSeconds: drift,
    toleranceSeconds,
    packetId: pkt.id,
  };
}

function autoResult(
  def: QcCheckDef,
  ctx: PacketContext,
  config: HhcConfiguration,
  commsTest: CommsTestStatus,
  rtcDrift: RtcDriftStatus,
): QcResult {
  const base = {
    checkCode: def.code,
    gate: def.gate,
    source: def.source,
    label: def.label,
    mandatory: def.mandatory,
    operator: null,
    recordedAt: null,
    notes: null,
  };
  const noData = ctx.state.lastValidPacketAt === null;

  const make = (result: QcResultState, detail: string, evidence: QcEvidence | null): QcResult => ({
    ...base,
    result,
    detail,
    evidence,
  });

  switch (def.code) {
    case "g1-device-identity": {
      const man = fieldObs(ctx.state.device, "manufacturer");
      const model = fieldObs(ctx.state.device, "model");
      const serial = fieldObs(ctx.state.device, "serialNumber");
      // All three identity fields are required — a partial identity must not
      // clear this mandatory Gate 1 check.
      const identity = JSON.stringify({ manufacturer: man?.value ?? null, model: model?.value ?? null, serial: serial?.value ?? null });
      const newestObs = [man, model, serial].filter((f): f is NonNullable<typeof f> => f != null).sort((a, b) => (a.observedAt < b.observedAt ? 1 : -1))[0] ?? null;
      const idObs = newestObs ? { value: identity, observedAt: newestObs.observedAt } : null;
      if (man && model && serial) {
        return make(
          "PASS",
          `manufacturer ${man.value}, model ${model.value}, serial ${serial.value}`,
          evidenceFor(ctx, "Shengda /3/0 fields 0/1/2", idObs, "manufacturer + model + serial all present"),
        );
      }
      const missing = [!man && "manufacturer", !model && "model", !serial && "serial"].filter(Boolean).join(", ");
      return make(
        noData ? "PENDING" : "FAIL",
        noData ? "No valid packets received yet" : `Incomplete device identity — missing: ${missing}`,
        evidenceFor(ctx, "Shengda /3/0 fields 0/1/2", idObs, "manufacturer + model + serial all present"),
      );
    }
    case "g2-battery-voltage": {
      const v = fieldObs(ctx.state.meter, "batteryVoltage") ?? fieldObs(ctx.state.device, "powerSupplyVoltage");
      if (typeof v?.value === "number" && v.value > 0) {
        const ok = v.value >= config.batteryWarningVoltage;
        return make(
          ok ? "PASS" : "FAIL",
          `${v.value.toFixed(2)} V (warning < ${config.batteryWarningVoltage} V, critical < ${config.batteryCriticalVoltage} V)`,
          evidenceFor(ctx, "Shengda /80/0 field 37", v, `>= ${config.batteryWarningVoltage}`),
        );
      }
      return make("PENDING", "No battery voltage observed", evidenceFor(ctx, "Shengda /80/0 field 37", null, `>= ${config.batteryWarningVoltage}`));
    }
    case "g2-signal": {
      const rsrp = fieldObs(ctx.state.network, "rsrp");
      if (typeof rsrp?.value === "number" && rsrp.value !== 0) {
        return make(rsrp.value >= -110 ? "PASS" : "FAIL", `RSRP ${rsrp.value}`, evidenceFor(ctx, "Shengda /99/0 field 11", rsrp, ">= -110"));
      }
      return make("PENDING", "No RSRP observed", evidenceFor(ctx, "Shengda /99/0 field 11", null, ">= -110"));
    }
    case "g2-meter-reading": {
      const r = fieldObs(ctx.state.meter, "meterReadingLitres");
      if (typeof r?.value === "number") {
        return make("PASS", `${r.value} L`, evidenceFor(ctx, "Shengda /80/0 field 16", r, "numeric reading present"));
      }
      return make(noData ? "PENDING" : "FAIL", "No meter reading observed", evidenceFor(ctx, "Shengda /80/0 field 16", null, "numeric reading present"));
    }
    case "g2-valve": {
      const status = fieldObs(ctx.state.valve, "status");
      const failure = fieldObs(ctx.state.valve, "failureStatus");
      if (status) {
        const failed = failure != null && String(failure.value).toLowerCase() === "failure";
        return make(failed ? "FAIL" : "PASS", `Valve ${status.value}${failed ? " — failure reported" : ""}`, evidenceFor(ctx, "Shengda /81/0 fields 1/2", status, "no failure"));
      }
      return make("PENDING", "No valve status observed", evidenceFor(ctx, "Shengda /81/0 fields 1/2", null, "no failure"));
    }
    case "g2-crc": {
      const total = ctx.state.validPacketCount + ctx.state.invalidPackets.length;
      if (total === 0) return make("PENDING", "No packets to evaluate", null);
      if (ctx.state.invalidPackets.length > 0) {
        return make("FAIL", `${ctx.state.invalidPackets.length} of ${total} packets had invalid CRC`, {
          sourceField: "Shengda frame CRC-16/AUG-CCITT",
          observedValue: ctx.state.invalidPackets.length,
          expectedValue: 0,
          observedAt: ctx.state.invalidPackets[0]?.timestamp ?? null,
          packetId: ctx.state.invalidPackets[0]?.id ?? null,
          imei: null,
          receivedAt: ctx.state.invalidPackets[0]?.timestamp ?? null,
        });
      }
      return make("PASS", `All ${total} packets valid`, {
        sourceField: "Shengda frame CRC-16/AUG-CCITT",
        observedValue: 0,
        expectedValue: 0,
        observedAt: ctx.state.lastValidPacketAt,
        packetId: newestValidPacket(ctx.packets)?.id ?? null,
        imei: newestValidPacket(ctx.packets)?.imei ?? null,
        receivedAt: ctx.state.lastValidPacketAt,
      });
    }
    case "g3-three-comms": {
      if (!commsTest.startedAt) return make("PENDING", "Commissioning test not started", null);
      const ok = commsTest.validCount >= commsTest.requiredCount;
      return make(ok ? "PASS" : "PENDING", `${commsTest.validCount} of ${commsTest.requiredCount} valid reports received since test start`, {
        sourceField: "Valid Shengda device reports after commissioningTestStartedAt",
        observedValue: commsTest.validCount,
        expectedValue: commsTest.requiredCount,
        observedAt: commsTest.deliveries.filter((d) => d.counted).at(-1)?.receivedAt ?? null,
        packetId: commsTest.deliveries.filter((d) => d.counted).at(-1)?.packetId ?? null,
        imei: null,
        receivedAt: commsTest.deliveries.filter((d) => d.counted).at(-1)?.receivedAt ?? null,
        startedAt: commsTest.startedAt,
      });
    }
    case "g3-rtc-drift": {
      if (rtcDrift.driftSeconds === null) return make("PENDING", "No device time (/3/0 field 13) observed yet", null);
      const evidence: QcEvidence = {
        sourceField: "Shengda /3/0 field 13",
        observedValue: rtcDrift.deviceTime,
        expectedValue: rtcDrift.serverReceivedAt,
        observedAt: rtcDrift.serverReceivedAt,
        packetId: rtcDrift.packetId,
        imei: null,
        receivedAt: rtcDrift.serverReceivedAt,
        driftSeconds: rtcDrift.driftSeconds,
        toleranceSeconds: rtcDrift.toleranceSeconds,
      };
      if (rtcDrift.toleranceSeconds == null) {
        // Never auto-pass with an unconfigured tolerance.
        return make("PENDING", `Measured drift ${rtcDrift.driftSeconds}s — no tolerance configured`, evidence);
      }
      const ok = rtcDrift.driftSeconds <= rtcDrift.toleranceSeconds;
      return make(ok ? "PASS" : "FAIL", `Measured drift ${rtcDrift.driftSeconds}s (tolerance ${rtcDrift.toleranceSeconds}s)`, evidence);
    }
    case "g3-alarms": {
      if (noData) return make("PENDING", "No valid packets received yet", null);
      // All five alarm flags must have been explicitly observed (non-null) before
      // we can conclude the device has reported a clean alarm state. Absence of
      // /82/0 data means the device has not yet reported alarms at all, not that
      // alarms are clear — return PENDING so approval is blocked until confirmed.
      const alarmKeys = ["magneticAttack", "antiDemolition", "leak", "overflow", "reverseFlow"] as const;
      const observed = alarmKeys.map((k) => ({ k, f: fieldObs(ctx.state.alarms, k) }));
      const missing = observed.filter(({ f }) => f == null).map(({ k }) => k);
      if (missing.length > 0) {
        return make(
          "PENDING",
          `Alarm state not yet observed for: ${missing.join(", ")} — awaiting /82/0 report`,
          evidenceFor(ctx, "Shengda /82/0 fields 0/2/4/5/10", null, "all five flags explicitly reported as false"),
        );
      }
      const active = observed.filter(({ f }) => f?.value === true);
      if (active.length > 0) {
        return make(
          "FAIL",
          `Active alarms: ${active.map((a) => a.k).join(", ")}`,
          evidenceFor(ctx, "Shengda /82/0 fields 0/2/4/5/10", active[0]!.f, false),
        );
      }
      // All five flags explicitly observed and none is true.
      const newestAlarm = observed
        .map(({ f }) => f)
        .filter((f): f is NonNullable<typeof f> => f != null)
        .sort((a, b) => (a.observedAt < b.observedAt ? 1 : -1))[0]!;
      return make(
        "PASS",
        "All alarm flags observed and clear (magneticAttack, antiDemolition, leak, overflow, reverseFlow)",
        evidenceFor(ctx, "Shengda /82/0 fields 0/2/4/5/10", { value: false, observedAt: newestAlarm.observedAt }, false),
      );
    }
    case "g3-report-cycle": {
      const cycle = fieldObs(ctx.state.reporting, "reportCycleSeconds");
      if (typeof cycle?.value === "number" && cycle.value > 0) {
        return make("PASS", `${cycle.value} s`, evidenceFor(ctx, "Shengda /84/0 field 0", cycle, "> 0"));
      }
      return make("PENDING", "No report cycle observed yet", evidenceFor(ctx, "Shengda /84/0 field 0", null, "> 0"));
    }
    default:
      return make("PENDING", "Unknown auto check", null);
  }
}

// ---------------------------------------------------------------------------
// Full commissioning detail
// ---------------------------------------------------------------------------

export interface Gate3Sampling {
  batchSize: number | null;
  samplePct: number;
  requiredSampleSize: number | null;
}

export interface CommissioningBlocker {
  checkCode: string;
  label: string;
  detail: string;
}

export interface CommissioningDetail {
  assetId: string;
  session: CommissioningSession;
  checks: QcResult[];
  blockers: CommissioningBlocker[];
  canApprove: boolean;
  commsTest: CommsTestStatus;
  rtcDrift: RtcDriftStatus;
  sampling: Gate3Sampling;
  connectivity: ConnectivityEvaluation;
  config: HhcConfiguration;
  evaluatedAt: string;
}

export async function getCommissioningDetail(assetId: string): Promise<CommissioningDetail> {
  const [sessionRow, config, packets, manualRows] = await Promise.all([
    getOrCreateSessionRow(assetId),
    getHhcConfiguration(),
    fetchHhcPackets(assetId, STATE_WINDOW_HOURS),
    db.select().from(hhcQcResultsTable).where(eq(hhcQcResultsTable.assetId, assetId)),
  ]);
  const session = toSession(sessionRow);

  const entries: ShengdaDecodedLogEntry[] = packets
    .filter((p) => p.decoded != null)
    .map((p) => ({ id: p.id, timestamp: p.timestamp, decoded: p.decoded! }));
  const state = buildShengdaCurrentState(entries);
  const ctx: PacketContext = { packets, state };
  const connectivity = evaluateConnectivity(state);

  const commsTest = evaluateCommsTest(packets, session.commissioningTestStartedAt);
  const rtcDrift = evaluateRtcDrift(packets, config.rtcToleranceSeconds);

  const manualByCode = new Map(manualRows.map((r) => [r.checkCode, r]));

  const checks: QcResult[] = QC_CHECKS.map((def) => {
    if (def.source === "AUTO") return autoResult(def, ctx, config, commsTest, rtcDrift);
    const row = manualByCode.get(def.code);
    return {
      checkCode: def.code,
      gate: def.gate,
      source: def.source,
      label: def.label,
      mandatory: def.mandatory,
      result: (row?.result as QcResultState) ?? "PENDING",
      detail: row ? `Recorded by ${row.operator}` : "Awaiting manual check",
      evidence: (row?.evidence as QcEvidence | null) ?? null,
      operator: row?.operator ?? null,
      recordedAt: row?.recordedAt.toISOString() ?? null,
      notes: row?.notes ?? null,
    };
  });

  const blockers: CommissioningBlocker[] = checks
    .filter((c) => c.mandatory && ((c.source === "AUTO" && c.result === "FAIL") || (c.source === "MANUAL" && c.result !== "PASS")))
    .map((c) => ({
      checkCode: c.checkCode,
      label: c.label,
      detail:
        c.source === "AUTO"
          ? `Mandatory auto-check failing: ${c.detail}`
          : c.result === "FAIL"
            ? `Mandatory manual check failed: ${c.detail}`
            : `Mandatory manual check not yet passed`,
    }));
  // Mandatory auto-checks stuck at PENDING also block approval (insufficient evidence).
  for (const c of checks) {
    if (c.mandatory && c.source === "AUTO" && c.result === "PENDING") {
      blockers.push({ checkCode: c.checkCode, label: c.label, detail: `Mandatory auto-check has no conclusive evidence yet: ${c.detail}` });
    }
  }

  const samplePct = config.gate3SamplePct;
  const sampling: Gate3Sampling = {
    batchSize: session.batchSize,
    samplePct,
    requiredSampleSize: session.batchSize != null ? Math.ceil(session.batchSize * (samplePct / 100)) : null,
  };

  return {
    assetId,
    session,
    checks,
    blockers,
    canApprove: session.stage !== "approved" && blockers.length === 0,
    commsTest,
    rtcDrift,
    sampling,
    connectivity,
    config,
    evaluatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export class CommissioningError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
  ) {
    super(message);
  }
}

export async function setStage(assetId: string, stage: CommissioningStage, operator: string): Promise<void> {
  if (stage === "approved") {
    throw new CommissioningError("Use the approve action (with blocker enforcement) to approve a meter");
  }
  await getOrCreateSessionRow(assetId);
  await db
    .update(hhcCommissioningSessionsTable)
    .set({ stage, updatedBy: operator })
    .where(eq(hhcCommissioningSessionsTable.assetId, assetId));
  await recordAudit(assetId, "stage-transition", operator, null, { stage });
}

export async function startCommsTest(assetId: string, operator: string): Promise<void> {
  await getOrCreateSessionRow(assetId);
  const startedAt = new Date();
  await db
    .update(hhcCommissioningSessionsTable)
    .set({ commissioningTestStartedAt: startedAt, updatedBy: operator })
    .where(eq(hhcCommissioningSessionsTable.assetId, assetId));
  await recordAudit(assetId, "comms-test-started", operator, null, { startedAt: startedAt.toISOString() });
}

export async function setBatchSize(assetId: string, batchSize: number, operator: string): Promise<void> {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new CommissioningError("batchSize must be a positive integer");
  }
  await getOrCreateSessionRow(assetId);
  await db
    .update(hhcCommissioningSessionsTable)
    .set({ batchSize, updatedBy: operator })
    .where(eq(hhcCommissioningSessionsTable.assetId, assetId));
  await recordAudit(assetId, "batch-size-set", operator, null, { batchSize });
}

export async function recordManualCheck(
  assetId: string,
  checkCode: string,
  result: QcResultState,
  operator: string,
  notes: string | null,
  evidence: Record<string, unknown> | null,
): Promise<void> {
  const def = findCheckDef(checkCode);
  if (!def) throw new CommissioningError(`Unknown checkCode: ${checkCode}`);
  if (def.source === "AUTO") {
    throw new CommissioningError(
      `Check ${checkCode} is an AUTO check computed from live device data — it cannot be recorded manually`,
    );
  }
  await getOrCreateSessionRow(assetId);
  await db
    .insert(hhcQcResultsTable)
    .values({ assetId, checkCode, gate: def.gate, result, operator, notes, evidence, recordedAt: new Date() })
    .onConflictDoUpdate({
      target: [hhcQcResultsTable.assetId, hhcQcResultsTable.checkCode],
      set: { result, operator, notes, evidence, recordedAt: new Date() },
    });
  await recordAudit(assetId, "manual-check-recorded", operator, null, { checkCode, result, notes });
}

export async function approveCommissioning(
  assetId: string,
  operator: string,
  override: { reason: string } | null,
  operatorRole?: string,
): Promise<void> {
  const detail = await getCommissioningDetail(assetId);
  if (detail.session.stage === "approved") {
    throw new CommissioningError("Meter is already approved");
  }
  if (detail.blockers.length > 0) {
    if (!override) {
      throw new CommissioningError(
        `Cannot approve: ${detail.blockers.length} blocker(s) — ${detail.blockers.map((b) => b.label).join("; ")}`,
        409,
      );
    }
    if (!override.reason.trim()) {
      throw new CommissioningError("Override requires a non-empty reason");
    }
  }
  const now = new Date();
  await db
    .update(hhcCommissioningSessionsTable)
    .set({
      stage: "approved",
      approvedAt: now,
      approvedBy: operator,
      overrideReason: detail.blockers.length > 0 && override ? override.reason : null,
      updatedBy: operator,
    })
    .where(eq(hhcCommissioningSessionsTable.assetId, assetId));
  await recordAudit(
    assetId,
    detail.blockers.length > 0 && override ? "approved-with-override" : "approved",
    operator,
    override?.reason ?? null,
    {
      blockers: detail.blockers,
      approvedAt: now.toISOString(),
      operatorRole: operatorRole ?? null,
    },
  );
}
