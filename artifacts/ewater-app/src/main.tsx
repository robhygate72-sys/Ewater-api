import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if ("serviceWorker" in navigator) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  navigator.serviceWorker
    .register(`${base}/sw.js`, { scope: `${base}/` })
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// Global crash reporter — sends unhandled JS errors to the server so the
// developer can read them in server logs even without opening DevTools.
// ---------------------------------------------------------------------------
function postCrash(payload: {
  message: string;
  stack?: string;
  source: string;
  componentStack?: string;
}) {
  try {
    fetch("/api/ewater/hhc/debug-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // never throw from the error reporter
  }
}

window.addEventListener("error", (ev) => {
  postCrash({
    source: "window.onerror",
    message: ev.message ?? String(ev.error),
    stack: (ev.error as Error | null)?.stack,
  });
});

window.addEventListener("unhandledrejection", (ev) => {
  const err = ev.reason as Error | null;
  postCrash({
    source: "unhandledrejection",
    message: err?.message ?? String(ev.reason),
    stack: err?.stack,
  });
});

// Expose helper for React error boundary componentDidCatch
(window as unknown as Record<string, unknown>).__reportCrash = postCrash;

createRoot(document.getElementById("root")!).render(<App />);
