import { Router, type IRouter } from "express";
import {
  setCredentials,
  clearCredentials,
  getCredentials,
  getToken,
  getTokenExpiresAt,
  getCredentialGeneration,
  ewaterFetch,
} from "../lib/ewater-client";
import {
  SaveCredentialsBody,
  GetAssetParams,
  FetchAssetTelemetryParams,
  ProxyRequestBody,
  GetESenseChartsQueryParams,
  ApplyAssetCalibrationBody,
  GetAssetUdpHealthParams,
  GetAssetUdpHealthResponse,
} from "@workspace/api-zod";
import { db, alertRulesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  listAssets,
  getAssetEwcSettings,
  getAssetFlowRate,
  getAssetEsenseCharts,
  fetchTicksPerLitre,
  fetchAssetImeis,
  fetchAllKnownImeis,
  discoverImeisFromLogs,
  extractImeiFromLogSource,
  fetchAssetLcf,
  getRawPacketLogs,
  getRegisteredTagIds,
  getTagInfo,
  getHouseholdInfo,
  getTagUsage,
  getDisbursementsByTagAndAsset,
  getDisbursementsByTag,
  getDisbursementsByAsset,
  strOrNull,
  numOrNull,
  numOrZero,
  round2,
  formatLocation,
  healthRatingIsFault,
  normaliseAssetDto,
} from "../lib/ewater-insights";
import { tryDecodeShengdaLwm2m } from "../lib/shengda-nbiot-decoder";
import { getAssetUdpHealth } from "../lib/udp-modem-health";

const router: IRouter = Router();

// ── Tiny TTL caches for the heavy asset-tech bundle ──────────────────────────
// The tech endpoint fans out to ~12 eWater calls; repeat visits within the
// TTL are served instantly. Discovered IMEIs and the Entity/List are much
// more stable than live telemetry, so they get longer TTLs.
const techCache = new Map<string, { expiresAt: number; value: unknown }>();
const TECH_TTL_MS = 30_000;
const IMEI_TTL_MS = 10 * 60_000;
const ENTITY_TTL_MS = 5 * 60_000;

// Cache entries are namespaced by credential generation, so changing or
// clearing eWater credentials instantly invalidates everything cached under
// the previous account — one account's data is never served to another.
let cacheGeneration = getCredentialGeneration();

function genKey(key: string): string {
  const gen = getCredentialGeneration();
  if (gen !== cacheGeneration) {
    techCache.clear();
    cacheGeneration = gen;
  }
  return `${gen}:${key}`;
}

function ttlGet<T>(map: Map<string, { expiresAt: number; value: unknown }>, key: string): T | undefined {
  const k = genKey(key);
  const hit = map.get(k);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  map.delete(k);
  return undefined;
}

function ttlSet(map: Map<string, { expiresAt: number; value: unknown }>, key: string, value: unknown, ttlMs: number): void {
  // Opportunistic sweep so long-running servers don't accumulate stale entries.
  if (map.size > 500) {
    const now = Date.now();
    for (const [k, v] of map) if (v.expiresAt <= now) map.delete(k);
  }
  map.set(genKey(key), { expiresAt: Date.now() + ttlMs, value });
}

async function cachedDiscoverImeis(assetId: string): Promise<string[]> {
  const key = `imeis:${assetId}`;
  const hit = ttlGet<string[]>(techCache, key);
  if (hit) return hit;
  const imeis = await discoverImeisFromLogs(assetId);
  // Only cache non-empty results for the long TTL — an empty answer may just
  // mean the log scan transiently failed, and must not stick for 10 minutes.
  if (imeis.length > 0) ttlSet(techCache, key, imeis, IMEI_TTL_MS);
  return imeis;
}

async function cachedEntityList(): Promise<PromiseSettledResult<{ status: number; data: unknown }>> {
  const key = "entity-list";
  const hit = ttlGet<{ status: number; data: unknown }>(techCache, key);
  if (hit) return { status: "fulfilled", value: hit };
  try {
    const res = await ewaterFetch("state", "/api/Entity/List");
    if (res.status === 200) ttlSet(techCache, key, res, ENTITY_TTL_MS);
    return { status: "fulfilled", value: res };
  } catch (err) {
    return { status: "rejected", reason: err };
  }
}

// ---------------------------------------------------------------------------
// UDP modem health
// GET /api/ewater/assets/:assetId/udp-health
// Resolves only the selected asset's known IMEIs. Each upstream modem lookup is
// independently bounded and cached in udp-modem-health.ts.
// ---------------------------------------------------------------------------

router.get("/ewater/assets/:assetId/udp-health", async (req, res): Promise<void> => {
  const params = GetAssetUdpHealthParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!getCredentials()) {
    res.status(401).json({ error: "No credentials configured" });
    return;
  }

  const assetId = params.data.assetId;
  const imeis = await fetchAllKnownImeis(assetId);
  const result = await getAssetUdpHealth(assetId, imeis);
  res.json(GetAssetUdpHealthResponse.parse(result));
});

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
    username: parsed.data.username,
    password: parsed.data.password,
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
    res.json(await listAssets());
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
// Raw packet logs (NB-IoT meter protocol inspection)
// GET /api/ewater/assets/:assetId/packets?hours=24&limit=50
// Uses State: POST /api/Logs/GetLogsInDateRangeByImei
//             GET  /api/Logs/DescribeRawData?data=<b64>
// ---------------------------------------------------------------------------

router.get("/ewater/assets/:assetId/packets", async (req, res): Promise<void> => {
  const params = GetAssetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!getCredentials()) {
    res.status(401).json({ error: "No credentials configured" });
    return;
  }

  const assetId = params.data.assetId;
  const hours = Math.min(Math.max(Number(req.query["hours"] ?? 24), 1), 72);
  const maxEntries = Math.min(Math.max(Number(req.query["limit"] ?? 50), 1), 100);
  const imeiFilter = strOrNull(req.query["imei"]);

  try {
    // Use every known IMEI (registered + discovered from recent log traffic)
    // so secondary devices like a Shengda NB-IoT meter — which never gets
    // registered in eWater's identifiers API — still show up here.
    const imeis = await fetchAllKnownImeis(assetId);
    if (imeis.length === 0) {
      res.json([]);
      return;
    }
    if (imeiFilter && !imeis.includes(imeiFilter)) {
      res.status(400).json({ error: "IMEI is not registered for this asset" });
      return;
    }

    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - hours * 3600 * 1000);

    const packets = await getRawPacketLogs(imeiFilter ? [imeiFilter] : imeis, startDate, endDate, maxEntries);
    res.json(packets);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Failed to fetch raw packet logs");
    res.status(502).json({ error: `eWater API error: ${msg}` });
  }
});

// ---------------------------------------------------------------------------
// Entity hierarchy
// GET /api/ewater/entities
// Uses State: GET /api/Entity/List
// ---------------------------------------------------------------------------

router.get("/ewater/entities", async (req, res): Promise<void> => {
  if (!getCredentials()) {
    res.status(401).json({ error: "No credentials configured" });
    return;
  }

  try {
    const result = await ewaterFetch("state", "/api/Entity/List");
    if (result.status !== 200) {
      res.status(502).json({ error: "Failed to fetch entity list" });
      return;
    }

    const ed = result.data as Record<string, unknown>;
    const countries = Array.isArray(ed["countries"]) ? (ed["countries"] as Record<string, unknown>[]) : [];
    const orgs = Array.isArray(ed["organisations"]) ? (ed["organisations"] as Record<string, unknown>[]) : [];
    const waterSystems = Array.isArray(ed["waterSystems"]) ? (ed["waterSystems"] as Record<string, unknown>[]) : [];
    const assets = Array.isArray(ed["assets"]) ? (ed["assets"] as Record<string, unknown>[]) : [];

    const countryById = new Map(countries.map((c) => [Number(c["id"]), strOrNull(c["name"]) ?? ""]));
    const orgById = new Map(orgs.map((o) => [Number(o["id"]), { name: strOrNull(o["name"]) ?? "", parentId: Number(o["parentId"]) }]));

    // Count assets per water system
    const assetCountByWs = new Map<number, number>();
    for (const a of assets) {
      const wsId = Number(a["parentId"]);
      assetCountByWs.set(wsId, (assetCountByWs.get(wsId) ?? 0) + 1);
    }

    // Build country → water systems map
    const countryMap = new Map<number, { id: number; name: string; waterSystems: { id: number; name: string; assetCount: number }[] }>();
    for (const c of countries) {
      countryMap.set(Number(c["id"]), { id: Number(c["id"]), name: strOrNull(c["name"]) ?? "", waterSystems: [] });
    }

    for (const ws of waterSystems) {
      const wsId = Number(ws["id"]);
      const wsName = strOrNull(ws["name"]) ?? "";
      const parentId = Number(ws["parentId"]);
      const org = orgById.get(parentId);
      const countryId = org ? org.parentId : parentId;
      const country = countryMap.get(countryId);
      if (country) {
        country.waterSystems.push({ id: wsId, name: wsName, assetCount: assetCountByWs.get(wsId) ?? 0 });
      }
    }

    const result2 = {
      countries: [...countryMap.values()]
        .filter((c) => c.waterSystems.length > 0)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ ...c, waterSystems: c.waterSystems.sort((a, b) => a.name.localeCompare(b.name)) })),
    };

    res.json(result2);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Failed to fetch entity hierarchy");
    res.status(502).json({ error: `eWater API error: ${msg}` });
  }
});

// ---------------------------------------------------------------------------
// Asset EWC settings (FCF, LCF, FX, Preload, price of water)
// GET /api/ewater/assets/:assetId/ewc
// ---------------------------------------------------------------------------

router.get("/ewater/assets/:assetId/ewc", async (req, res): Promise<void> => {
  const params = GetAssetParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!getCredentials()) { res.status(401).json({ error: "No credentials configured" }); return; }

  const id = params.data.assetId;
  try {
    res.json(await getAssetEwcSettings(id));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Failed to fetch EWC settings");
    res.status(502).json({ error: `eWater API error: ${msg}` });
  }
});

// ---------------------------------------------------------------------------
// Asset tech status bundle
// GET /api/ewater/assets/:assetId/tech
// Parallel fetch: connectivity, power, flow, usage, status values, firmware,
//   identifiers, commands from State + Query APIs
// ---------------------------------------------------------------------------

router.get("/ewater/assets/:assetId/tech", async (req, res): Promise<void> => {
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
  const idNum = Number(id);

  // Serve a recent copy instantly — the fan-out below is expensive.
  const cachedTech = ttlGet<Record<string, unknown>>(techCache, `tech:${id}`);
  if (cachedTech) {
    res.json(cachedTech);
    return;
  }

  try {
    const [
      [basicRes, connRes, powerRes, flowRes, usageRes, statusRes, firmwareRes, identifiersRes, commandsRes, settingsRes],
      entityRes,
      discoveredImeis,
    ] = await Promise.all([
      Promise.allSettled([
        ewaterFetch("state", `/api/Asset/GetAssetBasicInfoByAssetID?assetId=${encodeURIComponent(id)}`),
        ewaterFetch("query", `/api/Asset/AssetConnectivityStatus?assetId=${encodeURIComponent(id)}`),
        ewaterFetch("query", `/api/Asset/AssetPowerStatus?assetId=${encodeURIComponent(id)}`),
        ewaterFetch("query", `/api/Asset/AssetFlowStatus?assetId=${encodeURIComponent(id)}`),
        ewaterFetch("query", `/api/Asset/AssetUsageStatus?assetId=${encodeURIComponent(id)}`),
        ewaterFetch("state", `/api/Asset/GetStatusValuesForAsset?assetId=${encodeURIComponent(id)}`),
        ewaterFetch("state", `/api/Asset/GetFirmwareStatusByAssetId?assetId=${encodeURIComponent(id)}`),
        ewaterFetch("state", `/api/Asset/GetIdentifiersByAssetId?assetId=${encodeURIComponent(idNum)}`),
        ewaterFetch("state", `/api/Asset/GetCommandsForAsset?assetId=${encodeURIComponent(id)}&pageSize=20&pageIndex=0`),
        ewaterFetch("state", `/api/Asset/GetSettingsMapForAsset?assetId=${encodeURIComponent(id)}`),
      ]),
      // Fleet-wide entity list changes rarely — served from a 5-minute cache.
      cachedEntityList(),
      // Run alongside the batch above (not after it) — this is an extra
      // eWater call purely to catch secondary devices (e.g. a Shengda
      // NB-IoT meter) missing from the identifiers registry below.
      // Discovered IMEIs are stable, so results are cached for 10 minutes.
      cachedDiscoverImeis(id),
    ]);

    const ok = <T>(r: PromiseSettledResult<{ status: number; data: unknown }>): T | null =>
      r.status === "fulfilled" && r.value.status === 200 ? (r.value.data as T) : null;

    // Only a COMPLETE bundle may be cached — if any upstream source failed or
    // timed out, the degraded payload (nulls where data should be) is served
    // once but never replayed from cache for the next 30 seconds.
    const bundleComplete = [
      basicRes, connRes, powerRes, flowRes, usageRes, statusRes,
      firmwareRes, identifiersRes, commandsRes, settingsRes, entityRes,
    ].every((r) => r.status === "fulfilled" && r.value.status === 200);

    const basic = ok<Record<string, unknown>>(basicRes);
    if (!basic) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }

    const conn    = ok<Record<string, unknown>>(connRes);
    const power   = ok<Record<string, unknown>>(powerRes);
    const flow    = ok<Record<string, unknown>>(flowRes);
    const usage   = ok<Record<string, unknown>>(usageRes);
    const status  = ok<Record<string, unknown>>(statusRes);
    const firmwareRaw = ok<Record<string, unknown>>(firmwareRes);
    const identifiers = ok<Record<string, unknown>>(identifiersRes);
    const commandsRaw = ok<Record<string, unknown>>(commandsRes);

    // Resolve water system + country from entity list
    let waterSystemName: string | null = null;
    let countryName: string | null = null;
    const entityData = ok<Record<string, unknown>>(entityRes);
    if (entityData && basic["parentId"] != null) {
      const wsParentId = Number(basic["parentId"]);
      const countries = Array.isArray(entityData["countries"]) ? (entityData["countries"] as Record<string, unknown>[]) : [];
      const orgs = Array.isArray(entityData["organisations"]) ? (entityData["organisations"] as Record<string, unknown>[]) : [];
      const waterSystems = Array.isArray(entityData["waterSystems"]) ? (entityData["waterSystems"] as Record<string, unknown>[]) : [];
      const countryById = new Map(countries.map((c) => [Number(c["id"]), strOrNull(c["name"]) ?? ""]));
      const orgById = new Map(orgs.map((o) => [Number(o["id"]), Number(o["parentId"])]));
      const ws = waterSystems.find((w) => Number(w["id"]) === wsParentId);
      if (ws) {
        waterSystemName = strOrNull(ws["name"]);
        const wsParent = Number(ws["parentId"]);
        const orgCountryId = orgById.get(wsParent);
        const countryId = orgCountryId ?? wsParent;
        countryName = countryById.get(countryId) ?? null;
      }
    }

    // Parse status values (tamper, health flags)
    const statusValues = Array.isArray(status?.["statusValues"])
      ? (status!["statusValues"] as Record<string, unknown>[])
      : Array.isArray(status) ? (status as Record<string, unknown>[]) : [];

    const findStatusVal = (key: string) => {
      const entry = statusValues.find((sv) =>
        String(sv["statusValueType"] ?? sv["key"] ?? "").toLowerCase().includes(key.toLowerCase())
      );
      return entry ? strOrNull(entry["value"] ?? entry["currentValue"]) : null;
    };

    // Status values: real shape is { data: { tamperSwitchState: {value,date}, healthFlags: {value,date}, ... } }
    const statusData = status?.["data"] as Record<string, Record<string, unknown>> | null | undefined;
    const healthFlags = strOrNull(statusData?.["healthFlags"]?.["value"]);
    const tamperSwitchState = strOrNull(statusData?.["tamperSwitchState"]?.["value"]);

    // Firmware devices: real field is deviceChanges
    const fwDevices = Array.isArray(firmwareRaw?.["deviceChanges"])
      ? (firmwareRaw!["deviceChanges"] as Record<string, unknown>[])
      : [];

    const firmware = fwDevices.map((d) => ({
      deviceType: strOrNull(d["deviceType"]) ?? "Unknown",
      version: strOrNull(d["lastKnownFirmwareName"]),
      phase: strOrNull(d["commandPhase"]),
      lastKnownDate: strOrNull(d["lastKnownDate"]),
    }));

    // Identifiers: real shape is { identifiers: [{assetId, imei, modemType, createdDate}] }
    // An asset can have more than one IMEI over its lifetime (e.g. after a device swap).
    const idList = Array.isArray(identifiers?.["identifiers"])
      ? (identifiers!["identifiers"] as Record<string, unknown>[])
      : [];
    const registeredImeis: string[] = [];
    for (const entry of idList) {
      const imei = strOrNull(entry["imei"]);
      if (imei && !registeredImeis.includes(imei)) registeredImeis.push(imei);
    }
    // eWater's identifiers registry only tracks the primary EWC controller —
    // a secondary device on the same asset (e.g. a Shengda NB-IoT prepaid
    // meter) can report under its own IMEI without ever being registered
    // there, so merge in any additional IMEIs seen in recent log traffic
    // (fetched concurrently above via `discoveredImeis`).
    const imeis = [...registeredImeis];
    for (const imei of discoveredImeis) {
      if (!imeis.includes(imei)) imeis.push(imei);
    }

    // Recent commands: real shape is { commands: [{id, correlationId, createdDate, state, priority, retryCount}] }
    const cmdList = Array.isArray(commandsRaw?.["commands"])
      ? (commandsRaw!["commands"] as Record<string, unknown>[])
      : [];

    const recentCommands = cmdList.slice(0, 15).map((c) => ({
      id: String(c["id"] ?? crypto.randomUUID()),
      command: strOrNull(c["state"]),       // no command type — state is most useful
      phase: strOrNull(c["priority"]),      // reusing phase field for priority
      createdDt: strOrNull(c["createdDate"]),
      correlationId: strOrNull(c["correlationId"]),
    }));

    // Round voltage to 2dp to avoid floating point noise
    const round2 = (n: number | null) => n != null ? Math.round(n * 100) / 100 : null;

    const techPayload = {
      assetId: id,
      name: strOrNull(basic["name"]) ?? id,
      lifecycleState: strOrNull(basic["assetLifecycleState"]),
      purpose: strOrNull(basic["purpose"]),
      waterSystemName,
      countryName,
      latitude: numOrNull(basic["latitude"]),
      longitude: numOrNull(basic["longitude"]),
      // Connectivity — real fields confirmed
      lastCommsDt: strOrNull(conn?.["lastCommsDt"]),
      lastNetwork: strOrNull(conn?.["lastNetwork"]),
      tapEventsPerMinuteToday: numOrNull(conn?.["tapEventsPerMinuteToday"]),
      tapEventsPerMinuteThisWeek: numOrNull(conn?.["tapEventsPerMinuteThisWeek"]),
      // Power — real fields confirmed
      batteryVoltage: round2(numOrNull(power?.["lastKnownVoltage"])),
      batteryTrend: strOrNull(power?.["trendDirection"]),
      batteryTodayHigh: round2(numOrNull(power?.["todayHigh"])),
      batteryTodayLow: round2(numOrNull(power?.["todayLow"])),
      lowBatteryEventCount: numOrNull(power?.["todayLowBatteryEventCount"]) != null
        ? Math.round(numOrNull(power?.["todayLowBatteryEventCount"])!)
        : null,
      // Health flags from status values data object
      healthFlags,
      tamperSwitchState,
      // Usage
      litresDispensedToday: round2(numOrNull(usage?.["litresDispensedToday"])),
      lastUsageDt: strOrNull(usage?.["lastUsageDt"]),
      flowRateHour: round2(numOrNull(flow?.["hourAverageFlowRate"])),
      flowRateToday: round2(numOrNull(flow?.["todayAverageFlowRate"])),
      flowRateWeek: round2(numOrNull(flow?.["weekAverageFlowRate"])),
      // Identifiers & firmware
      imeis,
      firmware,
      recentCommands,
      // EWC calibration — price of water
      ...(() => {
        const settingsRaw = ok<Record<string, unknown>>(settingsRes!);
        const inner = settingsRaw?.["data"] as Record<string, unknown> | null | undefined;
        const settings: Record<string, unknown>[] = Array.isArray(inner?.["settings"])
          ? (inner!["settings"] as Record<string, unknown>[])
          : Array.isArray(settingsRaw?.["settings"])
            ? (settingsRaw!["settings"] as Record<string, unknown>[])
            : [];
        const getSetting = (key: string): number | null => {
          const s = settings.find((x) => x["settingKey"] === key);
          if (!s) return null;
          const val = (s["value"] as Record<string, unknown> | null)?.["lastKnownValue"];
          if (val == null) return null;
          const n = Number(val);
          return isNaN(n) ? null : n;
        };
        const fcf = getSetting("FlowConversion");
        const lcf = getSetting("LitresConversion");
        const fx  = getSetting("CurrencyConversion");
        const preload = getSetting("Preload");
        const price = fcf != null && lcf != null && fx != null && fcf > 0
          ? (fx * lcf) / (fcf * 1_000_000)
          : null;
        return { ewcFcf: fcf, ewcLcf: lcf, ewcFx: fx, ewcPreload: preload, priceOfWater: price };
      })(),
    };
    if (bundleComplete) ttlSet(techCache, `tech:${id}`, techPayload, TECH_TTL_MS);
    res.json(techPayload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Failed to fetch asset tech status");
    res.status(502).json({ error: `eWater API error: ${msg}` });
  }
});

// ---------------------------------------------------------------------------
// Dashboard
// GET /api/ewater/dashboard
// Uses Query: GET /api/Entity/HealthSnapshots  (EntityHealthSnapshotResponse)
//        Query: GET /api/Entity/FaultSnapshots
//        State: GET /api/Entity/List  (for lifecycle-filtered totalAssets count)
// ---------------------------------------------------------------------------

const ALLOWED_LIFECYCLE_STATES = new Set(["PreInstallation", "Staged", "Active"]);

router.get("/ewater/dashboard", async (req, res): Promise<void> => {
  const rawLifecycle = typeof req.query["lifecycleState"] === "string" ? req.query["lifecycleState"] : "Active";
  const lifecycleFilter = ALLOWED_LIFECYCLE_STATES.has(rawLifecycle) ? rawLifecycle : "Active";

  if (!getCredentials()) {
    res.json({
      totalAssets: 0,
      onlineCount: 0,
      offlineCount: 0,
      faultCount: 0,
      powerFaultCount: 0,
      flowFaultCount: 0,
      lastUpdated: null,
      lifecycleFilter,
      recentAlerts: [],
    });
    return;
  }

  try {
    const [healthRes, faultRes, entityListRes] = await Promise.allSettled([
      ewaterFetch("query", "/api/Entity/HealthSnapshots"),
      ewaterFetch("query", "/api/Entity/FaultSnapshots"),
      ewaterFetch("state", "/api/Entity/List"),
    ]);

    const healthData = healthRes.status === "fulfilled" && healthRes.value.status === 200
      ? (healthRes.value.data as Record<string, unknown>)
      : null;
    const faultData = faultRes.status === "fulfilled" && faultRes.value.status === 200
      ? (faultRes.value.data as Record<string, unknown>)
      : null;
    const entityListData = entityListRes.status === "fulfilled" && entityListRes.value.status === 200
      ? (entityListRes.value.data as Record<string, unknown>)
      : null;

    // Count assets filtered by lifecycle state from Entity/List
    const allAssets = Array.isArray(entityListData?.["assets"])
      ? (entityListData!["assets"] as Record<string, unknown>[])
      : [];
    const filteredTotal = allAssets.filter(
      (a) => String(a["assetLifecycleState"]) === lifecycleFilter
    ).length;

    // Real shape: { snapshots: Array<{ entityType, entityId, lastUpdatedDt,
    //   totalAssetsCount, healthyAssetsCount, unhealthyAssetsCount, unknownAssetsCount,
    //   healthFactorSnapshots: Array<{ healthFactor, goodCount, okCount, poorCount }> }> }
    const healthSnapshots = Array.isArray(healthData?.["snapshots"])
      ? (healthData!["snapshots"] as Record<string, unknown>[])
      : Array.isArray(healthData)
        ? (healthData as Record<string, unknown>[])
        : [];

    // Aggregate totals across all entity snapshots
    let total = 0, healthy = 0, unhealthy = 0;
    let lastUpdatedDt: string | null = null;
    const factorTotals: Record<string, { goodCount: number; okCount: number; poorCount: number }> = {};

    for (const snap of healthSnapshots) {
      total    += numOrZero(snap["totalAssetsCount"]);
      healthy  += numOrZero(snap["healthyAssetsCount"]);
      unhealthy += numOrZero(snap["unhealthyAssetsCount"]);

      if (!lastUpdatedDt && snap["lastUpdatedDt"]) {
        lastUpdatedDt = String(snap["lastUpdatedDt"]);
      }

      const factors = Array.isArray(snap["healthFactorSnapshots"])
        ? (snap["healthFactorSnapshots"] as Record<string, unknown>[])
        : [];
      for (const f of factors) {
        const key = String(f["healthFactor"]);
        if (!factorTotals[key]) factorTotals[key] = { goodCount: 0, okCount: 0, poorCount: 0 };
        factorTotals[key].goodCount += numOrZero(f["goodCount"]);
        factorTotals[key].okCount   += numOrZero(f["okCount"]);
        factorTotals[key].poorCount += numOrZero(f["poorCount"]);
      }
    }

    // Power / Flow poor counts from aggregated factor data
    const powerKey = Object.keys(factorTotals).find(
      (k) => k.toLowerCase().includes("power") || k.toLowerCase().includes("voltage")
    );
    const flowKey = Object.keys(factorTotals).find(
      (k) => k.toLowerCase().includes("flow")
    );
    const powerFaultCount = powerKey ? factorTotals[powerKey].poorCount : 0;
    const flowFaultCount  = flowKey  ? factorTotals[flowKey].poorCount  : 0;

    // Count active faults from fault snapshots
    // Real shape: { snapshots: Array<{ entityType, entityId, activeFaultCounts: Array<{ faultId, activeCount }> }> }
    const faultSnapshots = Array.isArray(faultData?.["snapshots"])
      ? (faultData!["snapshots"] as Record<string, unknown>[])
      : [];
    const totalActiveFaults = faultSnapshots.reduce((sum, s) => {
      const counts = Array.isArray(s["activeFaultCounts"])
        ? (s["activeFaultCounts"] as Record<string, unknown>[])
        : [];
      return sum + counts.reduce((inner, c) => inner + numOrZero(c["activeCount"]), 0);
    }, 0);

    // Build alerts from aggregated factor poor counts
    const alerts: Array<{
      id: string;
      assetId: string;
      assetName: string | null;
      message: string;
      severity: string;
      timestamp: string;
    }> = [];

    for (const [factorName, counts] of Object.entries(factorTotals)) {
      if (counts.poorCount > 0) {
        alerts.push({
          id: `alert-${factorName}`,
          assetId: "system",
          assetName: null,
          message: `${counts.poorCount} asset(s) have poor ${factorName} status`,
          severity: counts.poorCount > 5 ? "error" : "warning",
          timestamp: lastUpdatedDt ?? new Date().toISOString(),
        });
      }
    }

    res.json({
      totalAssets: filteredTotal || total,
      onlineCount: healthy,
      offlineCount: unhealthy,
      faultCount: totalActiveFaults,
      powerFaultCount,
      flowFaultCount,
      lastUpdated: lastUpdatedDt ?? new Date().toISOString(),
      lifecycleFilter,
      recentAlerts: alerts.slice(0, 10),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `eWater API error: ${msg}` });
  }
});

// ---------------------------------------------------------------------------
// eSense Sensor Range Auto-Detect
// POST /api/ewater/assets/:assetId/detect-sensor-range
// Cross-references recent packet VSEN1 ADC with eWater tank-height API to
// back-calculate the sensor's full-scale range in metres, then persists it
// in alert_rules.sensor_range_metres for this asset.
// ---------------------------------------------------------------------------

router.post("/ewater/assets/:assetId/detect-sensor-range", async (req, res): Promise<void> => {
  const params = GetAssetParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!getCredentials()) { res.status(401).json({ error: "No credentials configured" }); return; }

  const assetId = params.data.assetId;

  try {
    const now = new Date();
    const start3h = new Date(now.getTime() - 3 * 3600 * 1000);
    const start7d = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

    // Parallel fetch: recent tank height + recent logs
    const [tankRes, logsRes] = await Promise.allSettled([
      ewaterFetch("state", "/api/Asset/GetTankHeightHistoryByDateRange", {
        method: "POST",
        body: JSON.stringify({ assetId, startDate: start3h.toISOString(), endDate: now.toISOString() }),
      }),
      ewaterFetch("state", "/api/Asset/GetLogsForAssetByReceivedDate", {
        method: "POST",
        body: JSON.stringify({
          assetId: Number(assetId),
          startDate: start7d.toISOString(),
          endDate: now.toISOString(),
          pipeline: null,
        }),
      }),
    ]);

    // Extract tank height points (metres, timestamp)
    type TankPoint = { ts: number; depth: number };
    const tankPoints: TankPoint[] = [];
    if (tankRes.status === "fulfilled" && tankRes.value.status === 200) {
      const body = tankRes.value.data as Record<string, unknown>;
      const rows = Array.isArray(body["data"]) ? (body["data"] as Record<string, unknown>[]) : [];
      for (const r of rows) {
        const depth = Number(r["averageWaterTankHeight"]);
        const lb = String(r["lowerBound"] ?? "");
        if (!isNaN(depth) && depth > 0 && lb) {
          tankPoints.push({ ts: new Date(lb).getTime(), depth });
        }
      }
    }

    if (tankPoints.length === 0) {
      res.status(422).json({ error: "No recent tank-height data from eWater — cannot detect sensor range" });
      return;
    }

    // Also extract chlorine (VSEN2) from tank height API
    type TankPoint2 = { ts: number; depth2: number };
    const tankPoints2: TankPoint2[] = [];
    if (tankRes.status === "fulfilled" && tankRes.value.status === 200) {
      const body = tankRes.value.data as Record<string, unknown>;
      const rows = Array.isArray(body["data"]) ? (body["data"] as Record<string, unknown>[]) : [];
      for (const r of rows) {
        const depth2 = Number(r["averageChlorineTankHeight"]);
        const lb = String(r["lowerBound"] ?? "");
        if (!isNaN(depth2) && depth2 > 0 && lb) {
          tankPoints2.push({ ts: new Date(lb).getTime(), depth2 });
        }
      }
    }

    // Extract VSEN1, VSEN2, VSEN3 ADC readings from recent EWC datalog packets
    type VsenPoint = { ts: number; vsen1: number; vsen2: number; vsen3: number };
    const vsenPoints: VsenPoint[] = [];
    if (logsRes.status === "fulfilled" && logsRes.value.status === 200) {
      const body = logsRes.value.data as Record<string, unknown>;
      const lines = Array.isArray(body["logLines"]) ? (body["logLines"] as Record<string, unknown>[]) : [];
      for (const line of lines) {
        const protocol = String(line["protocol"] ?? "");
        if (!protocol.toLowerCase().startsWith("ewc")) continue;
        const payload = String(line["payload"] ?? "");
        if (!payload) continue;
        try {
          const raw = Buffer.from(payload, "base64");
          if (raw.length !== 39) continue;
          if (raw[0] !== 0x44) continue; // must be DATALOG
          const event = raw[5]!;
          let vsen1 = 0, vsen2 = 0, vsen3 = 0;
          if (event === 0x19) {
            vsen1 = raw[18]!; vsen2 = raw[19]!; vsen3 = raw[20]!;
          } else {
            vsen1 = raw[12]!; vsen2 = raw[13]!; vsen3 = raw[14]!;
          }
          if (vsen1 > 51) { // VSEN1 connected = valid eSENSE packet
            const ts = new Date(String(line["timeReceived"] ?? "")).getTime();
            if (!isNaN(ts)) vsenPoints.push({ ts, vsen1, vsen2, vsen3 });
          }
        } catch {
          // skip malformed packets
        }
      }
    }

    if (vsenPoints.length === 0) {
      res.status(422).json({ error: "No valid eSENSE packet readings found in the last 7 days" });
      return;
    }

    // Sort newest-first; pick most recent packet
    vsenPoints.sort((a, b) => b.ts - a.ts);
    const best = vsenPoints[0]!;

    // Helper: find closest tank point in time
    function closestPoint<T extends { ts: number }>(pts: T[], refTs: number): { point: T; diff: number } | null {
      if (pts.length === 0) return null;
      let best2 = pts[0]!;
      let minD = Math.abs(refTs - best2.ts);
      for (const p of pts) { const d = Math.abs(refTs - p.ts); if (d < minD) { minD = d; best2 = p; } }
      return { point: best2, diff: minD };
    }

    // Helper: range = depth × 203 / (adc − 51), rounded to nearest 0.5 m
    function calcRange(adc: number, depth: number): number {
      return Math.round(((depth * 203) / (adc - 51)) * 2) / 2;
    }

    // VSEN1 — cross-ref with averageWaterTankHeight
    const tank1 = closestPoint(tankPoints, best.ts);
    const sensorRangeMetres1 = tank1 ? calcRange(best.vsen1, tank1.point.depth) : null;

    // VSEN2 — cross-ref with averageChlorineTankHeight (if > 0 and connected)
    let sensorRangeMetres2: number | null = null;
    if (best.vsen2 > 51 && tankPoints2.length > 0) {
      const tank2 = closestPoint(tankPoints2, best.ts);
      if (tank2) sensorRangeMetres2 = calcRange(best.vsen2, tank2.point.depth2);
    }

    // VSEN3 — no eWater API cross-reference available
    const sensorRangeMetres3: number | null = null;

    // Persist in alert_rules
    const existing = await db.select({ id: alertRulesTable.id }).from(alertRulesTable)
      .where(eq(alertRulesTable.assetId, assetId)).limit(1);
    const dbPayload = { sensorRangeMetres1, sensorRangeMetres2, sensorRangeMetres3 };
    if (existing.length === 0) {
      await db.insert(alertRulesTable).values({ assetId, ...dbPayload });
    } else {
      await db.update(alertRulesTable).set(dbPayload).where(eq(alertRulesTable.assetId, assetId));
    }

    res.json({
      sensorRangeMetres1,
      sensorRangeMetres2,
      sensorRangeMetres3,
      vsen1: best.vsen1, vsen2: best.vsen2, vsen3: best.vsen3,
      depthMetres1: tank1 ? Math.round(tank1.point.depth * 1000) / 1000 : null,
      timeDeltaSeconds: tank1 ? Math.round(tank1.diff / 1000) : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Failed to detect sensor range");
    res.status(502).json({ error: `Detection failed: ${msg}` });
  }
});

// ---------------------------------------------------------------------------
// eSense Charts
// GET /api/ewater/assets/:assetId/esense-charts?days=3
// Fetches tank height, daily inflow, and voltage status for eSense assets
// ---------------------------------------------------------------------------

router.get("/ewater/assets/:assetId/esense-charts", async (req, res): Promise<void> => {
  const paramsParsed = GetAssetParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: paramsParsed.error.message });
    return;
  }
  if (!getCredentials()) {
    res.status(401).json({ error: "No credentials configured" });
    return;
  }

  const assetId = Number(paramsParsed.data.assetId);
  if (isNaN(assetId)) {
    res.status(400).json({ error: "Invalid asset ID" });
    return;
  }

  const queryParsed = GetESenseChartsQueryParams.safeParse(req.query);
  const days = queryParsed.success ? queryParsed.data.days : 3;

  try {
    res.json(await getAssetEsenseCharts(assetId, days));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Failed to fetch eSense chart data");
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
// Meter reading — ECR tick accumulator from latest HEALTH_STATE (0x19) packet
// POST /api/ewater/assets/:assetId/reset-meter
// Sends the litre value directly (litreValue) plus the device IMEI to
// /api/Ewc/ResetTickAccumulator. No litres→ticks conversion (the command API
// takes litres). The device applies it on its next health packet response.
// ---------------------------------------------------------------------------

router.post("/ewater/assets/:assetId/reset-meter", async (req, res): Promise<void> => {
  const assetId = req.params["assetId"];
  if (!assetId) { res.status(400).json({ error: "assetId required" }); return; }
  if (!getCredentials()) { res.status(401).json({ error: "No credentials configured" }); return; }

  const { litres } = req.body as { litres?: unknown };
  if (typeof litres !== "number" || litres < 0) {
    res.status(400).json({ error: "litres must be a non-negative number" }); return;
  }

  // The eWater command API takes the litre value directly (litreValue) plus the
  // device IMEI — no ticks conversion. Resolve the IMEI from the asset's identifiers.
  // If the asset has more than one registered IMEI (e.g. after a device swap), the
  // most recently registered one is used since that's the module actually in service.
  const imeis = await fetchAssetImeis(assetId);
  const imei = imeis[imeis.length - 1] ?? null;
  if (!imei) {
    res.status(400).json({ error: "Could not determine device IMEI for this asset" }); return;
  }

  try {
    const result = await ewaterFetch("command", "/api/Ewc/ResetTickAccumulator", {
      method: "POST",
      body: JSON.stringify({
        correlationId: null,
        secondaryUserId: null,
        imei,
        assetId: Number(assetId),
        litreValue: litres,
      }),
    });

    if (result.status >= 200 && result.status < 300) {
      res.json({ litres, success: true, error: null });
    } else {
      const errMsg = typeof result.data === "object" && result.data !== null
        ? JSON.stringify(result.data)
        : String(result.data ?? result.status);
      req.log.warn({ assetId, litres, status: result.status }, "ResetTickAccumulator non-success");
      res.json({ litres, success: false, error: errMsg });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Failed to reset tick accumulator");
    res.status(502).json({ error: `eWater command error: ${msg}` });
  }
});

// ---------------------------------------------------------------------------
// Apply calibration — write the suggested LCF (LitresConversion) and the
// measured Preload (both settings, one RequestSettingChange call each)
// POST /api/ewater/assets/:assetId/apply-calibration
// Uses the eWater command API /api/Ewc/RequestSettingChange (the managed
// desired-value path — the device applies the change on its next comms).
// Returns per-setting results; success only when the write was accepted.
// ---------------------------------------------------------------------------

router.post("/ewater/assets/:assetId/apply-calibration", async (req, res): Promise<void> => {
  const assetId = req.params["assetId"];
  if (!assetId || isNaN(Number(assetId))) {
    res.status(400).json({ error: "Numeric assetId required" }); return;
  }
  if (!getCredentials()) { res.status(401).json({ error: "No credentials configured" }); return; }

  const parsed = ApplyAssetCalibrationBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { lcf, preload } = parsed.data;
  if (!Number.isInteger(lcf) || !Number.isInteger(preload)) {
    res.status(400).json({ error: "lcf and preload must be integers" }); return;
  }

  const writes: { settingKey: string; newValue: number }[] = [
    { settingKey: "LitresConversion", newValue: lcf },
    { settingKey: "Preload", newValue: preload },
  ];

  const results: { settingKey: string; success: boolean; error: string | null }[] = [];
  for (const w of writes) {
    try {
      const result = await ewaterFetch("command", "/api/Ewc/RequestSettingChange", {
        method: "POST",
        body: JSON.stringify({
          correlationId: null,
          secondaryUserId: null,
          assetId: Number(assetId),
          settingKey: w.settingKey,
          newValue: w.newValue,
        }),
      });
      if (result.status >= 200 && result.status < 300) {
        results.push({ settingKey: w.settingKey, success: true, error: null });
      } else {
        const errMsg = typeof result.data === "object" && result.data !== null
          ? JSON.stringify(result.data)
          : String(result.data ?? result.status);
        req.log.warn({ assetId, ...w, status: result.status }, "RequestSettingChange non-success");
        results.push({ settingKey: w.settingKey, success: false, error: errMsg });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      req.log.error({ err, assetId, ...w }, "RequestSettingChange failed");
      results.push({ settingKey: w.settingKey, success: false, error: msg });
    }
  }

  res.json({ success: results.every((r) => r.success), results });
});

// ---------------------------------------------------------------------------
// GET /api/ewater/assets/:assetId/meter-reading
// ---------------------------------------------------------------------------

router.get("/ewater/assets/:assetId/meter-reading", async (req, res): Promise<void> => {
  const assetId = req.params["assetId"];
  if (!assetId) { res.status(400).json({ error: "assetId required" }); return; }
  if (!getCredentials()) { res.status(401).json({ error: "No credentials configured" }); return; }

  const endDate   = new Date();
  const startDate = new Date(endDate.getTime() - 14 * 24 * 3600 * 1000); // 14 days

  try {
    const result = await ewaterFetch("state", "/api/Asset/GetLogsForAssetByReceivedDate", {
      method: "POST",
      body: JSON.stringify({
        assetId: Number(assetId),
        startDate: startDate.toISOString(),
        endDate:   endDate.toISOString(),
        pipeline:  null,
      }),
    });

    if (result.status !== 200) {
      res.json({ ticks: null, lcf: null, litres: null, timestamp: null, found: false });
      return;
    }

    const body  = result.data as Record<string, unknown>;
    const lines = Array.isArray(body["logLines"])
      ? (body["logLines"] as Record<string, unknown>[])
      : [];

    // Authoritative LCF (ticks/litre) from EWC settings — NOT packet bytes[33–34]
    // (that trailer is the FCF). Only LitresConversion converts ticks → litres.
    const lcf = await fetchAssetLcf(assetId);

    // Sort descending — pick the most recent HEALTH_STATE packet
    lines.sort((a, b) =>
      new Date(String(b["timeReceived"] ?? 0)).getTime() -
      new Date(String(a["timeReceived"] ?? 0)).getTime()
    );

    for (const line of lines) {
      const payload = strOrNull(line["payload"]);
      const time    = strOrNull(line["timeReceived"]);
      if (!payload || !time) continue;
      try {
        const bytes = Array.from(atob(payload), (c) => c.charCodeAt(0));
        if (bytes.length !== 39 || bytes[0] !== 0x44) continue;
        if (bytes[5] !== 0x19) continue; // only HEALTH_STATE packets

        // Tick accumulator = 8-byte big-endian value at offset 21 (bytes[21..28]).
        // The eWater portal reports this as the device's lifetime tick accumulator
        // (e.g. 0x000000000011DA8D = 1,170,061). The top 4 bytes are effectively
        // always zero, so combine high/low 32-bit halves to stay in safe-integer range.
        const high =
          bytes[21]! * 16777216 + bytes[22]! * 65536 + bytes[23]! * 256 + bytes[24]!;
        const low =
          bytes[25]! * 16777216 + bytes[26]! * 65536 + bytes[27]! * 256 + bytes[28]!;
        const ticks = high * 4294967296 + low;
        const litres = lcf != null ? Math.round((ticks / lcf) * 10) / 10 : null;

        res.json({ ticks, lcf, litres, timestamp: time, found: true });
        return;
      } catch { /* skip malformed */ }
    }

    res.json({ ticks: null, lcf: null, litres: null, timestamp: null, found: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Failed to fetch meter reading");
    res.status(502).json({ error: `eWater API error: ${msg}` });
  }
});

// ---------------------------------------------------------------------------
// Most recent flow rate from last 24 h of EWC logs
// GET /api/ewater/assets/:assetId/flow-rate
// ---------------------------------------------------------------------------

router.get("/ewater/assets/:assetId/flow-rate", async (req, res): Promise<void> => {
  const assetId = req.params["assetId"];
  if (!assetId) { res.status(400).json({ error: "assetId required" }); return; }
  if (!getCredentials()) { res.status(401).json({ error: "No credentials configured" }); return; }

  try {
    res.json(await getAssetFlowRate(assetId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Failed to fetch flow rate");
    res.status(502).json({ error: `eWater API error: ${msg}` });
  }
});

// Asset logs — paginated, cursor-based
// GET /api/ewater/assets/:assetId/logs
// Query: before (ISO), protocol (filter), limit (1-100), windowDays (1-30)
// ---------------------------------------------------------------------------

router.get("/ewater/assets/:assetId/logs", async (req, res): Promise<void> => {
  const assetId = req.params["assetId"];
  if (!assetId) { res.status(400).json({ error: "assetId required" }); return; }
  if (!getCredentials()) { res.status(401).json({ error: "No credentials configured" }); return; }

  const beforeRaw = typeof req.query["before"] === "string" ? req.query["before"] : null;
  const protocolFilter = typeof req.query["protocol"] === "string" ? req.query["protocol"] : null;
  const limit = Math.min(Math.max(Number(req.query["limit"] ?? 50), 1), 100);
  const windowDays = Math.min(Math.max(Number(req.query["windowDays"] ?? 7), 1), 30);

  const endDate = beforeRaw ? new Date(beforeRaw) : new Date();
  const startDate = new Date(endDate.getTime() - windowDays * 24 * 3600 * 1000);

  try {
    const result = await ewaterFetch("state", "/api/Asset/GetLogsForAssetByReceivedDate", {
      method: "POST",
      body: JSON.stringify({
        assetId: Number(assetId),
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        pipeline: null, // eWater "pipeline" = transport (UDP/CmdApi), not protocol name — filter client-side
      }),
    });

    if (result.status !== 200) { res.json({ entries: [], nextBefore: null, hasMore: false }); return; }

    const body = result.data as Record<string, unknown>;
    const lines = Array.isArray(body["logLines"]) ? (body["logLines"] as Record<string, unknown>[]) : [];

    // Sort descending (most recent first) and filter client-side too (in case the API ignores pipeline)
    const sorted = [...lines].sort((a, b) => {
      const ta = new Date(String(a["timeReceived"] ?? 0)).getTime();
      const tb = new Date(String(b["timeReceived"] ?? 0)).getTime();
      return tb - ta;
    });

    // "protocol" field = Ewc2_5 / 4CCv1 / CmdApi etc. (NOT "pipeline" which is UDP/MQTT transport)
    const filtered = protocolFilter
      ? sorted.filter((l) => {
          const p = strOrNull(l["protocol"]) ?? "";
          return p.toLowerCase() === protocolFilter.toLowerCase();
        })
      : sorted;

    const page = filtered.slice(0, limit);
    const hasMore = filtered.length > limit;
    const nextBefore = page.length > 0
      ? strOrNull(page[page.length - 1]!["timeReceived"])
      : null;

    const entries = page.map((l) => {
      const imei = extractImeiFromLogSource(strOrNull(l["source"]));
      const payload = strOrNull(l["payload"]);
      const shengda = payload ? tryDecodeShengdaLwm2m(payload) : null;

      return {
        id: String(l["id"] ?? crypto.randomUUID()),
        timestamp: String(l["timeReceived"] ?? new Date().toISOString()),
        source: imei,
        protocol: strOrNull(l["protocol"]),
        pipeline: strOrNull(l["pipeline"]),
        message: payload,
        // Shengda NB-IoT (CBOR/LwM2M) frames aren't decodable client-side —
        // decode them server-side and hand the frontend a ready-to-render
        // summary + description, same shape used by the Packets tab.
        shengda: shengda
          ? {
              valid: shengda.valid,
              messageType: shengda.messageType,
              messageFunction: shengda.messageFunction,
              meterReading: shengda.meterReading,
              prepayLitres: shengda.prepayLitres,
              supplyVoltage: shengda.supplyVoltage,
              batteryState: shengda.batteryState,
              valveStatus: shengda.valveStatus,
              signalPower: shengda.signalPower,
              signalSnr: shengda.signalSnr,
              errorCode: shengda.errorCode,
              magneticAttack: shengda.magneticAttack,
              description: shengda.description,
            }
          : null,
      };
    });

    res.json({ entries, nextBefore, hasMore });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Failed to fetch asset logs");
    res.status(502).json({ error: `eWater API error: ${msg}` });
  }
});

// ---------------------------------------------------------------------------
// Tags — registered user roster (Reference API)
// GET /api/ewater/tags?waterSystemId={id}&offset={n}&limit={n}
// GET /api/ewater/tags/:nfcId
// GET /api/ewater/households/:householdId
// ---------------------------------------------------------------------------

router.get("/ewater/tags", async (req, res): Promise<void> => {
  if (!getCredentials()) { res.status(401).json({ error: "No credentials configured" }); return; }
  const waterSystemIdRaw = req.query["waterSystemId"];
  if (typeof waterSystemIdRaw !== "string" || !waterSystemIdRaw) {
    res.status(400).json({ error: "waterSystemId query parameter required" });
    return;
  }
  const waterSystemId = Number(waterSystemIdRaw);
  if (isNaN(waterSystemId)) { res.status(400).json({ error: "waterSystemId must be a number" }); return; }
  const offset = Number(req.query["offset"] ?? 0);
  const limit = Math.min(Math.max(Number(req.query["limit"] ?? 100), 1), 500);

  try {
    const page = await getRegisteredTagIds(waterSystemId, offset, limit);
    res.json(page);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Failed to fetch registered tag IDs");
    res.status(502).json({ error: `eWater API error: ${msg}` });
  }
});

router.get("/ewater/tags/:nfcId", async (req, res): Promise<void> => {
  if (!getCredentials()) { res.status(401).json({ error: "No credentials configured" }); return; }
  const nfcId = req.params["nfcId"];
  if (!nfcId) { res.status(400).json({ error: "nfcId required" }); return; }

  try {
    const tag = await getTagInfo(nfcId.toUpperCase());
    if (!tag) { res.status(404).json({ error: "Tag not found" }); return; }

    let household = null;
    if (tag.householdId) {
      household = await getHouseholdInfo(tag.householdId);
    }

    res.json({ tag, household });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Failed to fetch tag info");
    res.status(502).json({ error: `eWater API error: ${msg}` });
  }
});

// GET /api/ewater/tags/:nfcId/usage?days=30&offset=0&limit=100
router.get("/ewater/tags/:nfcId/usage", async (req, res): Promise<void> => {
  if (!getCredentials()) { res.status(401).json({ error: "No credentials configured" }); return; }
  const nfcId = req.params["nfcId"];
  if (!nfcId) { res.status(400).json({ error: "nfcId required" }); return; }

  const days   = Math.min(90, Math.max(1, Number(req.query["days"]   ?? 30)));
  const offset = Math.max(0,          Number(req.query["offset"]  ?? 0));
  const limit  = Math.min(200, Math.max(1, Number(req.query["limit"]  ?? 100)));

  try {
    const tag = await getTagInfo(nfcId.toUpperCase());
    if (!tag) { res.status(404).json({ error: "Tag not found" }); return; }
    const page = await getTagUsage(nfcId, tag.primaryAssetId, days, offset, limit);
    res.json(page);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Failed to fetch tag usage");
    res.status(502).json({ error: `eWater API error: ${msg}` });
  }
});

router.get("/ewater/households/:householdId", async (req, res): Promise<void> => {
  if (!getCredentials()) { res.status(401).json({ error: "No credentials configured" }); return; }
  const householdId = req.params["householdId"];
  if (!householdId) { res.status(400).json({ error: "householdId required" }); return; }

  try {
    const household = await getHouseholdInfo(householdId);
    if (!household) { res.status(404).json({ error: "Household not found" }); return; }
    res.json(household);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Failed to fetch household info");
    res.status(502).json({ error: `eWater API error: ${msg}` });
  }
});

// ---------------------------------------------------------------------------
// Disbursements (Usage API — per-day aggregated dispense totals)
// ---------------------------------------------------------------------------

// GET /api/ewater/tags/:nfcId/disbursements?days=30[&assetId=662]
// If assetId is provided → GetDisbursementsByTagAndAsset; else → GetDisbursementsByTag
router.get("/ewater/tags/:nfcId/disbursements", async (req, res): Promise<void> => {
  const nfcId = (req.params["nfcId"] ?? "").toUpperCase();
  const days = Math.min(Math.max(parseInt(String(req.query["days"] ?? "30"), 10) || 30, 1), 365);
  const rawAssetId = req.query["assetId"];

  try {
    let result;
    if (rawAssetId != null && rawAssetId !== "") {
      result = await getDisbursementsByTagAndAsset(nfcId, String(rawAssetId), days);
    } else {
      result = await getDisbursementsByTag(nfcId, days);
    }
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch tag disbursements");
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `eWater API error: ${msg}` });
  }
});

// GET /api/ewater/assets/:assetId/disbursements?days=30
router.get("/ewater/assets/:assetId/disbursements", async (req, res): Promise<void> => {
  const assetId = req.params["assetId"] ?? "";
  const days = Math.min(Math.max(parseInt(String(req.query["days"] ?? "30"), 10) || 30, 1), 365);

  try {
    const result = await getDisbursementsByAsset(assetId, days);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch asset disbursements");
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `eWater API error: ${msg}` });
  }
});

export default router;
