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

router.get("/ewater/assets", async (req, res): Promise<void> => {
  if (!getCredentials()) {
    res.status(401).json({ error: "No credentials configured" });
    return;
  }

  try {
    const candidates = [
      { api: "query", path: "/api/Asset/GetAll" },
      { api: "query", path: "/api/Tap/GetAll" },
      { api: "query", path: "/api/CommunityTap/GetAll" },
      { api: "state", path: "/api/Asset/GetAll" },
    ];

    for (const { api, path } of candidates) {
      const result = await ewaterFetch(api, path).catch(() => null);
      if (result && result.status === 200 && Array.isArray(result.data)) {
        const assets = (result.data as Record<string, unknown>[]).map(normaliseAsset);
        res.json(assets);
        return;
      }
      if (result && result.status === 200 && result.data && typeof result.data === "object") {
        const obj = result.data as Record<string, unknown>;
        const arr = obj["items"] ?? obj["data"] ?? obj["assets"] ?? obj["taps"] ?? obj["results"];
        if (Array.isArray(arr)) {
          res.json((arr as Record<string, unknown>[]).map(normaliseAsset));
          return;
        }
      }
    }

    res.json([]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Failed to fetch assets");
    res.status(502).json({ error: `eWater API error: ${msg}` });
  }
});

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

  const { assetId } = params.data;

  try {
    const candidates = [
      { api: "query", path: `/api/Asset/Get?id=${encodeURIComponent(assetId)}` },
      { api: "query", path: `/api/Asset/${encodeURIComponent(assetId)}` },
      { api: "state", path: `/api/Asset/Get?id=${encodeURIComponent(assetId)}` },
    ];

    for (const { api, path } of candidates) {
      const result = await ewaterFetch(api, path).catch(() => null);
      if (result && result.status === 200 && result.data && typeof result.data === "object") {
        const raw = result.data as Record<string, unknown>;
        res.json(normaliseAsset(raw));
        return;
      }
    }

    res.status(404).json({ error: "Asset not found" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Failed to fetch asset");
    res.status(502).json({ error: `eWater API error: ${msg}` });
  }
});

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

  const { assetId } = params.data;

  try {
    const candidates = [
      { api: "state", path: `/api/Telemetry/GetByAsset?assetId=${encodeURIComponent(assetId)}` },
      { api: "state", path: `/api/Log/GetByAsset?assetId=${encodeURIComponent(assetId)}` },
      { api: "query", path: `/api/Telemetry/GetByAsset?assetId=${encodeURIComponent(assetId)}` },
    ];

    for (const { api, path } of candidates) {
      const result = await ewaterFetch(api, path).catch(() => null);
      if (result && result.status === 200) {
        const rows = Array.isArray(result.data)
          ? (result.data as Record<string, unknown>[])
          : extractArray(result.data);
        res.json(rows.map((r) => normaliseTelemetry(r, assetId)));
        return;
      }
    }

    res.json([]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Failed to fetch telemetry");
    res.status(502).json({ error: `eWater API error: ${msg}` });
  }
});

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
    const candidates = [
      { api: "query", path: "/api/Dashboard/GetSummary" },
      { api: "query", path: "/api/Health/GetSummary" },
      { api: "query", path: "/api/Asset/GetSummary" },
    ];

    for (const { api, path } of candidates) {
      const result = await ewaterFetch(api, path).catch(() => null);
      if (result && result.status === 200 && result.data && typeof result.data === "object") {
        const raw = result.data as Record<string, unknown>;
        res.json(normaliseDashboard(raw));
        return;
      }
    }

    const assetsResult = await ewaterFetch("query", "/api/Asset/GetAll").catch(() => null);
    if (assetsResult && assetsResult.status === 200) {
      const rows = Array.isArray(assetsResult.data)
        ? (assetsResult.data as Record<string, unknown>[])
        : extractArray(assetsResult.data);
      const assets = rows.map(normaliseAsset);
      const online = assets.filter((a) => a.isOnline === true).length;
      const offline = assets.filter((a) => a.isOnline === false).length;
      const faults = assets.filter((a) => a.hasPowerFault || a.hasFlowFault).length;
      const powerFaults = assets.filter((a) => a.hasPowerFault).length;
      const flowFaults = assets.filter((a) => a.hasFlowFault).length;

      res.json({
        totalAssets: assets.length,
        onlineCount: online,
        offlineCount: offline,
        faultCount: faults,
        powerFaultCount: powerFaults,
        flowFaultCount: flowFaults,
        lastUpdated: new Date().toISOString(),
        recentAlerts: assets
          .filter((a) => a.hasPowerFault || a.hasFlowFault)
          .slice(0, 5)
          .map((a, i) => ({
            id: `alert-${i}`,
            assetId: a.id,
            assetName: a.name,
            message: a.hasPowerFault ? "Power fault detected" : "Flow fault detected",
            severity: "warning",
            timestamp: a.lastSeen ?? new Date().toISOString(),
          })),
      });
      return;
    }

    res.json({
      totalAssets: 0,
      onlineCount: 0,
      offlineCount: 0,
      faultCount: 0,
      powerFaultCount: 0,
      flowFaultCount: 0,
      lastUpdated: new Date().toISOString(),
      recentAlerts: [],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `eWater API error: ${msg}` });
  }
});

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
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    res.json({ status: result.status, data: result.data ?? {} });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Proxy request failed");
    res.status(502).json({ error: `eWater API error: ${msg}` });
  }
});

function normaliseAsset(raw: Record<string, unknown>) {
  const id = String(
    raw["id"] ?? raw["Id"] ?? raw["assetId"] ?? raw["AssetId"] ?? raw["tapId"] ?? ""
  );
  const name = String(
    raw["name"] ?? raw["Name"] ?? raw["assetName"] ?? raw["AssetName"] ?? raw["tapName"] ?? id
  );

  return {
    id,
    name,
    type: strOrNull(raw["type"] ?? raw["Type"] ?? raw["assetType"] ?? raw["AssetType"]),
    status: strOrNull(raw["status"] ?? raw["Status"] ?? raw["state"] ?? raw["State"]),
    isOnline: boolOrNull(raw["isOnline"] ?? raw["IsOnline"] ?? raw["online"] ?? raw["Online"] ?? raw["connected"] ?? raw["Connected"]),
    location: strOrNull(raw["location"] ?? raw["Location"] ?? raw["address"] ?? raw["Address"]),
    lastSeen: strOrNull(raw["lastSeen"] ?? raw["LastSeen"] ?? raw["lastContact"] ?? raw["LastContact"] ?? raw["lastUpdate"] ?? raw["LastUpdate"]),
    batteryVoltage: numOrNull(raw["batteryVoltage"] ?? raw["BatteryVoltage"] ?? raw["voltage"] ?? raw["Voltage"]),
    signalStrength: numOrNull(raw["signalStrength"] ?? raw["SignalStrength"] ?? raw["rssi"] ?? raw["Rssi"] ?? raw["RSSI"]),
    hasPowerFault: boolOrNull(raw["hasPowerFault"] ?? raw["HasPowerFault"] ?? raw["powerFault"] ?? raw["PowerFault"]),
    hasFlowFault: boolOrNull(raw["hasFlowFault"] ?? raw["HasFlowFault"] ?? raw["flowFault"] ?? raw["FlowFault"]),
    rawData: raw,
  };
}

function normaliseTelemetry(raw: Record<string, unknown>, fallbackAssetId: string) {
  return {
    id: String(raw["id"] ?? raw["Id"] ?? raw["logId"] ?? raw["LogId"] ?? crypto.randomUUID()),
    assetId: String(raw["assetId"] ?? raw["AssetId"] ?? fallbackAssetId),
    timestamp: String(raw["timestamp"] ?? raw["Timestamp"] ?? raw["receivedAt"] ?? raw["ReceivedAt"] ?? new Date().toISOString()),
    imei: strOrNull(raw["imei"] ?? raw["IMEI"] ?? raw["Imei"]),
    correlationId: strOrNull(raw["correlationId"] ?? raw["CorrelationId"]),
    pipeline: strOrNull(raw["pipeline"] ?? raw["Pipeline"] ?? raw["source"] ?? raw["Source"]),
    payload: strOrNull(raw["payload"] ?? raw["Payload"] ?? raw["data"] ?? raw["Data"]),
    rawData: raw,
  };
}

function normaliseDashboard(raw: Record<string, unknown>) {
  return {
    totalAssets: numOrZero(raw["totalAssets"] ?? raw["TotalAssets"] ?? raw["total"] ?? raw["Total"]),
    onlineCount: numOrZero(raw["onlineCount"] ?? raw["OnlineCount"] ?? raw["online"] ?? raw["Online"]),
    offlineCount: numOrZero(raw["offlineCount"] ?? raw["OfflineCount"] ?? raw["offline"] ?? raw["Offline"]),
    faultCount: numOrZero(raw["faultCount"] ?? raw["FaultCount"] ?? raw["faults"] ?? raw["Faults"]),
    powerFaultCount: numOrZero(raw["powerFaultCount"] ?? raw["PowerFaultCount"]),
    flowFaultCount: numOrZero(raw["flowFaultCount"] ?? raw["FlowFaultCount"]),
    lastUpdated: strOrNull(raw["lastUpdated"] ?? raw["LastUpdated"]) ?? new Date().toISOString(),
    recentAlerts: Array.isArray(raw["recentAlerts"] ?? raw["alerts"] ?? raw["Alerts"]) ? raw["recentAlerts"] as unknown[] : [],
  };
}

function extractArray(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;
  for (const key of ["items", "data", "assets", "taps", "results", "records"]) {
    if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
  }
  return [];
}

function strOrNull(v: unknown): string | null {
  return v != null && v !== "" ? String(v) : null;
}

function boolOrNull(v: unknown): boolean | null {
  if (v == null) return null;
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "true" || v === "True" || v === "1") return true;
  if (v === 0 || v === "false" || v === "False" || v === "0") return false;
  return null;
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
