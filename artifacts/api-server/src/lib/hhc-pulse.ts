// ---------------------------------------------------------------------------
// Pulse maintenance-system integration for the HHC dashboard.
//
// Pulse (https://pulseapi.ewater.io) is the source of truth for maintenance
// jobs and operational faults. This module wraps the Pulse Jobs and Faults
// APIs and merges Pulse faults with locally computed Shengda health alarms
// into a unified alarm list. We never cache Pulse job state in PostgreSQL —
// only short in-memory TTL caches to keep dashboard polling cheap.
// ---------------------------------------------------------------------------

import { randomUUID } from "crypto";
import { pulseFetch, getCredentials } from "./ewater-client";
import {
  listHouseholdMeters,
  getHouseholdMeterState,
  calculateHouseholdMeterHealth,
  mapWithConcurrency,
  type HealthReason,
} from "./hhc-insights";
import type { ShengdaCurrentState } from "./shengda-nbiot-decoder";

// ── Errors ───────────────────────────────────────────────────────────────────

export class PulseError extends Error {
  constructor(
    message: string,
    public readonly upstreamStatus: number,
    public readonly upstreamBody: unknown,
  ) {
    super(message);
    this.name = "PulseError";
  }
}

function expectOk(label: string, result: { status: number; data: unknown }): unknown {
  if (result.status < 200 || result.status >= 300) {
    const upstreamMsg =
      result.data && typeof result.data === "object" && typeof (result.data as Record<string, unknown>)["errorMessage"] === "string"
        ? `: ${(result.data as Record<string, unknown>)["errorMessage"]}`
        : "";
    throw new PulseError(`Pulse ${label} failed with status ${result.status}${upstreamMsg}`, result.status, result.data);
  }
  return result.data;
}

// ── Tiny TTL cache ───────────────────────────────────────────────────────────

const REFERENCE_TTL_MS = 5 * 60_000; // users / fault types / job types
const LIVE_TTL_MS = 60_000; // fleet faults / work queues
const STATE_TTL_MS = 5 * 60_000; // per-meter Shengda state for fleet alarms

const ttlCache = new Map<string, { expiresAt: number; value: unknown }>();

async function cachedTtl<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = ttlCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await fn();
  ttlCache.set(key, { expiresAt: Date.now() + ttlMs, value });
  if (ttlCache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of ttlCache) if (v.expiresAt <= now) ttlCache.delete(k);
  }
  return value;
}

export function invalidatePulseJobCaches(): void {
  for (const k of ttlCache.keys()) if (k.startsWith("workqueues")) ttlCache.delete(k);
}

// ── Asset ID mapping ─────────────────────────────────────────────────────────
// Pulse entityId is an int32; eWater asset IDs are numeric strings.

export function toPulseEntityId(assetId: string): number {
  const n = Number(assetId);
  if (!Number.isInteger(n) || n <= 0 || n > 2_147_483_647) {
    throw new PulseError(`Asset ID "${assetId}" cannot be mapped to a Pulse int32 entityId`, 400, null);
  }
  return n;
}

// ── Reference data ───────────────────────────────────────────────────────────

export interface AssignableUser {
  userId: string;
  displayName: string;
  email: string | null;
  mobileNumber: string | null;
}

export async function getAssignableUsers(): Promise<AssignableUser[]> {
  return cachedTtl("assignable-users", REFERENCE_TTL_MS, async () => {
    const data = expectOk("AssignableUsers", await pulseFetch("/api/users/AssignableUsers", { method: "GET" })) as {
      users?: AssignableUser[] | null;
    };
    return (data.users ?? []).map((u) => ({
      userId: u.userId,
      displayName: u.displayName,
      email: u.email ?? null,
      mobileNumber: u.mobileNumber ?? null,
    }));
  });
}

export interface PulseFaultType {
  faultTypeId: string;
  name: string;
  description: string | null;
  entityType: string | null;
  applicableDiagnoses: string[];
}

export async function getPulseFaultTypes(): Promise<PulseFaultType[]> {
  return cachedTtl("fault-types", REFERENCE_TTL_MS, async () => {
    const data = expectOk("FaultTypes", await pulseFetch("/api/Faults/FaultTypes", { method: "GET" })) as PulseFaultType[];
    return (Array.isArray(data) ? data : []).map((t) => ({
      faultTypeId: t.faultTypeId,
      name: t.name,
      description: t.description ?? null,
      entityType: t.entityType ?? null,
      applicableDiagnoses: t.applicableDiagnoses ?? [],
    }));
  });
}

export interface PulseJobType {
  jobTypeId: string;
  name: string;
  entityType: string | null;
  defaultPriority: number;
  isFaultLinked: boolean;
  faultTypeId: string | null;
  /** Human observation values allowed when creating a fault-linked job. */
  observations: { value: string; display: string; description: string | null }[];
}

export async function getManualJobTypes(): Promise<PulseJobType[]> {
  return cachedTtl("manual-job-types", REFERENCE_TTL_MS, async () => {
    const data = expectOk(
      "ManualCreateOptions",
      await pulseFetch("/api/jobs/ManualCreateOptions?entityType=Asset", { method: "GET" }),
    ) as {
      jobTypes?: {
        jobType: { jobTypeId: string; name: string; entityType: string | null; defaultPriority: number };
        isFaultLinked: boolean;
        faultTypeId: string | null;
        humanObservations?: { value: string; display: string; description: string | null }[] | null;
      }[] | null;
    };
    return (data.jobTypes ?? []).map((o) => ({
      jobTypeId: o.jobType.jobTypeId,
      name: o.jobType.name,
      entityType: o.jobType.entityType ?? null,
      defaultPriority: o.jobType.defaultPriority,
      isFaultLinked: o.isFaultLinked,
      faultTypeId: o.faultTypeId ?? null,
      observations: (o.humanObservations ?? []).map((h) => ({
        value: h.value,
        display: h.display,
        description: h.description ?? null,
      })),
    }));
  });
}

// ── Context user (Pulse WorkQueue / GetFaults are per-user views) ────────────
// We call these APIs with a user context. Prefer the assignable user whose
// email matches the configured eWater username, otherwise fall back to the
// first assignable user (whose view is organisation-wide for faults).

async function resolveContextUserId(): Promise<string> {
  return cachedTtl("context-user", REFERENCE_TTL_MS, async () => {
    const users = await getAssignableUsers();
    if (users.length === 0) throw new PulseError("Pulse returned no assignable users", 502, null);
    const username = getCredentials()?.username?.toLowerCase() ?? "";
    const match = username ? users.find((u) => (u.email ?? "").toLowerCase() === username) : undefined;
    return (match ?? users[0]!).userId;
  });
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

export interface PulseJobRecord {
  jobRecordId: string | null;
  recordType: string;
  eventDt: string;
  data: string | null;
}

export interface PulseJob {
  jobInstanceId: string;
  jobTypeId: string;
  jobTypeName: string | null;
  entityType: string | null;
  entityId: number;
  priority: number;
  createdDt: string;
  assigneeUserId: string | null;
  assigneeName: string | null;
  jobLifecycleState: string | null;
  closedDt: string | null;
  title: string | null;
  description: string | null;
  dueDt: string | null;
  createdSource: string | null;
  records: PulseJobRecord[];
  faultInstanceId: string | null;
}

interface RawJobDto {
  jobInstanceId: string;
  jobTypeId: string;
  entityType: string | null;
  entityId: number;
  priority: number;
  createdDt: string;
  assigneeUserId: string | null;
  jobLifecycleState: string | null;
  closedDt: string | null;
  title: string | null;
  description: string | null;
  dueDt: string | null;
  createdSource: string | null;
  jobRecords?: { jobRecordId?: string; jobRecordTypeDto: string; eventDt: string; data: string | null }[] | null;
  fault?: { faultInstanceId: string } | null;
}

async function shapeJobs(raw: RawJobDto[]): Promise<PulseJob[]> {
  const [users, jobTypes] = await Promise.all([
    getAssignableUsers().catch(() => [] as AssignableUser[]),
    getManualJobTypes().catch(() => [] as PulseJobType[]),
  ]);
  const userName = new Map(users.map((u) => [u.userId, u.displayName]));
  const typeName = new Map(jobTypes.map((t) => [t.jobTypeId, t.name]));
  return raw.map((j) => ({
    jobInstanceId: j.jobInstanceId,
    jobTypeId: j.jobTypeId,
    jobTypeName: typeName.get(j.jobTypeId) ?? null,
    entityType: j.entityType ?? null,
    entityId: j.entityId,
    priority: j.priority,
    createdDt: j.createdDt,
    assigneeUserId: j.assigneeUserId ?? null,
    assigneeName: j.assigneeUserId ? (userName.get(j.assigneeUserId) ?? null) : null,
    jobLifecycleState: j.jobLifecycleState ?? null,
    closedDt: j.closedDt ?? null,
    title: j.title ?? null,
    description: j.description ?? null,
    dueDt: j.dueDt ?? null,
    createdSource: j.createdSource ?? null,
    records: (j.jobRecords ?? []).map((r) => ({
      jobRecordId: r.jobRecordId ?? null,
      recordType: r.jobRecordTypeDto,
      eventDt: r.eventDt,
      data: r.data ?? null,
    })),
    faultInstanceId: j.fault?.faultInstanceId ?? null,
  }));
}

/**
 * Pulse only exposes jobs through per-user work queues, so asset-scoped job
 * lookup scans every assignable user's queue (bounded concurrency, cached).
 * Limitation: jobs that are unassigned AND absent from every queue are not
 * visible through this API surface.
 */
async function getAllWorkQueueJobs(): Promise<RawJobDto[]> {
  return cachedTtl("workqueues:all", LIVE_TTL_MS, async () => {
    const users = await getAssignableUsers();
    const failures: string[] = [];
    const perUser = await mapWithConcurrency(users, 5, async (u) => {
      const result = await pulseFetch(`/api/jobs/WorkQueue?userId=${encodeURIComponent(u.userId)}`, { method: "GET" });
      if (result.status < 200 || result.status >= 300) {
        failures.push(`${u.displayName ?? u.userId}: ${result.status}`);
        return [] as RawJobDto[];
      }
      const data = result.data as { jobs?: RawJobDto[] | null };
      return data.jobs ?? [];
    });
    // Fail closed: a missing queue would silently hide that technician's jobs
    // (and could turn a valid job mutation into a false 404).
    if (failures.length > 0) {
      throw new PulseError(
        `Pulse WorkQueue unavailable for ${failures.length} of ${users.length} technician(s): ${failures.slice(0, 3).join("; ")}`,
        502,
        { failures },
      );
    }
    // Dedup by jobInstanceId (a job should only sit in one queue, but be safe).
    const byId = new Map<string, RawJobDto>();
    for (const j of perUser.flat()) byId.set(j.jobInstanceId, j);
    return [...byId.values()];
  });
}

export async function getPulseJobsForAsset(assetId: string): Promise<PulseJob[]> {
  const entityId = toPulseEntityId(assetId);
  const all = await getAllWorkQueueJobs();
  const mine = all.filter((j) => (j.entityType ?? "Asset") === "Asset" && j.entityId === entityId);
  const shaped = await shapeJobs(mine);
  return shaped.sort((a, b) => new Date(b.createdDt).getTime() - new Date(a.createdDt).getTime());
}

export interface CreatePulseJobInput {
  jobTypeId: string;
  title?: string | null;
  description?: string | null;
  priority?: number | null;
  dueDt?: string | null;
  assigneeUserId?: string | null;
  faultObservation?: string | null;
}

export async function createPulseJob(assetId: string, input: CreatePulseJobInput): Promise<PulseJob> {
  const entityId = toPulseEntityId(assetId);
  const body = {
    jobTypeId: input.jobTypeId,
    entityType: "Asset",
    entityId,
    ...(input.title ? { title: input.title } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.priority != null ? { priority: input.priority } : {}),
    ...(input.dueDt ? { dueDt: input.dueDt } : {}),
    ...(input.assigneeUserId ? { assigneeUserId: input.assigneeUserId } : {}),
    ...(input.faultObservation ? { faultObservation: input.faultObservation } : {}),
  };
  const result = await pulseFetch("/api/jobs/CreateManualJob", { method: "POST", body: JSON.stringify(body) });
  const data = expectOk("CreateManualJob", result) as { success?: boolean; errorMessage?: string | null; job?: RawJobDto };
  if (data.success === false || !data.job) {
    throw new PulseError(`Pulse CreateManualJob rejected the request: ${data.errorMessage ?? "no job returned"}`, result.status, data);
  }
  let rawJob = data.job;
  // Pulse silently ignores assigneeUserId on CreateManualJob (verified live:
  // the returned job has assigneeUserId null). Assign explicitly so the job
  // lands in the technician's work queue — unassigned jobs are invisible.
  if (input.assigneeUserId) {
    await baseResponseCall("ReassignJob", "/api/jobs/ReassignJob", {
      jobInstanceId: data.job.jobInstanceId,
      assigneeUserId: input.assigneeUserId,
    });
    rawJob = { ...rawJob, assigneeUserId: input.assigneeUserId };
  }
  invalidatePulseJobCaches();
  const [job] = await shapeJobs([rawJob]);
  return job!;
}

async function baseResponseCall(label: string, path: string, body: unknown): Promise<void> {
  const result = await pulseFetch(path, { method: "POST", body: JSON.stringify(body) });
  const data = expectOk(label, result) as { success?: boolean; errorMessage?: string | null };
  if (data.success === false) {
    throw new PulseError(`Pulse ${label} rejected the request: ${data.errorMessage ?? "unknown error"}`, result.status, data);
  }
  invalidatePulseJobCaches();
}

export async function reassignPulseJob(jobInstanceId: string, assigneeUserId: string): Promise<void> {
  await baseResponseCall("ReassignJob", "/api/jobs/ReassignJob", { jobInstanceId, assigneeUserId });
}

export async function cancelPulseJob(jobInstanceId: string): Promise<void> {
  await baseResponseCall("CancelJob", "/api/jobs/CancelJob", { jobInstanceId });
}

export interface PulseJobEventInput {
  recordType: "Blockage" | "ReadingCapture" | "PartChange" | "Action" | "Escalation" | "Completion" | "WorkStarted";
  eventDt: string;
  data: string | null;
}

export async function recordPulseJobEvents(jobInstanceId: string, events: PulseJobEventInput[]): Promise<void> {
  // Pulse requires a client-generated jobRecordId (UUID) per record, and the
  // data field must be a JSON payload string validated per record type
  // ("{}" is the accepted minimal payload).
  await baseResponseCall("RecordJobEvents", "/api/jobs/RecordJobEvents", {
    records: events.map((e) => ({
      jobRecordId: randomUUID(),
      jobInstanceId,
      jobRecordTypeDto: e.recordType,
      eventDt: e.eventDt,
      data: e.data && e.data.trim() ? e.data : "{}",
    })),
  });
}

// ── Faults ───────────────────────────────────────────────────────────────────

export interface PulseFault {
  faultInstanceId: string;
  faultTypeId: string;
  faultTypeName: string | null;
  description: string | null;
  entityType: string | null;
  entityId: number;
  startDt: string;
  endDt: string | null;
  severity: number;
  faultLifecycleState: string | null;
  records: { recordType: string; value: string | null; recordedDt: string; verificationStatus: string | null }[];
}

interface RawFaultDto {
  faultInstanceId: string;
  faultTypeId: string;
  description: string | null;
  entityType: string | null;
  entityId: number;
  startDt: string;
  endDt: string | null;
  severity: number;
  faultLifecycleState: string | null;
  faultRecords?: { recordType: string; value: string | null; recordedDt: string; verificationStatus: string | null }[] | null;
}

async function shapeFaults(raw: RawFaultDto[]): Promise<PulseFault[]> {
  const types = await getPulseFaultTypes().catch(() => [] as PulseFaultType[]);
  const typeName = new Map(types.map((t) => [t.faultTypeId, t.name]));
  return raw.map((f) => ({
    faultInstanceId: f.faultInstanceId,
    faultTypeId: f.faultTypeId,
    faultTypeName: typeName.get(f.faultTypeId) ?? null,
    description: f.description ?? null,
    entityType: f.entityType ?? null,
    entityId: f.entityId,
    startDt: f.startDt,
    endDt: f.endDt ?? null,
    severity: f.severity,
    faultLifecycleState: f.faultLifecycleState ?? null,
    records: (f.faultRecords ?? []).map((r) => ({
      recordType: r.recordType,
      value: r.value ?? null,
      recordedDt: r.recordedDt,
      verificationStatus: r.verificationStatus ?? null,
    })),
  }));
}

export async function getPulseFleetFaults(): Promise<PulseFault[]> {
  return cachedTtl("fleet-faults", LIVE_TTL_MS, async () => {
    // GetFaults is a per-user view — fan out across every assignable user and
    // dedup by faultInstanceId so faults visible only to other users are not lost.
    const users = await getAssignableUsers();
    const failures: string[] = [];
    const perUser = await mapWithConcurrency(users, 5, async (u) => {
      const result = await pulseFetch(`/api/Faults/GetFaults?userId=${encodeURIComponent(u.userId)}`, { method: "GET" });
      if (result.status < 200 || result.status >= 300) {
        failures.push(`${u.displayName ?? u.userId}: ${result.status}`);
        return [] as RawFaultDto[];
      }
      const data = result.data as { faults?: RawFaultDto[] | null };
      return data.faults ?? [];
    });
    // Fail closed rather than reporting a falsely clean fault picture.
    if (failures.length > 0) {
      throw new PulseError(
        `Pulse GetFaults unavailable for ${failures.length} of ${users.length} user(s): ${failures.slice(0, 3).join("; ")}`,
        502,
        { failures },
      );
    }
    const byId = new Map<string, RawFaultDto>();
    for (const f of perUser.flat()) byId.set(f.faultInstanceId, f);
    return shapeFaults([...byId.values()]);
  });
}

/**
 * Verify that a Pulse job belongs to the given asset before allowing a
 * mutation routed through an asset-scoped endpoint. Throws PulseError 404
 * when the job is not visible in any work queue for this asset.
 */
export async function assertJobBelongsToAsset(assetId: string, jobInstanceId: string): Promise<void> {
  const entityId = toPulseEntityId(assetId);
  let all = await getAllWorkQueueJobs();
  let job = all.find((j) => j.jobInstanceId === jobInstanceId);
  if (!job) {
    // Cache may be stale (e.g. job just created/reassigned) — refresh once.
    invalidatePulseJobCaches();
    all = await getAllWorkQueueJobs();
    job = all.find((j) => j.jobInstanceId === jobInstanceId);
  }
  if (!job) {
    throw new PulseError(
      `Job ${jobInstanceId} was not found in any technician's work queue for this asset`,
      404,
      null,
    );
  }
  if ((job.entityType ?? "Asset") !== "Asset" || job.entityId !== entityId) {
    throw new PulseError(`Job ${jobInstanceId} does not belong to asset ${assetId}`, 404, null);
  }
}

export async function getPulseFaultsForAsset(assetId: string): Promise<PulseFault[]> {
  const entityId = toPulseEntityId(assetId);
  const fleet = await getPulseFleetFaults();
  return fleet.filter((f) => (f.entityType ?? "Asset") === "Asset" && f.entityId === entityId);
}

// ── Unified alarms (Pulse + Shengda) ─────────────────────────────────────────

export type AlarmSeverity = "critical" | "warning" | "info";

export interface HhcAlarm {
  source: "Pulse" | "Shengda";
  assetId: string;
  code: string;
  label: string;
  severity: AlarmSeverity;
  /** Raw upstream severity (Pulse int severity) or Shengda health severity. */
  severityRaw: string;
  observedValue: string | null;
  expectedValue: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  status: string;
  description: string | null;
  faultInstanceId: string | null;
}

/** Pulse severity is an int; lower = more severe by convention. */
function mapPulseSeverity(severity: number): AlarmSeverity {
  if (severity <= 2) return "critical";
  if (severity <= 4) return "warning";
  return "info";
}

function pulseFaultToAlarm(assetId: string, f: PulseFault): HhcAlarm {
  const lastRecord = f.records.reduce<string | null>(
    (acc, r) => (acc == null || r.recordedDt > acc ? r.recordedDt : acc),
    null,
  );
  const observation = f.records.find((r) => r.recordType === "Observation")?.value ?? null;
  return {
    source: "Pulse",
    assetId,
    code: f.faultTypeId,
    label: f.faultTypeName ?? "Unknown fault type",
    severity: mapPulseSeverity(f.severity),
    severityRaw: `Pulse severity ${f.severity}`,
    observedValue: observation,
    expectedValue: "No active fault",
    firstSeenAt: f.startDt,
    lastSeenAt: lastRecord ?? f.startDt,
    status: f.faultLifecycleState ?? "unknown",
    description: f.description,
    faultInstanceId: f.faultInstanceId,
  };
}

/** Threshold/expected text per Shengda health reason code (prefix match). */
const SHENGDA_EXPECTED: [string, string][] = [
  ["alarm-", "Alarm flag clear"],
  ["water-error-code", "Error code 0"],
  ["valve-failure", "Valve status normal"],
  ["battery-status", "Battery status normal"],
  ["low-voltage", "Supply voltage ≥ 3.2 V"],
  ["weak-signal", "RSRP ≥ -110 dBm"],
  ["prepay-low", "Allowance above alarm threshold"],
  ["invalid-packets", "0 packets with invalid CRC"],
  ["no-data", "Valid packets received"],
];

const SHENGDA_LABELS: Record<string, string> = {
  "alarm-magneticAttack": "Magnetic attack",
  "alarm-antiDemolition": "Tamper (anti-demolition)",
  "alarm-leak": "Leak",
  "alarm-overflow": "Overflow",
  "alarm-reverseFlow": "Reverse flow",
  "water-error-code": "Water error code",
  "valve-failure": "Valve failure",
  "battery-status": "Battery status",
  "low-voltage": "Low supply voltage",
  "weak-signal": "Weak NB-IoT signal",
  "prepay-low": "Prepaid allowance low",
  "invalid-packets": "Packet CRC errors",
  "no-data": "No device data",
};

function shengdaReasonToAlarm(assetId: string, r: HealthReason, lastPacketAt: string | null): HhcAlarm | null {
  if (r.severity === "ok") return null;
  const expected = SHENGDA_EXPECTED.find(([prefix]) => r.code.startsWith(prefix))?.[1] ?? null;
  return {
    source: "Shengda",
    assetId,
    code: r.code,
    label: SHENGDA_LABELS[r.code] ?? r.code,
    severity: r.severity === "critical" ? "critical" : "warning",
    severityRaw: `Shengda ${r.severity}`,
    observedValue: r.message,
    expectedValue: expected,
    firstSeenAt: r.observedAt,
    lastSeenAt: r.observedAt ?? lastPacketAt,
    status: "active",
    description: r.message,
    faultInstanceId: null,
  };
}

export function buildShengdaAlarms(assetId: string, state: ShengdaCurrentState): HhcAlarm[] {
  const health = calculateHouseholdMeterHealth(state);
  return health.reasons
    .map((r) => shengdaReasonToAlarm(assetId, r, state.lastValidPacketAt))
    .filter((a): a is HhcAlarm => a !== null);
}

function sortAlarms(alarms: HhcAlarm[]): HhcAlarm[] {
  const rank: Record<AlarmSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return alarms.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      new Date(b.lastSeenAt ?? 0).getTime() - new Date(a.lastSeenAt ?? 0).getTime(),
  );
}

export interface MeterAlarmsResult {
  assetId: string;
  alarms: HhcAlarm[];
  pulseCount: number;
  shengdaCount: number;
  pulseError: string | null;
}

export async function getMeterAlarms(assetId: string): Promise<MeterAlarmsResult> {
  const [stateResult, pulseResult] = await Promise.allSettled([
    getHouseholdMeterState(assetId),
    getPulseFaultsForAsset(assetId),
  ]);

  const shengda =
    stateResult.status === "fulfilled" ? buildShengdaAlarms(assetId, stateResult.value.state) : [];
  const pulse = pulseResult.status === "fulfilled" ? pulseResult.value.map((f) => pulseFaultToAlarm(assetId, f)) : [];

  // Device state is core to the meter page; surface its failure loudly.
  if (stateResult.status === "rejected") throw stateResult.reason;

  return {
    assetId,
    alarms: sortAlarms([...pulse, ...shengda]),
    pulseCount: pulse.length,
    shengdaCount: shengda.length,
    pulseError:
      pulseResult.status === "rejected"
        ? pulseResult.reason instanceof Error
          ? pulseResult.reason.message
          : String(pulseResult.reason)
        : null,
  };
}

export interface FleetAlarmsResult {
  alarms: HhcAlarm[];
  pulseCount: number;
  shengdaCount: number;
  meterCount: number;
  /** How many meters had Shengda state evaluated (bounded, cached). */
  shengdaCoverage: number;
  pulseError: string | null;
  shengdaErrors: number;
}

/** Fleet-wide alarms: all Pulse faults on household meters + Shengda alarms. */
export async function getFleetAlarms(): Promise<FleetAlarmsResult> {
  const metersPage = await listHouseholdMeters({ limit: 100000, offset: 0 });
  const meters = metersPage.items;
  const meterIds = new Set(meters.map((m) => m.id));

  let pulseAlarms: HhcAlarm[] = [];
  let pulseError: string | null = null;
  try {
    const faults = await getPulseFleetFaults();
    pulseAlarms = faults
      .filter((f) => (f.entityType ?? "Asset") === "Asset" && meterIds.has(String(f.entityId)))
      .map((f) => pulseFaultToAlarm(String(f.entityId), f));
  } catch (err) {
    pulseError = err instanceof Error ? err.message : String(err);
  }

  let shengdaErrors = 0;
  const perMeter = await mapWithConcurrency(meters, 5, async (m) => {
    try {
      const { state } = await cachedTtl(`meter-state:${m.id}`, STATE_TTL_MS, () => getHouseholdMeterState(m.id));
      return buildShengdaAlarms(m.id, state);
    } catch {
      shengdaErrors += 1;
      return [] as HhcAlarm[];
    }
  });
  const shengdaAlarms = perMeter.flat();

  return {
    alarms: sortAlarms([...pulseAlarms, ...shengdaAlarms]),
    pulseCount: pulseAlarms.length,
    shengdaCount: shengdaAlarms.length,
    meterCount: meters.length,
    shengdaCoverage: meters.length - shengdaErrors,
    pulseError,
    shengdaErrors,
  };
}
