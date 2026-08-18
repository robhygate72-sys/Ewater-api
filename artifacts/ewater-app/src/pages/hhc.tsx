import { Component, useCallback, type ReactNode, type ErrorInfo } from "react";
import { useLocation, useSearch } from "wouter";
import { Layout } from "@/components/layout";
import { cn } from "@/lib/utils";
import { FleetTab } from "@/components/hhc/fleet-tab";
import { OperationsTab } from "@/components/hhc/operations-tab";
import { CommissioningTab } from "@/components/hhc/commissioning-tab";
import { OperatorHeader } from "@/components/hhc/operator-header";

type HhcTab = "overview" | "commissioning" | "operations";

const TABS: { id: HhcTab; label: string }[] = [
  { id: "overview", label: "Fleet Overview" },
  { id: "commissioning", label: "Commissioning" },
  { id: "operations", label: "Operations & Maintenance" },
];

// ---------------------------------------------------------------------------
// Per-tab error boundary — catches render errors so a crash in one tab
// doesn't kill the React root or show the Vite overlay.
// ---------------------------------------------------------------------------

interface HhcTabBoundaryState {
  error: Error | null;
}

class HhcTabErrorBoundary extends Component<
  { label: string; children: ReactNode },
  HhcTabBoundaryState
> {
  state: HhcTabBoundaryState = { error: null };

  static getDerivedStateFromError(err: unknown): HhcTabBoundaryState {
    return { error: err instanceof Error ? err : new Error(String(err)) };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    const payload = {
      message: err.message,
      stack: err.stack ?? "",
      componentStack: info.componentStack ?? "",
      url: window.location.href,
      tab: this.props.label,
    };
    // Relay to server for diagnostics (defined in main.tsx after hard-refresh)
    if (typeof window.__reportCrash === "function") {
      window.__reportCrash(payload);
    } else {
      // Fallback: fire-and-forget fetch in case main.tsx wasn't reloaded yet
      fetch("/api/ewater/hhc/debug-error", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => undefined);
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 space-y-3">
          <p className="text-sm font-semibold text-destructive">
            {this.props.label} tab encountered an error
          </p>
          <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap break-all max-h-40 overflow-auto bg-muted/30 rounded p-2">
            {this.state.error.message}
          </pre>
          <p className="text-[10px] text-muted-foreground">
            This error has been sent to the server for diagnostics.
          </p>
          <button
            onClick={this.reset}
            className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Extend the Window type for the crash reporter injected by main.tsx
declare global {
  interface Window {
    __reportCrash?: (payload: Record<string, string>) => void;
  }
}

// ---------------------------------------------------------------------------

export default function HhcPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);

  const rawTab = params.get("tab");
  const tab: HhcTab =
    rawTab === "commissioning" || rawTab === "operations" ? rawTab : "overview";
  const assetId = params.get("assetId");

  const navigate = useCallback(
    (nextTab: HhcTab, nextAssetId?: string | null) => {
      const p = new URLSearchParams();
      p.set("tab", nextTab);
      const id = nextAssetId === undefined ? assetId : nextAssetId;
      if (id) p.set("assetId", id);
      setLocation(`/hhc?${p.toString()}`);
    },
    [assetId, setLocation],
  );

  const selectMeter = useCallback(
    (id: string) => navigate("operations", id),
    [navigate],
  );

  return (
    <Layout title="HHC Dashboard" wide headerActions={<OperatorHeader />}>
      <div className="space-y-4">
        {/* Tabs */}
        <div className="flex gap-1 border-b border-border -mx-1 px-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              data-testid={`tab-hhc-${t.id}`}
              onClick={() => navigate(t.id, null)}
              className={cn(
                "px-3 py-2 text-xs font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors",
                tab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <HhcTabErrorBoundary label="Fleet Overview">
            <FleetTab onSelectMeter={selectMeter} />
          </HhcTabErrorBoundary>
        )}
        {tab === "commissioning" && (
          <HhcTabErrorBoundary label="Commissioning">
            <CommissioningTab onSelectMeter={selectMeter} />
          </HhcTabErrorBoundary>
        )}
        {tab === "operations" && (
          <HhcTabErrorBoundary label="Operations & Maintenance">
            <OperationsTab assetId={assetId} onSelectMeter={selectMeter} />
          </HhcTabErrorBoundary>
        )}
      </div>
    </Layout>
  );
}
