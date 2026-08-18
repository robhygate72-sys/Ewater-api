// Operator session handling. The server issues an HMAC-signed operator token
// via POST /ewater/hhc/auth/login (access key checked server-side); identity
// and role come from the verified token, never from client-asserted values.
//
// Session state is a small reactive store: components subscribe via
// useOperatorSession() so sign-in/sign-out immediately enables/disables all
// operator controls everywhere, and request headers are derived from the
// current session at execution time.

import { useSyncExternalStore } from "react";

const SESSION_KEY = "hhc-operator-session";

export interface OperatorSessionInfo {
  token: string;
  operator: string;
  role: "operator" | "admin";
  expiresAt: string;
}

function readFromStorage(): OperatorSessionInfo | null {
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

let current: OperatorSessionInfo | null = readFromStorage();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Keep multiple tabs in sync.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === SESSION_KEY || e.key === null) {
      current = readFromStorage();
      emit();
    }
  });
}

export function getSession(): OperatorSessionInfo | null {
  // Drop expired sessions lazily.
  if (current?.expiresAt && new Date(current.expiresAt).getTime() < Date.now()) {
    clearSession();
  }
  return current;
}

/** Reactive hook — re-renders subscribers on sign-in/sign-out (incl. other tabs). */
export function useOperatorSession(): OperatorSessionInfo | null {
  return useSyncExternalStore(subscribe, getSession, () => null);
}

export function saveSession(s: OperatorSessionInfo): void {
  current = s;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
  emit();
}

export function clearSession(): void {
  current = null;
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
  emit();
}

export function getOperator(): string {
  return getSession()?.operator ?? "";
}

export function isAdminRole(): boolean {
  return getSession()?.role === "admin";
}

/** Always derives the Authorization header from the CURRENT session. */
export function operatorHeaders(): Record<string, string> {
  const s = getSession();
  return s ? { authorization: `Bearer ${s.token}` } : {};
}
