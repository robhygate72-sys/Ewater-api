// Operator authentication for HHC commissioning actions.
//
// Operators authenticate with an access key (held server-side in
// HHC_OPERATOR_KEY / HHC_ADMIN_KEY) and receive an HMAC-signed token
// (SESSION_SECRET) embedding their identity and role. All commissioning
// writes verify the token server-side — identity and role are derived from
// verified claims, never from client-supplied headers.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

export type OperatorRole = "operator" | "admin";

export interface OperatorClaims {
  name: string;
  role: OperatorRole;
  exp: number; // unix seconds
}

const TOKEN_TTL_SECONDS = 12 * 60 * 60;

function secret(): string {
  const s = process.env["SESSION_SECRET"];
  if (!s) throw new Error("SESSION_SECRET is not configured");
  return s;
}

const b64url = (buf: Buffer) => buf.toString("base64url");

function sign(payload: string): string {
  return b64url(createHmac("sha256", secret()).update(payload).digest());
}

export function issueOperatorToken(name: string, role: OperatorRole): { token: string; expiresAt: string } {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = b64url(Buffer.from(JSON.stringify({ name, role, exp } satisfies OperatorClaims)));
  return { token: `${payload}.${sign(payload)}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export function verifyOperatorToken(token: string): OperatorClaims | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts as [string, string];
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as OperatorClaims;
    if (typeof claims.name !== "string" || claims.name.trim() === "") return null;
    if (claims.role !== "operator" && claims.role !== "admin") return null;
    if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

// ── Login ────────────────────────────────────────────────────────────────────

function keyMatches(provided: string, envKey: string): boolean {
  const configured = process.env[envKey];
  if (!configured) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(configured);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function accessKeysConfigured(): boolean {
  return Boolean(process.env["HHC_OPERATOR_KEY"] || process.env["HHC_ADMIN_KEY"]);
}

/** Returns the role granted by the access key, or null when it matches neither key. */
export function roleForAccessKey(accessKey: string): OperatorRole | null {
  if (keyMatches(accessKey, "HHC_ADMIN_KEY")) return "admin";
  if (keyMatches(accessKey, "HHC_OPERATOR_KEY")) return "operator";
  return null;
}

// ── Express middleware ───────────────────────────────────────────────────────

export function requireOperatorAuth(requiredRole?: OperatorRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    const claims = token ? verifyOperatorToken(token) : null;
    if (!claims) {
      res.status(401).json({ error: "Operator authentication required (sign in to obtain an operator token)" });
      return;
    }
    if (requiredRole === "admin" && claims.role !== "admin") {
      res.status(403).json({ error: "This action requires the admin role" });
      return;
    }
    res.locals["operator"] = claims;
    next();
  };
}

export function operatorOf(res: Response): OperatorClaims {
  const claims = res.locals["operator"] as OperatorClaims | undefined;
  if (!claims) throw new Error("operatorOf() called on a route without requireOperatorAuth");
  return claims;
}
