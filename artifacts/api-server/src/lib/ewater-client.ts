import { logger } from "./logger";

const EWATER_BASES: Record<string, string> = {
  auth: "https://auth.ewater.io",
  query: "https://query.ewater.io",
  state: "https://state.ewater.io",
  command: "https://command.ewater.io",
};

interface Credentials {
  username: string;
  password: string;
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
  if (tokenCache && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.token;
  }

  logger.info("Refreshing eWater token via web login");

  // Step 1: GET the login page to obtain the antiforgery cookie + CSRF token
  const loginPageRes = await fetch(`${EWATER_BASES.auth}`, {
    method: "GET",
    redirect: "follow",
  });

  const loginPageHtml = await loginPageRes.text();

  // Extract CSRF token from the hidden form field
  const csrfMatch = loginPageHtml.match(
    /name="__RequestVerificationToken"\s+type="hidden"\s+value="([^"]+)"/
  );
  if (!csrfMatch) {
    throw new Error("Could not retrieve login form — eWater auth page may be unavailable");
  }
  const csrfToken = csrfMatch[1];

  // Extract antiforgery cookie from response
  const rawCookie = loginPageRes.headers.get("set-cookie") ?? "";
  const antiforgeryCookie = rawCookie.match(/\.AspNetCore\.Antiforgery\.[^=]+=([^;]+)/)?.[0] ?? "";

  // Step 2: POST the login form
  const formData = new URLSearchParams();
  formData.append("Username", credentials.username);
  formData.append("Password", credentials.password);
  formData.append("ReturnUrl", "/swagger");
  formData.append("__RequestVerificationToken", csrfToken);

  const loginRes = await fetch(`${EWATER_BASES.auth}/User/LoginViaForm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(antiforgeryCookie ? { Cookie: antiforgeryCookie } : {}),
    },
    body: formData.toString(),
    redirect: "manual",
  });

  // Successful login returns 302 with access_token in Set-Cookie
  if (loginRes.status !== 302) {
    // If we got 200, login failed (shows the form again with error)
    throw new Error("Invalid username or password");
  }

  const setCookie = loginRes.headers.get("set-cookie") ?? "";
  const tokenMatch = setCookie.match(/access_token=([^;]+)/);
  if (!tokenMatch) {
    throw new Error("Login succeeded but no access token was returned");
  }

  const token = tokenMatch[1];
  // Web login tokens expire in 3600 seconds (1 hour)
  tokenCache = {
    token,
    expiresAt: now + 3600 * 1000,
  };

  logger.info("eWater token refreshed successfully");
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
