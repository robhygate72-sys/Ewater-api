import { useMemo, useState, Component, type ReactNode, type ErrorInfo } from "react";

// ── Error boundary — catches render crashes and exposes the message ───────────
class FleetErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surfaces in browser console AND relays to server logs so we can diagnose.
    console.error("[FleetTab] Render error:", error.message, error.stack, info.componentStack);
    try {
      const reporter = (window as unknown as Record<string, unknown>).__reportCrash as
        | ((p: { source: string; message: string; stack?: string; componentStack?: string }) => void)
        | undefined;
      reporter?.({
        source: "FleetErrorBoundary.componentDidCatch",
        message: error.message,
        stack: error.stack,
        componentStack: info.componentStack ?? undefined,
      });
    } catch {
      // never throw from the error reporter
    }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl border border-destructive bg-destructive/5 p-6 space-y-3">
          <p className="text-sm font-semibold text-destructive">Dashboard render error</p>
          <pre className="text-[10px] text-destructive/80 whitespace-pre-wrap break-all">{this.state.error.message}</pre>
          <button
            className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted"
            onClick={() => this.setState({ error: null })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
import {
  useListHouseholdMeters,
  getListHouseholdMetersQueryKey,
  useGetHhcFleetAlarms,
  getGetHhcFleetAlarmsQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTimeAgo } from "@/lib/date";
import { useMeterStates } from "./use-meter-states";
import { obsStr, obsNum } from "./shared";

const FLEET_POLL_MS = 90_000;
const PAGE_SIZE = 25;

const LIFECYCLES = ["PreInstallation", "Staged", "Active", "Test"] as const;
const LIFECYCLE_LABELS: Record<string, string> = {
  PreInstallation: "Pre-install",
  Staged: "Staged",
  Active: "Active",
  Test: "Test",
};

// ── KPI card ────────────────────────────────────────────────────────────────

function Kpi({ label, value, loading, sub, className, testId }: {
  label: string;
  value: string | number | null;
  loading?: boolean;
  sub?: string;
  className?: string;
  testId?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5 min-w-0">
      <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground truncate">{label}</p>
      {loading ? (
        <Skeleton className="h-6 w-12 mt-1" />
      ) : (
        <p data-testid={testId} className={cn("text-xl font-bold tabular-nums leading-tight mt-0.5", className)}>
          {value ?? "—"}
        </p>
      )}
      {sub && <p className="text-[9px] text-muted-foreground leading-tight mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Main fleet tab ──────────────────────────────────────────────────────────

export function FleetTab(_props: { onSelectMeter?: (assetId: string) => void }) {
  return (
    <FleetErrorBoundary>
      <FleetTabInner />
    </FleetErrorBoundary>
  );
}

function FleetTabInner() {
  // First page of meters — used only to sample device state for the KPI cards.
  const [listParams] = useState({ limit: PAGE_SIZE, offset: 0 });

  const listQuery = useListHouseholdMeters(listParams, {
    query: {
      queryKey: getListHouseholdMetersQueryKey(listParams),
      refetchInterval: FLEET_POLL_MS,
    },
  });

  // Unfiltered total (for KPI) — cheap: limit 1, reuse cache.
  const totalParams = { limit: 1, offset: 0 };
  const totalQuery = useListHouseholdMeters(totalParams, {
    query: { queryKey: getListHouseholdMetersQueryKey(totalParams), refetchInterval: FLEET_POLL_MS, staleTime: 60_000 },
  });
  // Per-lifecycle totals for the KPI breakdown.
  const lcParams = LIFECYCLES.map((lc) => ({ status: lc, limit: 1, offset: 0 }));
  const lcQueries = [
    useListHouseholdMeters(lcParams[0]!, { query: { queryKey: getListHouseholdMetersQueryKey(lcParams[0]!), staleTime: 60_000 } }),
    useListHouseholdMeters(lcParams[1]!, { query: { queryKey: getListHouseholdMetersQueryKey(lcParams[1]!), staleTime: 60_000 } }),
    useListHouseholdMeters(lcParams[2]!, { query: { queryKey: getListHouseholdMetersQueryKey(lcParams[2]!), staleTime: 60_000 } }),
    useListHouseholdMeters(lcParams[3]!, { query: { queryKey: getListHouseholdMetersQueryKey(lcParams[3]!), staleTime: 60_000 } }),
  ];

  // Fleet-wide alarms (Pulse faults + server-computed Shengda alerts).
  const fleetAlarmsQuery = useGetHhcFleetAlarms({
    query: { queryKey: getGetHhcFleetAlarmsQueryKey(), refetchInterval: FLEET_POLL_MS, staleTime: 60_000 },
  });
  const fa = fleetAlarmsQuery.data;

  const meters = listQuery.data?.items ?? [];

  const pageIds = useMemo(() => meters.map((m) => m.id), [meters]);
  const states = useMeterStates(pageIds);

  const loadedStates = states.filter((s) => s.state != null);
  const totalMeters = totalQuery.data?.totalCount ?? null;

  // KPIs derived only from actually-loaded device state, with coverage shown.
  // All accesses use optional chaining — API shape may differ from TS types at runtime.
  const commHealthy = loadedStates.filter((s) => s.state?.connectivity?.status === "healthy").length;
  const commLate = loadedStates.filter((s) => s.state?.connectivity?.status === "late").length;
  const commOffline = loadedStates.filter((s) => s.state?.connectivity?.status === "offline").length;
  const alarmCount = loadedStates.filter((s) =>
    Array.isArray(s.state?.health?.reasons) && s.state!.health.reasons.some((r) => r?.severity !== "ok"),
  ).length;
  const lowBattery = loadedStates.filter((s) => {
    const st = s.state;
    if (!st?.state) return false;
    const bs = obsStr(st.state.device, "batteryStatus");
    const v = obsNum(st.state.meter, "batteryVoltage") ?? obsNum(st.state.device, "powerSupplyVoltage");
    return (bs != null && /low|critical/i.test(bs)) || (v != null && v > 0 && v < 3.2);
  }).length;

  const coverage = `Device state loaded for ${loadedStates.length} of ${totalMeters ?? "?"} HouseholdMeters`;

  // API connection status
  const apiOk = !listQuery.isError;

  return (
    <div className="space-y-4">
      {/* Connection indicator */}
      <div className="flex items-center justify-between gap-2">
        <div
          data-testid="status-api-connection"
          className={cn(
            "flex items-center gap-1.5 text-[11px] font-medium",
            apiOk ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
          )}
        >
          {apiOk ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          {apiOk ? "eWater API connected" : "eWater API unreachable"}
          {listQuery.data?.fetchedAt && (
            <span className="text-muted-foreground font-normal">· fetched {formatTimeAgo(listQuery.data.fetchedAt)}</span>
          )}
        </div>
        <button
          data-testid="button-refresh-fleet"
          onClick={() => void listQuery.refetch()}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          title="Refresh fleet"
        >
          <RefreshCw className={cn("w-3.5 h-3.5 text-muted-foreground", listQuery.isFetching && "animate-spin")} />
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        <Kpi label="Total meters" value={totalMeters} loading={totalQuery.isLoading} testId="kpi-total-meters" />
        {LIFECYCLES.map((lc, i) => (
          <Kpi
            key={lc}
            label={LIFECYCLE_LABELS[lc]!}
            value={lcQueries[i]?.data?.totalCount ?? null}
            loading={lcQueries[i]?.isLoading}
            testId={`kpi-lifecycle-${lc.toLowerCase()}`}
          />
        ))}
        <Kpi label="Comm healthy" value={commHealthy} sub={coverage} className="text-emerald-600 dark:text-emerald-400" testId="kpi-comm-healthy" />
        <Kpi label="Comm late / offline" value={`${commLate} / ${commOffline}`} sub={coverage} className="text-amber-600 dark:text-amber-400" testId="kpi-comm-late-offline" />
        <Kpi label="With alarms" value={alarmCount} sub={coverage} className={alarmCount > 0 ? "text-destructive" : undefined} testId="kpi-alarms" />
        <Kpi
          label="Active alarms (fleet)"
          value={fa ? fa.pulseCount + fa.shengdaCount : null}
          loading={fleetAlarmsQuery.isLoading}
          sub={fa
            ? `${fa.pulseCount} Pulse fault${fa.pulseCount !== 1 ? "s" : ""} · ${fa.shengdaCount} Shengda alert${fa.shengdaCount !== 1 ? "s" : ""}${fa.pulseError ? " · Pulse unavailable" : ""}`
            : fleetAlarmsQuery.isError ? "Alarm feed unavailable" : undefined}
          className={fa && fa.pulseCount + fa.shengdaCount > 0 ? "text-destructive" : undefined}
          testId="kpi-fleet-alarms"
        />
        <Kpi label="Low battery" value={lowBattery} sub={coverage} className={lowBattery > 0 ? "text-amber-600 dark:text-amber-400" : undefined} testId="kpi-low-battery" />
      </div>
      <p className="text-[10px] text-muted-foreground" data-testid="text-coverage">
        {coverage}. Communication, alarm and battery counts cover only meters whose device state has loaded.
      </p>
    </div>
  );
}
