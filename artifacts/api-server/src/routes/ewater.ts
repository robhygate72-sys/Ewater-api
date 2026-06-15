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
  GetESenseChartsQueryParams,
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
    // Fetch assets + entity hierarchy in parallel
    const [assetsResult, entityResult] = await Promise.allSettled([
      ewaterFetch("state", "/api/Entity/Assets", {
        method: "POST",
        body: JSON.stringify({
          assetLifecycleStates: ["PreInstallation", "Active", "Staged", "Demo", "Test", "Suspended"],
        }),
      }),
      ewaterFetch("state", "/api/Entity/List"),
    ]);

    // Build hierarchy maps: waterSystemId → { name, countryName }
    const wsMap = new Map<number, { name: string; countryName: string }>();
    if (entityResult.status === "fulfilled" && entityResult.value.status === 200) {
      const ed = entityResult.value.data as Record<string, unknown>;
      const countries = Array.isArray(ed["countries"]) ? (ed["countries"] as Record<string, unknown>[]) : [];
      const orgs = Array.isArray(ed["organisations"]) ? (ed["organisations"] as Record<string, unknown>[]) : [];
      const waterSystems = Array.isArray(ed["waterSystems"]) ? (ed["waterSystems"] as Record<string, unknown>[]) : [];

      const countryById = new Map(countries.map((c) => [Number(c["id"]), strOrNull(c["name"]) ?? ""]));
      const orgById = new Map(orgs.map((o) => [Number(o["id"]), { name: strOrNull(o["name"]) ?? "", parentId: Number(o["parentId"]) }]));

      for (const ws of waterSystems) {
        const wsId = Number(ws["id"]);
        const wsName = strOrNull(ws["name"]) ?? "";
        const parentId = Number(ws["parentId"]);
        // parent may be org or country
        const org = orgById.get(parentId);
        const countryId = org ? org.parentId : parentId;
        const countryName = countryById.get(countryId) ?? "";
        wsMap.set(wsId, { name: wsName, countryName });
      }
    }

    if (assetsResult.status === "fulfilled" && assetsResult.value.status === 200) {
      const body = assetsResult.value.data as Record<string, unknown>;
      const raw = Array.isArray(body["assets"]) ? (body["assets"] as Record<string, unknown>[]) : [];
      res.json(raw.map((a) => normaliseAssetDto(a, wsMap)));
      return;
    }

    // Fallback: use entity list assets
    if (entityResult.status === "fulfilled" && entityResult.value.status === 200) {
      const d = entityResult.value.data as Record<string, unknown>;
      const raw = Array.isArray(d["assets"]) ? (d["assets"] as Record<string, unknown>[]) : [];
      res.json(raw.map((a) => normaliseAssetDto(a, wsMap)));
      return;
    }

    res.json([]);
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
    const result = await ewaterFetch("state", `/api/Asset/GetSettingsMapForAsset?assetId=${encodeURIComponent(id)}`);
    const settingsRaw = result.status === 200 ? (result.data as Record<string, unknown>) : null;
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
    const priceOfWater = fcf != null && lcf != null && fx != null && fcf > 0
      ? (fx * lcf) / (fcf * 1_000_000)
      : null;

    res.json({ ewcFcf: fcf, ewcLcf: lcf, ewcFx: fx, ewcPreload: preload, priceOfWater });
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

  try {
    const [basicRes, connRes, powerRes, flowRes, usageRes, statusRes, firmwareRes, identifiersRes, commandsRes, entityRes, settingsRes] =
      await Promise.allSettled([
        ewaterFetch("state", `/api/Asset/GetAssetBasicInfoByAssetID?assetId=${encodeURIComponent(id)}`),
        ewaterFetch("query", `/api/Asset/AssetConnectivityStatus?assetId=${encodeURIComponent(id)}`),
        ewaterFetch("query", `/api/Asset/AssetPowerStatus?assetId=${encodeURIComponent(id)}`),
        ewaterFetch("query", `/api/Asset/AssetFlowStatus?assetId=${encodeURIComponent(id)}`),
        ewaterFetch("query", `/api/Asset/AssetUsageStatus?assetId=${encodeURIComponent(id)}`),
        ewaterFetch("state", `/api/Asset/GetStatusValuesForAsset?assetId=${encodeURIComponent(id)}`),
        ewaterFetch("state", `/api/Asset/GetFirmwareStatusByAssetId?assetId=${encodeURIComponent(id)}`),
        ewaterFetch("state", `/api/Asset/GetIdentifiersByAssetId?assetId=${encodeURIComponent(idNum)}`),
        ewaterFetch("state", `/api/Asset/GetCommandsForAsset?assetId=${encodeURIComponent(id)}&pageSize=20&pageIndex=0`),
        ewaterFetch("state", "/api/Entity/List"),
        ewaterFetch("state", `/api/Asset/GetSettingsMapForAsset?assetId=${encodeURIComponent(id)}`),
      ]);

    const ok = <T>(r: PromiseSettledResult<{ status: number; data: unknown }>): T | null =>
      r.status === "fulfilled" && r.value.status === 200 ? (r.value.data as T) : null;

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
    const idList = Array.isArray(identifiers?.["identifiers"])
      ? (identifiers!["identifiers"] as Record<string, unknown>[])
      : [];
    const imei = idList.length > 0 ? strOrNull(idList[0]!["imei"]) : null;

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

    res.json({
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
      flowRateHour: round2(numOrNull(flow?.["averageFlowRateThisHour"])),
      flowRateToday: round2(numOrNull(flow?.["averageFlowRateToday"])),
      flowRateWeek: round2(numOrNull(flow?.["averageFlowRateThisWeek"])),
      // Identifiers & firmware
      imei,
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
    });
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
  const days = Math.min(Math.max(queryParsed.success ? queryParsed.data.days : 3, 1), 180);

  const now = new Date();
  const startDate = new Date(now.getTime() - days * 86400 * 1000).toISOString().slice(0, 19);
  const endDate = now.toISOString().slice(0, 19);

  // For ranges > 5 days the API switches to daily aggregation and today's bucket
  // is always incomplete (only has early-morning data). We fix this by fetching
  // the main range up to yesterday-end, then a separate hourly fetch for today.
  const todayMidnight = new Date(now);
  todayMidnight.setHours(0, 0, 0, 0);
  const yesterdayEnd = new Date(todayMidnight.getTime() - 1000).toISOString().slice(0, 19);
  const todayStart = todayMidnight.toISOString().slice(0, 19);
  const needsTodaySupp = days > 5;

  try {
    const [tankRes, inflowRes, powerRes, todayTankRes] = await Promise.allSettled([
      ewaterFetch("state", "/api/Asset/GetTankHeightHistoryByDateRange", {
        method: "POST",
        body: JSON.stringify({
          assetId,
          startDate,
          endDate: needsTodaySupp ? yesterdayEnd : endDate,
        }),
      }),
      ewaterFetch("state", "/api/Asset/GetDisbursementHistoryByDateRange", {
        method: "POST",
        body: JSON.stringify({
          assetId,
          startDate,
          endDate,
          includeTickAccumulatorDerivedDisbursement: true,
        }),
      }),
      ewaterFetch("query", `/api/Asset/AssetPowerStatus?assetId=${assetId}`),
      needsTodaySupp
        ? ewaterFetch("state", "/api/Asset/GetTankHeightHistoryByDateRange", {
            method: "POST",
            body: JSON.stringify({ assetId, startDate: todayStart, endDate }),
          })
        : Promise.resolve({ status: 204 as const, data: null }),
    ]);

    // Parse tank height — merge historical (daily) + today (hourly) when needed
    function parseTankRaw(res: (typeof tankRes)): Record<string, unknown>[] {
      const ok =
        res.status === "fulfilled" && res.value.status === 200
          ? (res.value.data as Record<string, unknown>)
          : null;
      return Array.isArray(ok?.["data"]) ? (ok!["data"] as Record<string, unknown>[]) : [];
    }
    const combinedTankRaw = [...parseTankRaw(tankRes), ...parseTankRaw(todayTankRes)];
    const tankHeight = combinedTankRaw.map((d) => ({
      time: String(d["lowerBound"] ?? ""),
      waterTank: numOrNull(d["averageWaterTankHeight"]),
      waterTankMin: numOrNull(d["minimumWaterTankHeight"]),
      waterTankMax: numOrNull(d["maximumWaterTankHeight"]),
      chlorineTank: numOrNull(d["averageChlorineTankHeight"]),
      chlorineTankMin: numOrNull(d["minimumChlorineTankHeight"]),
      chlorineTankMax: numOrNull(d["maximumChlorineTankHeight"]),
    }));

    // Parse daily inflow
    const inflowOk =
      inflowRes.status === "fulfilled" && inflowRes.value.status === 200
        ? (inflowRes.value.data as Record<string, unknown>)
        : null;
    const inflowRaw = Array.isArray(inflowOk?.["data"])
      ? (inflowOk!["data"] as Record<string, unknown>[])
      : [];
    const inflowFromApi = inflowRaw.map((d) => ({
      date: String(d["lowerBound"] ?? "").slice(0, 10),
      litres: numOrNull(d["tickAccumulatorDerivedTotalLitres"]) ?? numOrNull(d["estimateTotalLitres"]) ?? 0,
    }));
    // Zero-fill every calendar day in the requested range
    const inflowMap = new Map(inflowFromApi.map((d) => [d.date, d.litres]));
    const rangeStart = new Date(now.getTime() - days * 86400 * 1000);
    rangeStart.setUTCHours(0, 0, 0, 0);
    const rangeEnd = new Date(now);
    rangeEnd.setUTCHours(0, 0, 0, 0);
    const dailyInflow: { date: string; litres: number }[] = [];
    for (
      let d = new Date(rangeStart);
      d.getTime() <= rangeEnd.getTime();
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      const dateStr = d.toISOString().slice(0, 10);
      dailyInflow.push({ date: dateStr, litres: inflowMap.get(dateStr) ?? 0 });
    }

    // Parse voltage (today's snapshot from AssetPowerStatus)
    const powerOk =
      powerRes.status === "fulfilled" && powerRes.value.status === 200
        ? (powerRes.value.data as Record<string, unknown>)
        : null;
    const voltageStatus = powerOk
      ? {
          current: round2(numOrNull(powerOk["lastKnownVoltage"])),
          todayHigh: round2(numOrNull(powerOk["todayHigh"])),
          todayLow: round2(numOrNull(powerOk["todayLow"])),
          todayAverage: round2(numOrNull(powerOk["todayAverage"])),
          trend: strOrNull(powerOk["trendDirection"]),
        }
      : null;

    res.json({
      tankHeight,
      dailyInflow,
      voltageHistory: [],
      voltageStatus,
    });
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
// Helpers
// ---------------------------------------------------------------------------

function normaliseAssetDto(
  raw: Record<string, unknown>,
  wsMap?: Map<number, { name: string; countryName: string }>,
) {
  const parentId = numOrNull(raw["parentId"]);
  const wsInfo = parentId != null && wsMap ? wsMap.get(parentId) : undefined;
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
    parentId,
    waterSystemName: wsInfo?.name ?? null,
    countryName: wsInfo?.countryName ?? null,
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

function round2(v: number | null): number | null {
  if (v == null) return null;
  return Math.round(v * 100) / 100;
}

export default router;
