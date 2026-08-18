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
import { getCredentials } from "../lib/ewater-client";
import {
  listHouseholdMeters,
  getHouseholdMeter,
  getHouseholdMeterState,
  getHouseholdMeterHistory,
  getHouseholdMeterCommunications,
  getHouseholdMeterCommissioningStatus,
  type HistoryPeriod,
} from "../lib/hhc-insights";

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
      limit: numQ(req.query["limit"]),
      offset: numQ(req.query["offset"]),
    };
    const key = `comms:${assetId}:${JSON.stringify(options)}`;
    const page = await cached(key, () => getHouseholdMeterCommunications(assetId, options));
    res.json({ ...page, fetchedAt: new Date().toISOString() });
  }),
);

// ── GET /api/ewater/hhc/meters/:assetId/commissioning ────────────────────────

router.get(
  "/ewater/hhc/meters/:assetId/commissioning",
  handle(async (req, res) => {
    if (!requireCreds(res)) return;
    const assetId = String(req.params["assetId"]);
    const result = await cached(`commissioning:${assetId}`, () =>
      getHouseholdMeterCommissioningStatus(assetId),
    );
    res.json({
      ...result,
      fetchedAt: new Date().toISOString(),
      sourceObservedAt: result.connectivity.lastValidPacketAt,
    });
  }),
);

export default router;
