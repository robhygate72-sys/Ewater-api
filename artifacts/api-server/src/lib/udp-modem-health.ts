const UDP_MODEM_BASE_URL = "https://udp.ewater.io/api/health/imei";
const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const SUCCESS_CACHE_TTL_MS = 60_000;
const FAILURE_CACHE_TTL_MS = 15_000;
const ONLINE_WINDOW_MS = 48 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const MAX_IMEIS_PER_ASSET = 12;
const MAX_CONCURRENT_LOOKUPS = 3;

export type UdpModemFetchStatus =
  | "success"
  | "not_found"
  | "invalid_imei"
  | "invalid_response"
  | "timeout"
  | "unavailable";

export interface UdpModemHealth {
  imei: string;
  fetchStatus: UdpModemFetchStatus;
  fetchedAt: string;
  lastSyncAt: string | null;
  network: string | null;
  firmwareVersion: string | null;
  iccid: string | null;
  modemType: string | null;
  signal: string | null;
  endpoint: string | null;
  serverLedgerLag: number | null;
  source: "ewater_udp";
  error: string | null;
}

export interface UdpCommunicationsSummary {
  status: "online" | "offline" | "unknown";
  selectedImei: string | null;
  lastSyncAt: string | null;
  ageSeconds: number | null;
  source: "ewater_udp";
  reason: string;
}

export interface AssetUdpHealth {
  assetId: string;
  imeis: string[];
  modems: UdpModemHealth[];
  lookupLimited: boolean;
  omittedImeiCount: number;
  summary: UdpCommunicationsSummary;
  fetchedAt: string;
}

interface FetchOptions {
  fetchImpl?: typeof fetch;
  now?: Date;
  timeoutMs?: number;
  maxResponseBytes?: number;
  useCache?: boolean;
}

interface CacheEntry {
  expiresAt: number;
  value: UdpModemHealth;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<UdpModemHealth>>();

export function isValidImei(value: string): boolean {
  return /^\d{15}$/.test(value);
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function addEntry(entries: Map<string, string>, label: string, value: string): void {
  const key = normaliseLabel(stripHtml(label));
  const cleanValue = stripHtml(value);
  if (key && cleanValue && !entries.has(key)) entries.set(key, cleanValue);
}

function extractEntries(html: string): Map<string, string> {
  const entries = new Map<string, string>();

  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map((m) => m[1]);
    if (cells.length >= 2) addEntry(entries, cells[0], cells.slice(1).join(" "));
  }

  for (const pair of html.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)) {
    const term = stripHtml(pair[1]);
    // The live UDP health page puts the value in the <dt> itself:
    //   <dt>Last sync date time: 2026-08-20 08:16:52 (8.8 min ago)</dt>
    // and uses <dd> only for explanatory help text.
    const inline = term.match(/^([^:]{2,80}):\s*(.*)$/);
    if (inline) addEntry(entries, inline[1], inline[2]);
    else addEntry(entries, pair[1], pair[2]);
  }

  const lineText = decodeHtml(
    html
      .replace(/<(?:br|\/p|\/li|\/div|\/section|\/article|\/h[1-6])\b[^>]*>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  );
  for (const rawLine of lineText.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    const match = line.match(/^([^:=]{2,80})\s*[:=]\s*(.{1,500})$/);
    if (match) addEntry(entries, match[1], match[2]);
  }

  return entries;
}

function firstEntry(entries: Map<string, string>, labels: string[]): string | null {
  for (const label of labels) {
    const value = entries.get(normaliseLabel(label));
    if (value && !/^(?:n\/?a|none|null|unknown|never|-+)$/i.test(value.trim())) return value.trim();
  }
  return null;
}

function parseTimestamp(value: string | null): string | null {
  if (!value) return null;
  const clean = value
    .replace(/\s+\([^)]*\s+ago\)\s*$/i, "")
    .replace(/\s+UTC$/i, "Z")
    .trim();
  const explicitUtc = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(clean)
    ? `${clean.replace(" ", "T")}Z`
    : clean;
  const timestamp = Date.parse(explicitUtc);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function emptyResult(
  imei: string,
  fetchStatus: UdpModemFetchStatus,
  fetchedAt: string,
  error: string | null,
): UdpModemHealth {
  return {
    imei,
    fetchStatus,
    fetchedAt,
    lastSyncAt: null,
    network: null,
    firmwareVersion: null,
    iccid: null,
    modemType: null,
    signal: null,
    endpoint: null,
    serverLedgerLag: null,
    source: "ewater_udp",
    error,
  };
}

export function parseUdpModemHealthHtml(
  imei: string,
  html: string,
  fetchedAt = new Date().toISOString(),
): UdpModemHealth {
  if (!isValidImei(imei)) return emptyResult(imei, "invalid_imei", fetchedAt, "Invalid IMEI");
  if (!html.trim() || /<h1[^>]*>\s*(?:not found|unauthori[sz]ed)\s*<\/h1>/i.test(html)) {
    return emptyResult(imei, "not_found", fetchedAt, "Modem health was not found");
  }

  const entries = extractEntries(html);
  const found = firstEntry(entries, ["Found"]);
  if (found && /^(?:false|no|0)$/i.test(found)) {
    return emptyResult(imei, "not_found", fetchedAt, "Modem health was not found");
  }
  const pageImei = firstEntry(entries, ["IMEI", "Modem IMEI", "Device IMEI"]);
  if (pageImei && pageImei.replace(/\D/g, "") !== imei) {
    return emptyResult(imei, "invalid_response", fetchedAt, "UDP response IMEI did not match the requested modem");
  }

  const lastSyncAt = parseTimestamp(firstEntry(entries, [
    "Last sync",
    "Last sync date time",
    "Last sync at",
    "Latest sync",
    "Most recent sync",
    "Last connected",
    "Last communication",
    "Last communications",
    "Last seen",
    "Last packet",
  ]));
  const network = firstEntry(entries, ["Network", "Mobile network", "Operator", "Carrier", "Network operator"]);
  const firmwareVersion = firstEntry(entries, [
    "Modem firmware",
    "Modem firmware version",
    "Firmware",
    "Firmware version",
    "Software version",
    "Last reported ESP32 firmware",
  ]);
  const iccid = firstEntry(entries, ["ICCID", "SIM ICCID", "SIM card"]);
  const modemType = firstEntry(entries, ["Modem type", "Modem model", "Model", "Module"]);
  const signal = firstEntry(entries, ["Signal", "Signal strength", "RSSI", "RSRP"]);
  const endpoint = firstEntry(entries, ["Endpoint", "Last endpoint", "Network endpoint"]);
  const ledgerLagRaw = firstEntry(entries, ["Server ledger lag"]);
  const serverLedgerLag = ledgerLagRaw != null && Number.isFinite(Number(ledgerLagRaw))
    ? Number(ledgerLagRaw)
    : null;

  if (
    entries.size === 0 ||
    (
      !/^(?:true|yes|1)$/i.test(found ?? "") &&
      ![lastSyncAt, network, firmwareVersion, iccid, modemType, signal, endpoint].some(Boolean)
    )
  ) {
    return emptyResult(imei, "invalid_response", fetchedAt, "UDP response did not contain recognised modem health fields");
  }

  return {
    imei,
    fetchStatus: "success",
    fetchedAt,
    lastSyncAt,
    network,
    firmwareVersion,
    iccid,
    modemType,
    signal,
    endpoint,
    serverLedgerLag,
    source: "ewater_udp",
    error: null,
  };
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("UDP response exceeded the size limit");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("UDP response exceeded the size limit");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function fetchUncached(imei: string, options: FetchOptions): Promise<UdpModemHealth> {
  const now = options.now ?? new Date();
  const fetchedAt = now.toISOString();
  if (!isValidImei(imei)) return emptyResult(imei, "invalid_imei", fetchedAt, "Invalid IMEI");

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await (options.fetchImpl ?? fetch)(
      `${UDP_MODEM_BASE_URL}/${encodeURIComponent(imei)}`,
      {
        method: "GET",
        headers: {
          Accept: "text/html",
        },
        signal: controller.signal,
      },
    );

    if (response.status === 404 || response.status === 450) {
      return emptyResult(imei, "not_found", fetchedAt, "Modem health was not found");
    }
    if (!response.ok) {
      return emptyResult(imei, "unavailable", fetchedAt, `UDP service returned HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html")) {
      return emptyResult(imei, "invalid_response", fetchedAt, "UDP service returned an unexpected content type");
    }
    const html = await readBoundedText(response, maxBytes);
    return parseUdpModemHealthHtml(imei, html, fetchedAt);
  } catch (error) {
    const timedOut = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
    return emptyResult(
      imei,
      timedOut ? "timeout" : "unavailable",
      fetchedAt,
      timedOut ? "UDP service timed out" : "UDP service was unavailable",
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchUdpModemHealth(
  rawImei: string,
  options: FetchOptions = {},
): Promise<UdpModemHealth> {
  const imei = rawImei.trim();
  const useCache = options.useCache !== false && options.fetchImpl == null && options.now == null;
  const nowMs = Date.now();
  if (useCache) {
    const cached = cache.get(imei);
    if (cached && cached.expiresAt > nowMs) {
      // Promote cache hits so insertion order is also least-recently-used order.
      cache.delete(imei);
      cache.set(imei, cached);
      return cached.value;
    }
    cache.delete(imei);
    const pending = inFlight.get(imei);
    if (pending) return pending;
  }

  const request = fetchUncached(imei, options);
  if (useCache) inFlight.set(imei, request);
  try {
    const result = await request;
    if (useCache) {
      const ttl = result.fetchStatus === "success" ? SUCCESS_CACHE_TTL_MS : FAILURE_CACHE_TTL_MS;
      cache.set(imei, { expiresAt: Date.now() + ttl, value: result });
      if (cache.size > MAX_CACHE_ENTRIES) {
        const sweepAt = Date.now();
        for (const [key, entry] of cache) if (entry.expiresAt <= sweepAt) cache.delete(key);
        while (cache.size > MAX_CACHE_ENTRIES) {
          const oldestKey = cache.keys().next().value as string | undefined;
          if (oldestKey == null) break;
          cache.delete(oldestKey);
        }
      }
    }
    return result;
  } finally {
    if (useCache && inFlight.get(imei) === request) inFlight.delete(imei);
  }
}

export function summariseUdpCommunications(
  modems: UdpModemHealth[],
  now = new Date(),
): UdpCommunicationsSummary {
  const successful = modems.filter((modem) => modem.fetchStatus === "success");
  const withSync = successful
    .filter((modem): modem is UdpModemHealth & { lastSyncAt: string } => modem.lastSyncAt != null)
    .sort((a, b) => Date.parse(b.lastSyncAt) - Date.parse(a.lastSyncAt));
  const freshest = withSync[0];

  if (!freshest) {
    return {
      status: "unknown",
      selectedImei: successful[0]?.imei ?? null,
      lastSyncAt: null,
      ageSeconds: null,
      source: "ewater_udp",
      reason: successful.length > 0
        ? "UDP health was available but did not include a valid sync time"
        : modems.length === 0
          ? "No IMEI is known for this asset"
          : "UDP modem health is unavailable",
    };
  }

  const ageMs = Math.max(0, now.getTime() - Date.parse(freshest.lastSyncAt));
  const online = ageMs <= ONLINE_WINDOW_MS;
  return {
    status: online ? "online" : "offline",
    selectedImei: freshest.imei,
    lastSyncAt: freshest.lastSyncAt,
    ageSeconds: Math.round(ageMs / 1000),
    source: "ewater_udp",
    reason: online
      ? "Freshest UDP modem sync is within 48 hours"
      : "Freshest UDP modem sync is more than 48 hours old",
  };
}

async function mapWithConcurrency<T, U>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function getAssetUdpHealth(
  assetId: string,
  imeis: string[],
  fetcher: (imei: string) => Promise<UdpModemHealth> = fetchUdpModemHealth,
): Promise<AssetUdpHealth> {
  const uniqueImeis = [...new Set(imeis.map((imei) => imei.trim()).filter(isValidImei))];
  const lookupImeis = uniqueImeis.slice(0, MAX_IMEIS_PER_ASSET);
  const modems = await mapWithConcurrency(lookupImeis, MAX_CONCURRENT_LOOKUPS, fetcher);
  const fetchedAt = new Date().toISOString();
  const omittedImeiCount = uniqueImeis.length - lookupImeis.length;
  const summary = summariseUdpCommunications(modems, new Date(fetchedAt));
  if (omittedImeiCount > 0) {
    summary.reason = `${summary.reason}; ${omittedImeiCount} additional IMEI${omittedImeiCount === 1 ? " was" : "s were"} not queried because the per-asset safety limit is ${MAX_IMEIS_PER_ASSET}`;
  }
  return {
    assetId,
    imeis: uniqueImeis,
    modems,
    lookupLimited: omittedImeiCount > 0,
    omittedImeiCount,
    summary,
    fetchedAt,
  };
}