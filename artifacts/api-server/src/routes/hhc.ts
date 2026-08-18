// ---------------------------------------------------------------------------
// HHC (Household Meter Commissioning) REST endpoints.
//
// Thin wrappers around lib/hhc-insights.ts. All responses carry `fetchedAt`
// (when this server computed the answer) and, where meaningful,
// `sourceObservedAt` (timestamp of the newest device observation used).
// Short-lived in-memory caching keeps the meter list and per-meter state
// endpoints cheap under dashboard polling.
// ---------------------------------------------------------------------------

import { Router, type IRouter } from "express";
import { z } from "zod";
import { getCredentials, pulseFetch } from "../lib/ewater-client";
import {
  listHouseholdMeters,
  getHouseholdMeter,
  getHouseholdMeterState,
  getHouseholdMeterHistory,
  getHouseholdMeterCommunications,
  type HistoryPeriod,
} from "../lib/hhc-insights";
import {
  getCommissioningDetail,
  getHhcConfiguration,
  updateHhcConfiguration,
  setStage,
  startCommsTest,
  setBatchSize,
  recordManualCheck,
  approveCommissioning,
  recordAudit,
  CommissioningError,
  STAGES,
  type CommissioningStage,
} from "../lib/hhc-commissioning";
import {
  requireOperatorAuth,
  operatorOf,
  issueOperatorToken,
  roleForAccessKey,
  accessKeysConfigured,
} from "../lib/hhc-auth";

const router: IRouter = Router();

// ── Tiny TTL cache ───────────────────────────────────────────────────────────

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { expiresAt: number; value: unknown }>();

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await fn();
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  // Opportunistic sweep so the map can't grow unbounded.
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k);
  }
  return value;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function requireCreds(res: import("express").Response): boolean {
  if (!getCredentials()) {
    res.status(401).json({ error: "No credentials configured" });
    return false;
  }
  return true;
}

function numQ(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return isNaN(n) ? undefined : n;
}

function strQ(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

const handle =
  (fn: (req: import("express").Request, res: import("express").Response) => Promise<void>) =>
  async (req: import("express").Request, res: import("express").Response): Promise<void> => {
    try {
      await fn(req, res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      req.log.error({ err }, "HHC endpoint failed");
      res.status(502).json({ error: `eWater API error: ${msg}` });
    }
  };

// ── GET /api/ewater/hhc/meters ───────────────────────────────────────────────

router.get(
  "/ewater/hhc/meters",
  handle(async (req, res) => {
    if (!requireCreds(res)) return;
    const options = {
      status: strQ(req.query["status"]),
      waterSystemId: numQ(req.query["waterSystemId"]),
      search: strQ(req.query["search"]),
      limit: numQ(req.query["limit"]),
      offset: numQ(req.query["offset"]),
    };
    const key = `meters:${JSON.stringify(options)}`;
    const page = await cached(key, () => listHouseholdMeters(options));
    res.json({ ...page, fetchedAt: new Date().toISOString() });
  }),
);

// ── GET /api/ewater/hhc/meters/:assetId ──────────────────────────────────────

router.get(
  "/ewater/hhc/meters/:assetId",
  handle(async (req, res) => {
    if (!requireCreds(res)) return;
    const assetId = String(req.params["assetId"]);
    const meter = await cached(`meter:${assetId}`, () => getHouseholdMeter(assetId));
    if (!meter) {
      res.status(404).json({ error: "Household meter not found" });
      return;
    }
    res.json({ ...meter, fetchedAt: new Date().toISOString() });
  }),
);

// ── GET /api/ewater/hhc/meters/:assetId/state ────────────────────────────────

router.get(
  "/ewater/hhc/meters/:assetId/state",
  handle(async (req, res) => {
    if (!requireCreds(res)) return;
    const assetId = String(req.params["assetId"]);
    const result = await cached(`state:${assetId}`, () => getHouseholdMeterState(assetId));
    res.json({
      ...result,
      fetchedAt: new Date().toISOString(),
      sourceObservedAt: result.state.lastValidPacketAt,
    });
  }),
);

// ── GET /api/ewater/hhc/meters/:assetId/history ──────────────────────────────

const VALID_PERIODS: HistoryPeriod[] = ["24h", "7d", "30d", "90d"];

router.get(
  "/ewater/hhc/meters/:assetId/history",
  handle(async (req, res) => {
    if (!requireCreds(res)) return;
    const assetId = String(req.params["assetId"]);
    const period = strQ(req.query["period"]) ?? "7d";
    if (!VALID_PERIODS.includes(period as HistoryPeriod)) {
      res.status(400).json({ error: `Invalid period. Use one of: ${VALID_PERIODS.join(", ")}` });
      return;
    }
    const result = await cached(`history:${assetId}:${period}`, () =>
      getHouseholdMeterHistory(assetId, period as HistoryPeriod),
    );
    res.json({ ...result, fetchedAt: new Date().toISOString() });
  }),
);

// ── GET /api/ewater/hhc/meters/:assetId/communications ───────────────────────

router.get(
  "/ewater/hhc/meters/:assetId/communications",
  handle(async (req, res) => {
    if (!requireCreds(res)) return;
    const assetId = String(req.params["assetId"]);
    const options = {
      hours: numQ(req.query["hours"]),
      validOnly: strQ(req.query["validOnly"]) === "true",
      messageFunction: strQ(req.query["messageFunction"]),
      imei: strQ(req.query["imei"]),
      limit: numQ(req.query["limit"]),
      offset: numQ(req.query["offset"]),
    };
    const key = `comms:${assetId}:${JSON.stringify(options)}`;
    const page = await cached(key, () => getHouseholdMeterCommunications(assetId, options));
    res.json({ ...page, fetchedAt: new Date().toISOString() });
  }),
);

// ── Operator authentication ──────────────────────────────────────────────────
//
// Commissioning writes require a server-verified operator token (see
// lib/hhc-auth.ts). Identity and role come from verified HMAC claims — never
// from client-supplied headers.

const loginSchema = z
  .object({
    operatorName: z.string().min(1).max(120),
    accessKey: z.string().min(1),
  })
  .strict();

router.post(
  "/ewater/hhc/auth/login",
  handle(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "operatorName and accessKey are required" });
      return;
    }
    if (!accessKeysConfigured()) {
      res.status(503).json({ error: "Operator access keys are not configured on the server (HHC_OPERATOR_KEY / HHC_ADMIN_KEY)" });
      return;
    }
    const role = roleForAccessKey(parsed.data.accessKey);
    if (!role) {
      res.status(401).json({ error: "Invalid access key" });
      return;
    }
    const name = parsed.data.operatorName.trim();
    const { token, expiresAt } = issueOperatorToken(name, role);
    await recordAudit(null, "operator-login", name, null, { role });
    res.json({ token, operator: name, role, expiresAt });
  }),
);

const sendCommissioningError = (res: import("express").Response, err: unknown): boolean => {
  if (err instanceof CommissioningError) {
    res.status(err.statusCode).json({ error: err.message });
    return true;
  }
  return false;
};

// ── GET /api/ewater/hhc/meters/:assetId/commissioning ────────────────────────

router.get(
  "/ewater/hhc/meters/:assetId/commissioning",
  handle(async (req, res) => {
    if (!requireCreds(res)) return;
    const assetId = String(req.params["assetId"]);
    const result = await cached(`commissioning:${assetId}`, () => getCommissioningDetail(assetId));
    res.json({
      ...result,
      fetchedAt: new Date().toISOString(),
      sourceObservedAt: result.connectivity.lastValidPacketAt,
    });
  }),
);

// ── PUT /api/ewater/hhc/meters/:assetId/commissioning ────────────────────────

const updateCommissioningSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setStage"), stage: z.enum(STAGES.filter((s) => s !== "approved") as [CommissioningStage, ...CommissioningStage[]]) }),
  z.object({ action: z.literal("startCommsTest") }),
  z.object({ action: z.literal("setBatchSize"), batchSize: z.number().int().min(1) }),
  z.object({
    action: z.literal("recordManualCheck"),
    checkCode: z.string().min(1),
    result: z.enum(["PASS", "FAIL", "PENDING"]),
    notes: z.string().nullish(),
    evidence: z.record(z.string(), z.unknown()).nullish(),
  }),
  z.object({ action: z.literal("approve"), overrideReason: z.string().nullish() }),
]);

router.put(
  "/ewater/hhc/meters/:assetId/commissioning",
  requireOperatorAuth(),
  handle(async (req, res) => {
    if (!requireCreds(res)) return;
    const assetId = String(req.params["assetId"]);
    const operator = operatorOf(res).name;

    const parsed = updateCommissioningSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: `Invalid body: ${parsed.error.issues.map((i) => i.message).join("; ")}` });
      return;
    }
    const body = parsed.data;
    try {
      switch (body.action) {
        case "setStage":
          await setStage(assetId, body.stage, operator);
          break;
        case "startCommsTest":
          await startCommsTest(assetId, operator);
          break;
        case "setBatchSize":
          await setBatchSize(assetId, body.batchSize, operator);
          break;
        case "recordManualCheck":
          await recordManualCheck(assetId, body.checkCode, body.result, operator, body.notes ?? null, body.evidence ?? null);
          break;
        case "approve": {
          const claims = operatorOf(res);
          const override = body.overrideReason?.trim() ? { reason: body.overrideReason.trim() } : null;
          // Overriding mandatory blockers is a privileged action — enforce the
          // admin role server-side (verified token claims, not client input).
          if (override && claims.role !== "admin") {
            res.status(403).json({ error: "Overriding commissioning blockers requires the admin role" });
            return;
          }
          await approveCommissioning(assetId, operator, override, claims.role);
          break;
        }
      }
    } catch (err) {
      if (sendCommissioningError(res, err)) return;
      throw err;
    }
    cache.delete(`commissioning:${assetId}`);
    const result = await getCommissioningDetail(assetId);
    cache.set(`commissioning:${assetId}`, { expiresAt: Date.now() + CACHE_TTL_MS, value: result });
    res.json({
      ...result,
      fetchedAt: new Date().toISOString(),
      sourceObservedAt: result.connectivity.lastValidPacketAt,
    });
  }),
);

// ── GET /api/ewater/hhc/config ───────────────────────────────────────────────

router.get(
  "/ewater/hhc/config",
  handle(async (_req, res) => {
    const config = await getHhcConfiguration();
    res.json({ ...config, fetchedAt: new Date().toISOString() });
  }),
);

// ── PUT /api/ewater/hhc/config (admin only) ──────────────────────────────────

const configUpdateSchema = z
  .object({
    batteryCriticalVoltage: z.number().positive().optional(),
    batteryWarningVoltage: z.number().positive().optional(),
    gate3SamplePct: z.number().min(0).max(100).optional(),
    rtcToleranceSeconds: z.number().int().min(0).nullable().optional(),
    requiredOverdraftLitres: z.number().min(0).optional(),
    tariffKesPer1000L: z.number().min(0).optional(),
  })
  .strict();

router.put(
  "/ewater/hhc/config",
  requireOperatorAuth("admin"),
  handle(async (req, res) => {
    const operator = operatorOf(res).name;
    const parsed = configUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: `Invalid body: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` });
      return;
    }
    const config = await updateHhcConfiguration(parsed.data, operator);
    // Config drives auto-check thresholds — invalidate cached commissioning results.
    for (const key of cache.keys()) if (key.startsWith("commissioning:")) cache.delete(key);
    res.json({ ...config, fetchedAt: new Date().toISOString() });
  }),
);

// ── POST /api/ewater/hhc/meters/:assetId/parts/modem-iccid ───────────────────
// Proxies to Pulse POST /api/Parts/UpdateModemIccid so the Pulse parts
// inventory stays in sync when a technician records/verifies a modem ICCID.

const modemIccidSchema = z
  .object({
    iccid: z.string().min(10).max(30).regex(/^[0-9A-Fa-f]+$/, "ICCID must be hexadecimal digits"),
  })
  .strict();

router.post(
  "/ewater/hhc/meters/:assetId/parts/modem-iccid",
  requireOperatorAuth(),
  handle(async (req, res) => {
    if (!requireCreds(res)) return;
    const assetId = String(req.params["assetId"]);
    const operator = operatorOf(res).name;
    const parsed = modemIccidSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: `Invalid body: ${parsed.error.issues.map((i) => i.message).join("; ")}` });
      return;
    }
    const { iccid } = parsed.data;
    const pulse = await pulseFetch("/api/Parts/UpdateModemIccid", {
      method: "POST",
      body: JSON.stringify({ assetId: Number(assetId) || assetId, iccid }),
    });
    const ok = pulse.status >= 200 && pulse.status < 300;
    await recordAudit(assetId, "modem-iccid-recorded", operator, null, {
      iccid,
      pulseStatus: pulse.status,
      pulseOk: ok,
    });
    if (!ok) {
      res.status(502).json({
        error: `Pulse UpdateModemIccid failed with status ${pulse.status}`,
        pulseStatus: pulse.status,
        pulseResponse: pulse.data ?? null,
      });
      return;
    }
    res.json({ ok: true, iccid, pulseStatus: pulse.status, pulseResponse: pulse.data ?? null, fetchedAt: new Date().toISOString() });
  }),
);

// ── GET /api/ewater/hhc/parts/job-types ──────────────────────────────────────

router.get(
  "/ewater/hhc/parts/job-types",
  handle(async (_req, res) => {
    if (!requireCreds(res)) return;
    const result = await cached("pulse:job-types", () => pulseFetch("/api/jobs/JobTypes", { method: "GET" }));
    if (result.status < 200 || result.status >= 300) {
      res.status(502).json({ error: `Pulse JobTypes failed with status ${result.status}` });
      return;
    }
    res.json({ jobTypes: result.data ?? [], fetchedAt: new Date().toISOString() });
  }),
);

export default router;
