import { logger } from "./logger";

const EWATER_BASES: Record<string, string> = {
  auth: "https://auth.ewater.io",
  query: "https://query.ewater.io",
  state: "https://state.ewater.io",
  command: "https://command.ewater.io",
};

interface Credentials {
  clientId: string;
  clientSecret: string;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

let credentials: Credentials | null = null;
let tokenCache: TokenCache | null = null;

export function setCredentials(creds: Credentials): void {
  credentials = creds;
  tokenCache = null;
}

export function clearCredentials(): void {
  credentials = null;
  tokenCache = null;
}

export function getCredentials(): Credentials | null {
  return credentials;
}

export async function getToken(): Promise<string> {
  if (!credentials) {
    throw new Error("No credentials configured");
  }

  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 30_000) {
    return tokenCache.token;
  }

  logger.info("Refreshing eWater token");

  const res = await fetch(`${EWATER_BASES.auth}/api/Client/GetToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    }),
  });

  // eWater always returns 200, even on error — check body for errorDescription
  const data = (await res.json().catch(() => null)) as unknown;

  if (!res.ok || !data) {
    logger.warn({ status: res.status }, "Failed to get eWater token");
    throw new Error(`Token request failed: ${res.status} ${res.statusText}`);
  }

  let token: string;
  let expiresInSeconds = 300;

  if (typeof data === "string") {
    token = data;
  } else if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;

    // Real eWater shape: { accessToken, expiresIn, errorDescription }
    const accessToken = obj["accessToken"] ?? obj["access_token"] ?? obj["token"] ?? obj["Token"];

    if (!accessToken) {
      const desc = String(obj["errorDescription"] ?? obj["error"] ?? "Invalid credentials");
      throw new Error(desc);
    }

    token = String(accessToken);

    if (typeof obj["expiresIn"] === "number") {
      expiresInSeconds = obj["expiresIn"] as number;
    } else if (typeof obj["expires_in"] === "number") {
      expiresInSeconds = obj["expires_in"] as number;
    }
  } else {
    token = String(data);
  }

  tokenCache = {
    token,
    expiresAt: now + expiresInSeconds * 1000,
  };

  return token;
}

export function getTokenExpiresAt(): string | null {
  if (!tokenCache) return null;
  return new Date(tokenCache.expiresAt).toISOString();
}

export async function ewaterFetch(
  api: string,
  path: string,
  options: RequestInit = {}
): Promise<{ status: number; data: unknown }> {
  const base = EWATER_BASES[api];
  if (!base) {
    throw new Error(`Unknown eWater API: ${api}. Use: auth, query, state, command`);
  }

  const token = await getToken();
  const url = `${base}${path.startsWith("/") ? path : "/" + path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers,
    },
  });

  let data: unknown;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    data = await res.json().catch(() => null);
  } else {
    data = await res.text().catch(() => "");
  }

  return { status: res.status, data };
}

export type { Credentials };
