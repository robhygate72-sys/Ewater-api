import { useState, useEffect, useCallback } from "react";

export type PushState = "unsupported" | "denied" | "unsubscribed" | "subscribed" | "loading";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function getVapidKey(): Promise<string> {
  const res = await fetch(`${BASE}/api/ewater/push/vapid-key`);
  if (!res.ok) throw new Error("Push not configured on server");
  const { publicKey } = await res.json();
  return publicKey;
}

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer;
}

async function registerSW(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(`${BASE}/sw.js`, { scope: `${BASE}/` });
}

async function subscribe(reg: ServiceWorkerRegistration): Promise<PushSubscription> {
  const key = await getVapidKey();
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key),
  });
}

async function saveSubscription(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  const res = await fetch(`${BASE}/api/ewater/push/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: sub.endpoint,
      keys: { p256dh: json.keys?.["p256dh"] ?? "", auth: json.keys?.["auth"] ?? "" },
    }),
  });
  if (!res.ok) throw new Error("Failed to save subscription");
}

async function deleteSubscription(sub: PushSubscription): Promise<void> {
  await fetch(`${BASE}/api/ewater/push/subscribe`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  });
  await sub.unsubscribe();
}

export function usePushNotifications() {
  const [state, setState] = useState<PushState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [reg, setReg] = useState<ServiceWorkerRegistration | null>(null);

  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  useEffect(() => {
    if (!supported) { setState("unsupported"); return; }

    (async () => {
      try {
        const registration = await registerSW();
        setReg(registration);
        const permission = Notification.permission;
        if (permission === "denied") { setState("denied"); return; }
        const existing = await registration.pushManager.getSubscription();
        setState(existing ? "subscribed" : "unsubscribed");
      } catch (err) {
        setState("unsubscribed");
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [supported]);

  const enablePush = useCallback(async () => {
    if (!supported || !reg) return;
    setState("loading");
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState("denied"); return; }
      const sub = await subscribe(reg);
      await saveSubscription(sub);
      setState("subscribed");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("unsubscribed");
    }
  }, [supported, reg]);

  const disablePush = useCallback(async () => {
    if (!supported || !reg) return;
    setState("loading");
    setError(null);
    try {
      const sub = await reg.pushManager.getSubscription();
      if (sub) await deleteSubscription(sub);
      setState("unsubscribed");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("subscribed");
    }
  }, [supported, reg]);

  return { state, error, enablePush, disablePush };
}
