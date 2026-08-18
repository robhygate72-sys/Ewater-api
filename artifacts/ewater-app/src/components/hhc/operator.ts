// Operator session handling. The server issues an HMAC-signed operator token
// via POST /ewater/hhc/auth/login (access key checked server-side); identity
// and role come from the verified token, never from client-asserted values.

const SESSION_KEY = "hhc-operator-session";

export interface OperatorSessionInfo {
  token: string;
  operator: string;
  role: "operator" | "admin";
  expiresAt: string;
}

export function getSession(): OperatorSessionInfo | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as OperatorSessionInfo;
    if (!s.token || !s.operator) return null;
    if (s.expiresAt && new Date(s.expiresAt).getTime() < Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function saveSession(s: OperatorSessionInfo): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

export function getOperator(): string {
  return getSession()?.operator ?? "";
}

export function isAdminRole(): boolean {
  return getSession()?.role === "admin";
}

export function operatorHeaders(): Record<string, string> {
  const s = getSession();
  return s ? { authorization: `Bearer ${s.token}` } : {};
}
