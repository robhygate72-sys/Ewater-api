import { Router, type IRouter } from "express";
import {
  setCredentials,
  clearCredentials,
  getCredentials,
  getToken,
  getTokenExpiresAt,
  ewaterFetch,
} from "../lib/ewater-client";
import {
  SaveCredentialsBody,
  GetAssetParams,
  FetchAssetTelemetryParams,
  ProxyRequestBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

router.get("/ewater/credentials", async (_req, res): Promise<void> => {
  const creds = getCredentials();
  res.json({
    isConfigured: creds !== null,
    environment: creds ? "live" : null,
    tokenExpiresAt: getTokenExpiresAt(),
  });
});

router.post("/ewater/credentials", async (req, res): Promise<void> => {
  const parsed = SaveCredentialsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  setCredentials({
    clientId: parsed.data.clientId,
    clientSecret: parsed.data.clientSecret,
  });

  try {
    await getToken();
  } catch (err) {
    clearCredentials();
    const msg = err instanceof Error ? err.message : String(err);
    res.status(401).json({ error: `Invalid credentials: ${msg}` });
    return;
  }

  res.json({
    isConfigured: true,
    environment: "live",
    tokenExpiresAt: getTokenExpiresAt(),
  });
});

router.delete("/ewater/credentials", async (_req, res): Promise<void> => {
  clearCredentials();
  res.json({ isConfigured: false, environment: null, tokenExpiresAt: null });
});

// ---------------------------------------------------------------------------
// Assets — list
// GET /api/ewater/assets
// Uses State API: POST /api/Entity/Assets  (AssetsRequest → AssetsResponse)
// ---------------------------------------------------------------------------

router.get("/ewater/assets", async (req, res): Promise<void> => {
  if (!getCredentials()) {
    res.status(401).json({ error: "No credentials configured" });
    return;
  }

  try {
    // Fetch all active lifecycle states
    const result = await ewaterFetch("state", "/api/Entity/Assets", {
      method: "POST",
      body: JSON.stringify({
        assetLifecycleStates: [
          "Active", "Staged", "Demo", "Test", "Suspended",
        ],
      }),
    });

    if (result.status !== 200) {
      req.log.warn({ status: result.status }, "Entity Assets returned non-200");
      // Fallback: GET /api/Entity/List which returns all entity types
      const listResult = await ewaterFetch("state", "/api/Entity/List");
      if (listResult.status === 200 && listResult.data && typeof listResult.data === "object") {
        const d = listResult.data as Record<string, unknown>;
        const assets = Array.isArray(d["assets"])
          ? (d["assets"] as Record<string, unknown>[]).map(normaliseAssetDto)
          : [];
        res.json(assets);
        return;
      }
      res.json([]);
      return;
    }

    const body = result.data as Record<string, unknown>;
    const assets = Array.isArray(body["assets"])
      ? (body["assets"] as Record<string, unknown>[]).map(normaliseAssetDto)
      : [];

    res.json(assets);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Failed to list assets");
    res.status(502).json({ error: `eWater API error: ${msg}` });
  }
});

// ---------------------------------------------------------------------------
// Asset detail
// GET /api/ewater/assets/:assetId
// Uses State: GET /api/Asset/GetAssetBasicInfoByAssetID
//        State: GET /api/Asset/LastKnownHealthStatus
//        Query: GET /api/Asset/AssetConnectivityStatus
//        Query: GET /api/Asset/AssetPowerStatus
// ---------------------------------------------------------------------------

router.get("/ewater/assets/:assetId", async (req, res): Promise<void> => {
  const params = GetAssetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!getCredentials()) {
    res.status(401).json({ error: "No credentials configured" });
    return;
  }

  const id = params.data.assetId;

  try {
    // Fetch in parallel: basic info, health status, connectivity, power
    const [basicRes, healthRes, connRes, powerRes] = await Promise.allSettled([
      ewaterFetch("state", `/api/Asset/GetAssetBasicInfoByAssetID?assetId=${encodeURIComponent(id)}`),
      ewaterFetch("state", `/api/Asset/LastKnownHealthStatus?assetId=${encodeURIComponent(id)}`),
      ewaterFetch("query", `/api/Asset/AssetConnectivityStatus?assetId=${encodeURIComponent(id)}`),
      ewaterFetch("query", `/api/Asset/AssetPowerStatus?assetId=${encodeURIComponent(id)}`),
    ]);

    const basic = basicRes.status === "fulfilled" && basicRes.value.status === 200
      ? (basicRes.value.data as Record<string, unknown>)
      : null;
    const health = healthRes.status === "fulfilled" && healthRes.value.status === 200
      ? (healthRes.value.data as Record<string, unknown>)
      : null;
    const conn = connRes.status === "fulfilled" && connRes.value.status === 200
      ? (connRes.value.data as Record<string, unknown>)
      : null;
    const power = powerRes.status === "fulfilled" && powerRes.value.status === 200
      ? (powerRes.value.data as Record<string, unknown>)
      : null;

    if (!basic) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }

    // Determine online status from lastCommsDt (within 48h = online)
    const lastCommsDt = strOrNull(conn?.["lastCommsDt"]);
    const isOnline = lastCommsDt
      ? Date.now() - new Date(lastCommsDt).getTime() < 48 * 3600 * 1000
      : null;

    res.json({
      id: String(id),
      name: strOrNull(basic["name"]) ?? String(id),
      type: strOrNull(basic["purpose"]),
      status: strOrNull(basic["assetLifecycleState"]),
      isOnline,
      location: formatLocation(numOrNull(basic["latitude"]), numOrNull(basic["longitude"])),
      lastSeen: lastCommsDt,
      batteryVoltage:
        numOrNull(power?.["lastKnownVoltage"]) ??
        numOrNull(health?.["lastKnownVoltageReading"]),
      signalStrength: null,
      hasPowerFault: health ? healthRatingIsFault(strOrNull(health["lastKnownVoltageRating"])) : null,
      hasFlowFault: health ? healthRatingIsFault(strOrNull(health["lastKnownFlowRateRating"])) : null,
      rawData: { basic, health, conn, power },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Failed to get asset detail");
    res.status(502).json({ error: `eWater API error: ${msg}` });
  }
});

// ---------------------------------------------------------------------------
// Asset telemetry / logs
// GET /api/ewater/assets/:assetId/telemetry
// Uses State API: POST /api/Asset/GetLogsForAssetByReceivedDate
// ---------------------------------------------------------------------------

router.get("/ewater/assets/:assetId/telemetry", async (req, res): Promise<void> => {
  const params = FetchAssetTelemetryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!getCredentials()) {
    res.status(401).json({ error: "No credentials configured" });
    return;
  }

  const assetId = params.data.assetId;
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

  try {
    const result = await ewaterFetch("state", "/api/Asset/GetLogsForAssetByReceivedDate", {
      method: "POST",
      body: JSON.stringify({
        assetId: Number(assetId),
        startDate: weekAgo.toISOString(),
        endDate: now.toISOString(),
        pipeline: null,
      }),
    });

    if (result.status !== 200) {
      res.json([]);
      return;
    }

    const body = result.data as Record<string, unknown>;
    const lines = Array.isArray(body["logLines"])
      ? (body["logLines"] as Record<string, unknown>[])
      : [];

    // Return most recent 50 entries
    const entries = lines.slice(-50).reverse().map((l) => ({
      id: String(l["id"] ?? crypto.randomUUID()),
      assetId: String(assetId),
      timestamp: String(l["timeReceived"] ?? new Date().toISOString()),
      imei: null,
      correlationId: strOrNull(l["correlationId"]),
      pipeline: strOrNull(l["pipeline"]),
      payload: strOrNull(l["payload"]),
      rawData: l,
    }));

    res.json(entries);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Failed to fetch telemetry");
    res.status(502).json({ error: `eWater API error: ${msg}` });
  }
});

// ---------------------------------------------------------------------------
// Dashboard
// GET /api/ewater/dashboard
// Uses Query: GET /api/Entity/HealthSnapshots  (EntityHealthSnapshotResponse)
//        Query: GET /api/Entity/FaultSnapshots
// ---------------------------------------------------------------------------

router.get("/ewater/dashboard", async (_req, res): Promise<void> => {
  if (!getCredentials()) {
    res.json({
      totalAssets: 0,
      onlineCount: 0,
      offlineCount: 0,
      faultCount: 0,
      powerFaultCount: 0,
      flowFaultCount: 0,
      lastUpdated: null,
      recentAlerts: [],
    });
    return;
  }

  try {
    const [healthRes, faultRes] = await Promise.allSettled([
      ewaterFetch("query", "/api/Entity/HealthSnapshots"),
      ewaterFetch("query", "/api/Entity/FaultSnapshots"),
    ]);

    const healthData = healthRes.status === "fulfilled" && healthRes.value.status === 200
      ? (healthRes.value.data as Record<string, unknown>)
      : null;
    const faultData = faultRes.status === "fulfilled" && faultRes.value.status === 200
      ? (faultRes.value.data as Record<string, unknown>)
      : null;

    // EntityHealthSnapshotResponse { snapshot: EntityHealthSnapshot }
    // EntityHealthSnapshot { totalAssetsCount, healthyAssetsCount, unhealthyAssetsCount, unknownAssetsCount, lastUpdatedDt }
    const snapshot = (healthData?.["snapshot"] as Record<string, unknown> | null) ??
      (Array.isArray(healthData) ? (healthData[0] as Record<string, unknown>) : null);

    const faultSnapshot = (faultData?.["snapshot"] as Record<string, unknown> | null) ??
      (Array.isArray(faultData) ? (faultData[0] as Record<string, unknown>) : null);

    const total = numOrZero(snapshot?.["totalAssetsCount"]);
    const healthy = numOrZero(snapshot?.["healthyAssetsCount"]);
    const unhealthy = numOrZero(snapshot?.["unhealthyAssetsCount"]);
    const unknown = numOrZero(snapshot?.["unknownAssetsCount"]);
    const offline = unhealthy;
    const online = healthy;

    // healthFactorSnapshots is an array of { healthFactor, goodCount, okCount, poorCount }
    const factorSnapshots = Array.isArray(snapshot?.["healthFactorSnapshots"])
      ? (snapshot!["healthFactorSnapshots"] as Record<string, unknown>[])
      : [];

    const powerFactor = factorSnapshots.find(
      (f) => String(f["healthFactor"]).toLowerCase().includes("power") ||
             String(f["healthFactor"]).toLowerCase().includes("voltage")
    );
    const flowFactor = factorSnapshots.find(
      (f) => String(f["healthFactor"]).toLowerCase().includes("flow")
    );
    const powerFaultCount = numOrZero(powerFactor?.["poorCount"]);
    const flowFaultCount = numOrZero(flowFactor?.["poorCount"]);

    // Build alerts from unhealthy factor counts
    const alerts: Array<{
      id: string;
      assetId: string;
      assetName: string | null;
      message: string;
      severity: string;
      timestamp: string;
    }> = [];

    for (const factor of factorSnapshots) {
      const poorCount = numOrZero(factor["poorCount"]);
      if (poorCount > 0) {
        alerts.push({
          id: `alert-${factor["healthFactor"]}`,
          assetId: "system",
          assetName: null,
          message: `${poorCount} asset(s) have poor ${factor["healthFactor"]} status`,
          severity: poorCount > 5 ? "error" : "warning",
          timestamp: strOrNull(snapshot?.["lastUpdatedDt"]) ?? new Date().toISOString(),
        });
      }
    }

    res.json({
      totalAssets: total,
      onlineCount: online,
      offlineCount: offline,
      faultCount: unhealthy,
      powerFaultCount,
      flowFaultCount,
      lastUpdated: strOrNull(snapshot?.["lastUpdatedDt"]) ?? new Date().toISOString(),
      recentAlerts: alerts.slice(0, 10),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `eWater API error: ${msg}` });
  }
});

// ---------------------------------------------------------------------------
// Generic proxy
// POST /api/ewater/proxy
// ---------------------------------------------------------------------------

router.post("/ewater/proxy", async (req, res): Promise<void> => {
  const parsed = ProxyRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!getCredentials()) {
    res.status(401).json({ error: "No credentials configured" });
    return;
  }

  const { api, path, method, body } = parsed.data;

  try {
    const result = await ewaterFetch(api, path, {
      method: method.toUpperCase(),
      ...(body && Object.keys(body).length > 0 ? { body: JSON.stringify(body) } : {}),
    });

    res.json({ status: result.status, data: result.data ?? {} });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Proxy request failed");
    res.status(502).json({ error: `eWater API error: ${msg}` });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normaliseAssetDto(raw: Record<string, unknown>) {
  return {
    id: String(raw["id"] ?? ""),
    name: strOrNull(raw["name"]) ?? String(raw["id"] ?? ""),
    type: strOrNull(raw["purpose"]),
    status: strOrNull(raw["assetLifecycleState"]),
    isOnline: null,
    location: formatLocation(numOrNull(raw["latitude"]), numOrNull(raw["longitude"])),
    lastSeen: null,
    batteryVoltage: null,
    signalStrength: null,
    hasPowerFault: null,
    hasFlowFault: null,
    rawData: raw,
  };
}

function formatLocation(lat: number | null, lon: number | null): string | null {
  if (lat == null || lon == null) return null;
  if (lat === 0 && lon === 0) return null;
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

function healthRatingIsFault(rating: string | null): boolean | null {
  if (!rating) return null;
  const r = rating.toLowerCase();
  return r === "poor" || r === "bad" || r === "critical" || r === "fault";
}

function strOrNull(v: unknown): string | null {
  return v != null && v !== "" ? String(v) : null;
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function numOrZero(v: unknown): number {
  return numOrNull(v) ?? 0;
}

export default router;
