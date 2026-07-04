// ---------------------------------------------------------------------------
// Shared eWater insight logic.
//
// Extracted from routes/ewater.ts so both the REST API and the MCP tool
// server (lib/mcp-server.ts) can call the same asset-listing, esense-chart
// aggregation, EWC settings lookup, flow-rate calculation, and calibration /
// NRW gap-analysis logic without duplicating it.
// ---------------------------------------------------------------------------

import { ewaterFetch } from "./ewater-client";

// ---------------------------------------------------------------------------
// Small scalar helpers
// ---------------------------------------------------------------------------

export function strOrNull(v: unknown): string | null {
  return v != null && v !== "" ? String(v) : null;
}

export function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

export function numOrZero(v: unknown): number {
  return numOrNull(v) ?? 0;
}

export function round2(v: number | null): number | null {
  if (v == null) return null;
  return Math.round(v * 100) / 100;
}

export function formatLocation(lat: number | null, lon: number | null): string | null {
  if (lat == null || lon == null) return null;
  if (lat === 0 && lon === 0) return null;
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function healthRatingIsFault(rating: string | null): boolean | null {
  if (!rating) return null;
  const r = rating.toLowerCase();
  return r === "poor" || r === "bad" || r === "critical" || r === "fault";
}

export function normaliseAssetDto(
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
    isOnline: null as boolean | null,
    location: formatLocation(numOrNull(raw["latitude"]), numOrNull(raw["longitude"])),
    lastSeen: null as string | null,
    batteryVoltage: null as number | null,
    signalStrength: null as number | null,
    hasPowerFault: null as boolean | null,
    hasFlowFault: null as boolean | null,
    parentId,
    waterSystemName: wsInfo?.name ?? null,
    countryName: wsInfo?.countryName ?? null,
    rawData: raw,
  };
}

// ---------------------------------------------------------------------------
// List assets — POST /api/Entity/Assets + GET /api/Entity/List (hierarchy)
// ---------------------------------------------------------------------------

export type AssetSummary = ReturnType<typeof normaliseAssetDto>;

export async function listAssets(): Promise<AssetSummary[]> {
  const [assetsResult, entityResult] = await Promise.allSettled([
    ewaterFetch("state", "/api/Entity/Assets", {
      method: "POST",
      body: JSON.stringify({
        assetLifecycleStates: ["PreInstallation", "Active", "Staged", "Demo", "Test", "Suspended"],
      }),
    }),
    ewaterFetch("state", "/api/Entity/List"),
  ]);

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
      const org = orgById.get(parentId);
      const countryId = org ? org.parentId : parentId;
      const countryName = countryById.get(countryId) ?? "";
      wsMap.set(wsId, { name: wsName, countryName });
    }
  }

  if (assetsResult.status === "fulfilled" && assetsResult.value.status === 200) {
    const body = assetsResult.value.data as Record<string, unknown>;
    const raw = Array.isArray(body["assets"]) ? (body["assets"] as Record<string, unknown>[]) : [];
    return raw.map((a) => normaliseAssetDto(a, wsMap));
  }

  if (entityResult.status === "fulfilled" && entityResult.value.status === 200) {
    const d = entityResult.value.data as Record<string, unknown>;
    const raw = Array.isArray(d["assets"]) ? (d["assets"] as Record<string, unknown>[]) : [];
    return raw.map((a) => normaliseAssetDto(a, wsMap));
  }

  return [];
}

// ---------------------------------------------------------------------------
// Ticks-per-litre / IMEI / authoritative LCF lookups
// ---------------------------------------------------------------------------

export async function fetchTicksPerLitre(assetId: string): Promise<number | null> {
  try {
    const result = await ewaterFetch(
      "state",
      `/api/Asset/GetTicksPerLitre?assetId=${encodeURIComponent(assetId)}`,
    );
    if (result.status !== 200) return null;
    const raw = (result.data as Record<string, unknown> | null)?.["ticksPerLitre"];
    if (raw == null) return null;
    const n = Number(raw);
    return isNaN(n) || n <= 0 ? null : n;
  } catch {
    return null;
  }
}

export async function fetchAssetImei(assetId: string): Promise<string | null> {
  try {
    const result = await ewaterFetch(
      "state",
      `/api/Asset/GetIdentifiersByAssetId?assetId=${encodeURIComponent(assetId)}`,
    );
    if (result.status !== 200) return null;
    const data = result.data as Record<string, unknown> | null;
    const idList = Array.isArray(data?.["identifiers"])
      ? (data!["identifiers"] as Record<string, unknown>[])
      : [];
    for (const entry of idList) {
      const imei = strOrNull(entry["imei"]);
      if (imei) return imei;
    }
    return null;
  } catch {
    return null;
  }
}

// Primary source: EWC `LitresConversion` setting. Falls back to
// GetTicksPerLitre when that setting is missing/invalid (resolves an LCF for
// more assets, e.g. 1846 which has no LitresConversion setting).
export async function fetchAssetLcf(assetId: string): Promise<number | null> {
  try {
    const result = await ewaterFetch(
      "state",
      `/api/Asset/GetSettingsMapForAsset?assetId=${encodeURIComponent(assetId)}`,
    );
    if (result.status === 200) {
      const settingsRaw = result.data as Record<string, unknown>;
      const inner = settingsRaw?.["data"] as Record<string, unknown> | null | undefined;
      const settings: Record<string, unknown>[] = Array.isArray(inner?.["settings"])
        ? (inner!["settings"] as Record<string, unknown>[])
        : Array.isArray(settingsRaw?.["settings"])
          ? (settingsRaw!["settings"] as Record<string, unknown>[])
          : [];
      const s = settings.find((x) => x["settingKey"] === "LitresConversion");
      const val = (s?.["value"] as Record<string, unknown> | null)?.["lastKnownValue"];
      if (val != null) {
        const n = Number(val);
        if (!isNaN(n) && n > 0) return n;
      }
    }
  } catch {
    // ignore — fall through to GetTicksPerLitre fallback
  }
  return fetchTicksPerLitre(assetId);
}

// ---------------------------------------------------------------------------
// EWC settings (FCF, LCF, FX, Preload, price of water, + all raw settings)
// ---------------------------------------------------------------------------

async function fetchSettingsList(assetId: string | number): Promise<Record<string, unknown>[]> {
  const result = await ewaterFetch("state", `/api/Asset/GetSettingsMapForAsset?assetId=${encodeURIComponent(assetId)}`);
  const settingsRaw = result.status === 200 ? (result.data as Record<string, unknown>) : null;
  const inner = settingsRaw?.["data"] as Record<string, unknown> | null | undefined;
  return Array.isArray(inner?.["settings"])
    ? (inner!["settings"] as Record<string, unknown>[])
    : Array.isArray(settingsRaw?.["settings"])
      ? (settingsRaw!["settings"] as Record<string, unknown>[])
      : [];
}

export interface EwcSettings {
  ewcFcf: number | null;
  ewcLcf: number | null;
  ewcFx: number | null;
  ewcPreload: number | null;
  priceOfWater: number | null;
  flowPreloadCharge: number | null;
  flowPreloadThreshold: number | null;
  valveDriveTime: number | null;
  dispenseTimeLimitMins: number | null;
  dispenseFlowLimitLpm: number | null;
  noFlowCycleCount: number | null;
  noFlowPulseCount: number | null;
  noFlowLockoutMins: number | null;
  noFlowErrorControl: number | null;
  lowBatteryWarningAdc: number | null;
  highBatteryValueAdc: number | null;
  healthStateReportPeriod: number | null;
  firstExtendedPolling: number | null;
  secondExtendedPolling: number | null;
  mifareBlockAddress: number | null;
  ewcAccessKey: number | null;
  encryptionControl: number | null;
  encryptionSeed: number | null;
  keyA: number | null;
  ewcAuthCode: number | null;
  supertapEncryptionMask: number | null;
  smartDisplayControl: number | null;
  proximityDetection: number | null;
  ewcDeviceId: number | null;
  powerCount: number | null;
  settingsDate: string | null;
}

export async function getAssetEwcSettings(assetId: string | number): Promise<EwcSettings> {
  const settings = await fetchSettingsList(assetId);

  const getSetting = (key: string): number | null => {
    const s = settings.find((x) => x["settingKey"] === key);
    if (!s) return null;
    const val = (s["value"] as Record<string, unknown> | null)?.["lastKnownValue"];
    if (val == null) return null;
    const n = Number(val);
    return isNaN(n) ? null : n;
  };

  const fcf = getSetting("FlowConversion");
  let lcf = getSetting("LitresConversion");
  const fx = getSetting("CurrencyConversion");
  const preload = getSetting("FlowPreloadCharge");
  if (lcf == null || lcf <= 0) {
    lcf = await fetchTicksPerLitre(String(assetId));
  }
  const priceOfWater = fcf != null && lcf != null && fx != null && fcf > 0
    ? (fx * lcf) / (fcf * 1_000_000)
    : null;

  const settingsDate = (() => {
    const dates = settings
      .map((s) => (s["value"] as Record<string, unknown> | null)?.["lastKnownDate"])
      .filter((d): d is string => typeof d === "string" && d.length > 0);
    if (dates.length === 0) return null;
    return dates.sort().at(-1) ?? null;
  })();

  return {
    ewcFcf: fcf,
    ewcLcf: lcf,
    ewcFx: fx,
    ewcPreload: preload,
    priceOfWater,
    flowPreloadCharge: getSetting("FlowPreloadCharge"),
    flowPreloadThreshold: getSetting("FlowPreloadThreshold"),
    valveDriveTime: getSetting("ValveDriveTime"),
    dispenseTimeLimitMins: getSetting("DispenseTimeLimit"),
    dispenseFlowLimitLpm: getSetting("DispenseFlowLimit"),
    noFlowCycleCount: getSetting("NoFlowCycleCount"),
    noFlowPulseCount: getSetting("NoFlowPulseCount"),
    noFlowLockoutMins: getSetting("NoFlowLockoutTimeout"),
    noFlowErrorControl: getSetting("NoFlowErrorControl"),
    lowBatteryWarningAdc: getSetting("LowBatteryWarning"),
    highBatteryValueAdc: getSetting("HighBatteryValue"),
    healthStateReportPeriod: getSetting("HealthStateReportPeriod"),
    firstExtendedPolling: getSetting("FirstExtendedPolling"),
    secondExtendedPolling: getSetting("SecondExtendedPolling"),
    mifareBlockAddress: getSetting("MiFareBlockAddress"),
    ewcAccessKey: getSetting("EwcAccessKey"),
    encryptionControl: getSetting("EncryptionControl"),
    encryptionSeed: getSetting("EncryptionSeed"),
    keyA: getSetting("KeyA"),
    ewcAuthCode: getSetting("EwcAuthCode"),
    supertapEncryptionMask: getSetting("SupertapEncryptionMask"),
    smartDisplayControl: getSetting("SmartDisplayControl"),
    proximityDetection: getSetting("ProximityDetection"),
    ewcDeviceId: getSetting("EwcId"),
    powerCount: getSetting("PowerCount"),
    settingsDate,
  };
}

// ---------------------------------------------------------------------------
// Most recent flow rate from last 24 h of EWC logs
// ---------------------------------------------------------------------------

export interface FlowRateResult {
  flowRate: number | null;
  timestamp: string | null;
  timedOut: boolean;
}

const DISPENSE_EVENTS = new Set([0x09, 0x0b]);

export async function getAssetFlowRate(assetId: string | number): Promise<FlowRateResult> {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 24 * 3600 * 1000);

  const result = await ewaterFetch("state", "/api/Asset/GetLogsForAssetByReceivedDate", {
    method: "POST",
    body: JSON.stringify({
      assetId: Number(assetId),
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      pipeline: null,
    }),
  });

  if (result.status !== 200) {
    return { flowRate: null, timestamp: null, timedOut: true };
  }

  const body = result.data as Record<string, unknown>;
  const lines = Array.isArray(body["logLines"]) ? (body["logLines"] as Record<string, unknown>[]) : [];

  lines.sort((a, b) =>
    new Date(String(b["timeReceived"] ?? 0)).getTime() -
    new Date(String(a["timeReceived"] ?? 0)).getTime()
  );

  const lcf = await fetchAssetLcf(String(assetId));
  if (lcf == null) {
    return { flowRate: null, timestamp: null, timedOut: false };
  }

  for (const line of lines) {
    const payload = strOrNull(line["payload"]);
    const time = strOrNull(line["timeReceived"]);
    if (!payload || !time) continue;
    try {
      const bytes = Array.from(atob(payload), (c) => c.charCodeAt(0));
      if (bytes.length !== 39 || bytes[0] !== 0x44) continue;

      const eventType = bytes[5]!;
      if (!DISPENSE_EVENTS.has(eventType)) continue;

      const fc = bytes[28]! * 65536 + bytes[29]! * 256 + bytes[30]!;
      const ft = bytes[31]! * 256 + bytes[32]!;

      if (ft > 10 && fc > 0) {
        const flowRate = Math.round((60 * fc / (lcf * ft)) * 100) / 100;
        return { flowRate, timestamp: time, timedOut: false };
      }
    } catch {
      // skip malformed
    }
  }

  return { flowRate: null, timestamp: null, timedOut: true };
}

// ---------------------------------------------------------------------------
// Dispense volume histogram + KDE (10–30 L window, 1 L bins)
// See .agents/memory/ewater-api.md "Dispense-volume calibration analysis" for
// the full derivation of the calibration model.
// ---------------------------------------------------------------------------

const DISPENSE_VOL_MIN = 10;
const DISPENSE_VOL_MAX = 30;
const DISPENSE_KDE_GRID_STEP = 0.05;
const DISPENSE_MIN_SAMPLES = 10;

export interface DispenseVolumeStats {
  bins: { binStart: number; count: number }[];
  sampleCount: number;
  currentLcf: number | null;
  currentPreload: number | null;
  measuredPreload: number | null;
  preloadSampleCount: number;
  kdeCurve: { x: number; y: number }[];
  kdePeak: number | null;
  suggestedLcf: number | null;
}

export function computeDispenseVolumeStats(
  volumes: number[],
  lcf: number | null,
  preload: number | null,
  noCreditTicks: number[],
): DispenseVolumeStats {
  const preloadSampleCount = noCreditTicks.length;
  const measuredPreload =
    preloadSampleCount > 0
      ? Math.round((noCreditTicks.reduce((s, v) => s + v, 0) / preloadSampleCount) * 10) / 10
      : null;
  const bins: { binStart: number; count: number }[] = [];
  for (let b = DISPENSE_VOL_MIN; b < DISPENSE_VOL_MAX; b++) {
    bins.push({ binStart: b, count: 0 });
  }
  for (const v of volumes) {
    const idx = Math.min(Math.floor(v) - DISPENSE_VOL_MIN, bins.length - 1);
    if (idx >= 0 && idx < bins.length) bins[idx]!.count++;
  }

  const n = volumes.length;
  const base = {
    bins,
    sampleCount: n,
    currentLcf: lcf != null && lcf > 0 ? lcf : null,
    currentPreload: preload,
    measuredPreload,
    preloadSampleCount,
  };
  if (n < DISPENSE_MIN_SAMPLES || lcf == null || lcf <= 0) {
    return {
      ...base,
      kdeCurve: [],
      kdePeak: null,
      suggestedLcf: null,
    };
  }

  const mean = volumes.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(volumes.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  const sorted = [...volumes].sort((a, b) => a - b);
  const quantile = (p: number): number => {
    const pos = (sorted.length - 1) * p;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
  };
  const iqr = quantile(0.75) - quantile(0.25);
  let h = 0.9 * Math.min(sd, iqr / 1.34) * Math.pow(n, -0.2);
  if (!(h > 0)) h = 0.9 * (sd > 0 ? sd : 0.5) * Math.pow(n, -0.2);
  if (!(h > 0)) h = 0.5;

  const invNH = 1 / (n * h * Math.sqrt(2 * Math.PI));
  let peakX = DISPENSE_VOL_MIN;
  let peakY = -Infinity;
  const kdeCurve: { x: number; y: number }[] = [];
  const steps = Math.round((DISPENSE_VOL_MAX - DISPENSE_VOL_MIN) / DISPENSE_KDE_GRID_STEP);
  for (let i = 0; i <= steps; i++) {
    const x = DISPENSE_VOL_MIN + i * DISPENSE_KDE_GRID_STEP;
    let density = 0;
    for (const v of volumes) {
      const u = (x - v) / h;
      density += Math.exp(-0.5 * u * u);
    }
    density *= invNH;
    if (density > peakY) {
      peakY = density;
      peakX = x;
    }
    kdeCurve.push({ x: Math.round(x * 100) / 100, y: density });
  }

  const scaledCurve = kdeCurve.map((p) => ({
    x: p.x,
    y: Math.round(p.y * n * 1000) / 1000,
  }));

  const kdePeak = Math.round(peakX * 100) / 100;
  const suggestedLcfRaw = Math.round((kdePeak * lcf - (measuredPreload ?? 0)) / 20);

  return {
    ...base,
    kdeCurve: scaledCurve,
    kdePeak,
    suggestedLcf: suggestedLcfRaw > 0 ? suggestedLcfRaw : null,
  };
}

// ---------------------------------------------------------------------------
// eSense charts — tank height, daily inflow, voltage, flow-rate history, and
// dispense-volume calibration stats over N days.
// ---------------------------------------------------------------------------

export interface EsenseChartsResult {
  tankHeight: {
    time: string;
    waterTank: number | null;
    waterTankMin: number | null;
    waterTankMax: number | null;
    chlorineTank: number | null;
    chlorineTankMin: number | null;
    chlorineTankMax: number | null;
  }[];
  dailyInflow: { date: string; litres: number }[];
  voltageHistory: { time: string; value: number }[];
  voltageStatus: {
    current: number | null;
    todayHigh: number | null;
    todayLow: number | null;
    todayAverage: number | null;
    trend: string | null;
  } | null;
  flowRateHistory: { time: string; flowRate: number; ticks: number; flowTimeSec: number }[];
  dispenseVolumes: DispenseVolumeStats;
}

const DISPENSE_EVENT_TYPES = new Set([0x09, 0x0b]);
const NO_CREDIT_EVENT_TYPE = 0x01;

export async function getAssetEsenseCharts(assetIdInput: string | number, daysInput: number): Promise<EsenseChartsResult> {
  const assetId = Number(assetIdInput);
  if (isNaN(assetId)) {
    throw new Error("Invalid asset ID");
  }
  const days = Math.min(Math.max(daysInput, 1), 180);

  const now = new Date();
  const startDate = new Date(now.getTime() - days * 86400 * 1000).toISOString().slice(0, 19);
  const endDate = now.toISOString().slice(0, 19);

  const todayMidnight = new Date(now);
  todayMidnight.setHours(0, 0, 0, 0);
  const yesterdayEnd = new Date(todayMidnight.getTime() - 1000).toISOString().slice(0, 19);
  const todayStart = todayMidnight.toISOString().slice(0, 19);
  const needsTodaySupp = days > 5;

  const [tankRes, inflowRes, powerRes, todayTankRes, logsRes, settingsRes] = await Promise.allSettled([
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
    ewaterFetch("state", "/api/Asset/GetLogsForAssetByReceivedDate", {
      method: "POST",
      body: JSON.stringify({ assetId, startDate, endDate, pipeline: null }),
    }),
    ewaterFetch("state", `/api/Asset/GetSettingsMapForAsset?assetId=${encodeURIComponent(assetId)}`),
  ]);

  function parseTankRaw(res: PromiseSettledResult<{ status: number; data: unknown }>): Record<string, unknown>[] {
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

  const logsOk =
    logsRes.status === "fulfilled" && logsRes.value.status === 200
      ? (logsRes.value.data as Record<string, unknown>)
      : null;
  const logLines = Array.isArray(logsOk?.["logLines"])
    ? (logsOk!["logLines"] as Record<string, unknown>[])
    : [];

  const settingsOk = settingsRes.status === "fulfilled" && settingsRes.value.status === 200
    ? (settingsRes.value.data as Record<string, unknown>)
    : null;
  const settingsInner = settingsOk?.["data"] as Record<string, unknown> | null | undefined;
  const settingsList: Record<string, unknown>[] = Array.isArray(settingsInner?.["settings"])
    ? (settingsInner!["settings"] as Record<string, unknown>[])
    : Array.isArray(settingsOk?.["settings"])
      ? (settingsOk!["settings"] as Record<string, unknown>[])
      : [];
  const lcfSetting = settingsList.find((x) => x["settingKey"] === "LitresConversion");
  const lcfRaw = (lcfSetting?.["value"] as Record<string, unknown> | null)?.["lastKnownValue"];
  const lcfFromSetting = lcfRaw != null && !isNaN(Number(lcfRaw)) ? Number(lcfRaw) : null;
  const lcf = lcfFromSetting != null && lcfFromSetting > 0
    ? lcfFromSetting
    : await fetchTicksPerLitre(String(assetId));

  const preloadSetting = settingsList.find((x) => x["settingKey"] === "FlowPreloadCharge");
  const preloadRaw = (preloadSetting?.["value"] as Record<string, unknown> | null)?.["lastKnownValue"];
  const currentPreload = preloadRaw != null && !isNaN(Number(preloadRaw)) ? Number(preloadRaw) : null;

  const voltageHistory: { time: string; value: number }[] = [];
  const flowRateHistory: { time: string; flowRate: number; ticks: number; flowTimeSec: number }[] = [];
  const dispenseVolumesRaw: number[] = [];
  const noCreditTicks: number[] = [];

  for (const line of logLines) {
    const payload = strOrNull(line["payload"]);
    const time = strOrNull(line["timeReceived"]);
    if (!payload || !time) continue;
    try {
      const bytes = Array.from(atob(payload), (c) => c.charCodeAt(0));
      if (bytes.length !== 39 || bytes[0] !== 0x44) continue;

      const adcRaw = bytes[16]!;
      const volts = Math.round((adcRaw / 256) * 15 * 100) / 100;
      voltageHistory.push({ time, value: volts });

      const eventType = bytes[5]!;
      const fc = bytes[28]! * 65536 + bytes[29]! * 256 + bytes[30]!;

      if (eventType === NO_CREDIT_EVENT_TYPE) {
        noCreditTicks.push(bytes[18]! * 256 + bytes[19]!);
        continue;
      }
      if (!DISPENSE_EVENT_TYPES.has(eventType)) continue;
      const ft = bytes[31]! * 256 + bytes[32]!;
      if (lcf != null && ft > 10 && fc > 0) {
        const flowRate = Math.round((60 * fc / (lcf * ft)) * 1000) / 1000;
        flowRateHistory.push({ time, flowRate, ticks: fc, flowTimeSec: ft });
      }

      if (lcf != null && lcf > 0 && fc > 0) {
        const litres = fc / lcf;
        if (litres >= 10 && litres <= 30) dispenseVolumesRaw.push(litres);
      }
    } catch {
      // skip malformed
    }
  }

  voltageHistory.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  flowRateHistory.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  const dispenseVolumes = computeDispenseVolumeStats(dispenseVolumesRaw, lcf, currentPreload, noCreditTicks);

  return {
    tankHeight,
    dailyInflow,
    voltageHistory,
    voltageStatus,
    flowRateHistory,
    dispenseVolumes,
  };
}

// ---------------------------------------------------------------------------
// Calibration / NRW gap analysis — derived from the dispense-volume stats.
// Surfaces the LCF gap %, implied-correct LCF, and preload gap explicitly so
// an LLM client can reason about non-revenue-water (NRW) causes directly,
// without re-deriving them from the raw KDE/histogram data.
// ---------------------------------------------------------------------------

export interface CalibrationAnalysis {
  assetId: string;
  sampleCount: number;
  hasSufficientData: boolean;
  currentLcf: number | null;
  suggestedLcf: number | null;
  lcfGapPercent: number | null;
  currentPreload: number | null;
  measuredPreload: number | null;
  preloadGap: number | null;
  typicalDispenseLitres: number | null;
  interpretation: string;
}

export async function getCalibrationAnalysis(assetIdInput: string | number, daysInput: number): Promise<CalibrationAnalysis> {
  const assetId = String(assetIdInput);
  const charts = await getAssetEsenseCharts(assetIdInput, daysInput);
  const dv = charts.dispenseVolumes;

  const hasSufficientData = dv.suggestedLcf != null && dv.currentLcf != null;
  const lcfGapPercent = hasSufficientData
    ? Math.round(((dv.suggestedLcf! - dv.currentLcf!) / dv.currentLcf!) * 1000) / 10
    : null;
  const preloadGap = dv.measuredPreload != null && dv.currentPreload != null
    ? Math.round((dv.measuredPreload - dv.currentPreload) * 10) / 10
    : null;

  let interpretation: string;
  if (!hasSufficientData) {
    interpretation = `Not enough dispense samples in range (${dv.sampleCount}, need >= 10 between 10-30 L) to produce a calibration suggestion.`;
  } else if (lcfGapPercent === 0) {
    interpretation = "Current LCF matches the measured typical dispense — no calibration drift detected.";
  } else {
    const direction = lcfGapPercent! > 0 ? "under-reading" : "over-reading";
    interpretation = `Meter is likely ${direction} usage by ~${Math.abs(lcfGapPercent!)}%. Suggested LCF ${dv.suggestedLcf} vs current ${dv.currentLcf}.` +
      (preloadGap != null && preloadGap !== 0
        ? ` Measured preload (${dv.measuredPreload}) differs from configured preload (${dv.currentPreload}) by ${preloadGap} ticks.`
        : "");
  }

  return {
    assetId,
    sampleCount: dv.sampleCount,
    hasSufficientData,
    currentLcf: dv.currentLcf,
    suggestedLcf: dv.suggestedLcf,
    lcfGapPercent,
    currentPreload: dv.currentPreload,
    measuredPreload: dv.measuredPreload,
    preloadGap,
    typicalDispenseLitres: dv.kdePeak,
    interpretation,
  };
}
