import { useMemo, useState, useEffect, Component, type ReactNode, type ErrorInfo } from "react";

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
    // Surfaces in browser console logs so we can diagnose.
    console.error("[FleetTab] Render error:", error.message, error.stack, info.componentStack);
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
  useGetHhcFilterOptions,
  type HouseholdMeterSummary,
} from "@workspace/api-client-react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  type ColumnDef,
} from "@tanstack/react-table";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RefreshCw, Search, ChevronLeft, ChevronRight, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTimeAgo, formatDateTime } from "@/lib/date";
import { useMeterStates, type MeterStateResult } from "./use-meter-states";
import { obs, obsStr, obsNum, fmtSeconds, connectivityColor, healthColor, StatusBadge } from "./shared";

const FLEET_POLL_MS = 90_000;
const PAGE_SIZE = 25;

const LIFECYCLES = ["PreInstallation", "Staged", "Active", "Test"] as const;
const LIFECYCLE_LABELS: Record<string, string> = {
  PreInstallation: "Pre-install",
  Staged: "Staged",
  Active: "Active",
  Test: "Test",
};

// ── Row model combining summary + progressively-loaded state ────────────────

interface FleetRow {
  meter: HouseholdMeterSummary;
  s: MeterStateResult;
}

function NotReported() {
  return <span className="text-muted-foreground/60 italic">Not reported</span>;
}

function cellVal(v: string | number | null | undefined, unit?: string) {
  if (v == null) return <NotReported />;
  const text = typeof v === "number" ? v.toLocaleString() : v;
  return <span>{unit ? `${text} ${unit}` : text}</span>;
}

const col = createColumnHelper<FleetRow>();
// Must be stable — calling getCoreRowModel() on every render triggers TanStack Table re-init.
const stableCoreRowModel = getCoreRowModel();

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

export function FleetTab({ onSelectMeter }: { onSelectMeter: (assetId: string) => void }) {
  return (
    <FleetErrorBoundary>
      <FleetTabInner onSelectMeter={onSelectMeter} />
    </FleetErrorBoundary>
  );
}

function FleetTabInner({ onSelectMeter }: { onSelectMeter: (assetId: string) => void }) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [lifecycle, setLifecycle] = useState<string | null>(null);
  const [waterSystem, setWaterSystem] = useState<string | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search.trim()); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch distinct filter options from the server (water systems + countries).
  const filterOptionsQuery = useGetHhcFilterOptions({ query: { staleTime: 300_000, queryKey: ["hhc-filter-options"] } });
  const filterOptions = filterOptionsQuery.data;

  const listParams = {
    ...(lifecycle ? { status: lifecycle } : {}),
    ...(waterSystem ? { waterSystem } : {}),
    ...(country ? { country } : {}),
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };

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
  const stateById = useMemo(() => new Map(states.map((s) => [s.assetId, s])), [states]);

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

  // ── Table columns ─────────────────────────────────────────────────────────
  const columns = useMemo<ColumnDef<FleetRow, unknown>[]>(
    () => [
      col.accessor((r) => r.meter.name, {
        id: "name",
        header: "Asset",
        cell: (info) => (
          <div className="min-w-[140px]">
            <p className="font-semibold text-xs truncate">{info.getValue()}</p>
            <p className="text-[10px] text-muted-foreground font-mono">#{info.row.original.meter.id}</p>
          </div>
        ),
      }),
      col.accessor((r) => r.meter.status ?? null, {
        id: "lifecycle",
        header: "Lifecycle",
        cell: (info) => cellVal(info.getValue() && (LIFECYCLE_LABELS[info.getValue()!] ?? info.getValue())),
      }),
      col.accessor((r) => r.meter.waterSystemName ?? null, { id: "waterSystem", header: "Water system", cell: (i) => cellVal(i.getValue()) }),
      col.accessor((r) => r.meter.countryName ?? null, { id: "country", header: "Country", cell: (i) => cellVal(i.getValue()) }),
      col.display({
        id: "shengda",
        header: "Shengda",
        cell: ({ row }) => {
          const s = row.original.s;
          if (s.isLoading) return <Skeleton className="h-3 w-10" />;
          if (!s.state) return <NotReported />;
          return s.state.state.validPacketCount > 0
            ? <StatusBadge label="Detected" className="text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25" />
            : <StatusBadge label="No packets" className="text-muted-foreground bg-muted/40 border-border" />;
        },
      }),
      col.display({
        id: "serial", header: "Serial",
        cell: ({ row }) => stateCell(row.original.s, (st) => cellVal(obsStr(st.state.device, "serialNumber") ?? obsStr(st.state.meter, "waterMeterNo"))),
      }),
      col.display({
        id: "imei", header: "IMEI",
        cell: ({ row }) => stateCell(row.original.s, (st) => <span className="font-mono text-[10px]">{obsStr(st.state.network, "imei") ?? <NotReported />}</span>),
      }),
      col.display({
        id: "iccid", header: "ICCID",
        cell: ({ row }) => stateCell(row.original.s, (st) => <span className="font-mono text-[10px]">{obsStr(st.state.network, "iccid") ?? <NotReported />}</span>),
      }),
      col.display({
        id: "lastComm", header: "Last valid comm",
        cell: ({ row }) => stateCell(row.original.s, (st) =>
          st.connectivity.lastValidPacketAt
            ? <span title={formatDateTime(st.connectivity.lastValidPacketAt)}>{formatTimeAgo(st.connectivity.lastValidPacketAt)}</span>
            : <NotReported />),
      }),
      col.display({
        id: "interval", header: "Expected interval",
        cell: ({ row }) => stateCell(row.original.s, (st) =>
          st.connectivity.reportCycleSeconds != null ? <span>{fmtSeconds(st.connectivity.reportCycleSeconds)}</span> : <NotReported />),
      }),
      col.display({
        id: "commHealth", header: "Comm health",
        cell: ({ row }) => stateCell(row.original.s, (st) => (
          <StatusBadge label={st.connectivity.status} className={connectivityColor(st.connectivity.status)} />
        )),
      }),
      col.display({
        id: "battery", header: "Battery",
        cell: ({ row }) => stateCell(row.original.s, (st) => {
          const v = obsNum(st.state.meter, "batteryVoltage") ?? obsNum(st.state.device, "powerSupplyVoltage");
          const bs = obsStr(st.state.device, "batteryStatus");
          if (v == null && bs == null) return <NotReported />;
          return <span>{v != null ? `${v.toFixed(2)} V` : ""}{v != null && bs ? " · " : ""}{bs ?? ""}</span>;
        }),
      }),
      col.display({
        id: "rsrp", header: "RSRP",
        cell: ({ row }) => stateCell(row.original.s, (st) => cellVal(obsNum(st.state.network, "rsrp"), "dBm")),
      }),
      col.display({
        id: "snr", header: "SNR",
        cell: ({ row }) => stateCell(row.original.s, (st) => cellVal(obsNum(st.state.network, "snr"), "dB")),
      }),
      col.display({
        id: "valve", header: "Valve",
        cell: ({ row }) => stateCell(row.original.s, (st) => cellVal(obsStr(st.state.valve, "status"))),
      }),
      col.display({
        id: "prepaid", header: "Prepaid balance",
        cell: ({ row }) => stateCell(row.original.s, (st) => cellVal(obsNum(st.state.meter, "availableWaterAllowanceLitres"), "L")),
      }),
      col.display({
        id: "reading", header: "Cumulative reading",
        cell: ({ row }) => stateCell(row.original.s, (st) => cellVal(obsNum(st.state.meter, "meterReadingLitres"), "L")),
      }),
      col.display({
        id: "flags", header: "Status",
        cell: ({ row }) => stateCell(row.original.s, (st) => {
          const badges: React.ReactNode[] = [];
          const err = obsNum(st.state.device, "errorCode") ?? obsNum(st.state.alarms, "waterErrorCode");
          if (err != null && err !== 0)
            badges.push(<StatusBadge key="err" label={`Err ${err}`} className="text-destructive bg-destructive/10 border-destructive/25" />);
          const mag = obs(st.state.alarms, "magneticAttack");
          if (mag?.value === true)
            badges.push(<StatusBadge key="tamper" label="Tamper" className="text-destructive bg-destructive/10 border-destructive/25" />);
          badges.push(<StatusBadge key="health" label={st.health.status} className={healthColor(st.health.status)} />);
          return <div className="flex gap-1 flex-wrap">{badges}</div>;
        }),
      }),
    ],
    [],
  );

  const rows: FleetRow[] = useMemo(
    () => meters.map((meter) => ({ meter, s: stateById.get(meter.id) ?? { assetId: meter.id, state: undefined, isLoading: true, isError: false } })),
    [meters, stateById],
  );

  const table = useReactTable({ data: rows, columns, getCoreRowModel: stableCoreRowModel });

  const totalCount = listQuery.data?.totalCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

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

      {/* Search + filters */}
      <div className="flex flex-col gap-2">
        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            data-testid="input-fleet-search"
            placeholder="Search by name or asset ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>

        {/* Filter row */}
        <div className="flex flex-wrap gap-2 items-center">
          {/* Lifecycle pills */}
          <div className="flex gap-1 flex-wrap">
            <button
              data-testid="filter-lifecycle-all"
              onClick={() => { setLifecycle(null); setPage(0); }}
              className={cn(
                "text-xs px-2.5 py-1 rounded-lg border transition-colors",
                lifecycle == null ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:bg-muted",
              )}
            >
              All
            </button>
            {LIFECYCLES.map((lc) => (
              <button
                key={lc}
                data-testid={`filter-lifecycle-${lc.toLowerCase()}`}
                onClick={() => { setLifecycle(lc); setPage(0); }}
                className={cn(
                  "text-xs px-2.5 py-1 rounded-lg border transition-colors",
                  lifecycle === lc ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:bg-muted",
                )}
              >
                {LIFECYCLE_LABELS[lc]}
              </button>
            ))}
          </div>

          {/* Water system dropdown */}
          <Select
            value={waterSystem ?? "__all__"}
            onValueChange={(v) => { setWaterSystem(v === "__all__" ? null : v); setPage(0); }}
          >
            <SelectTrigger className="h-8 text-xs w-[160px]" data-testid="filter-water-system">
              <SelectValue placeholder="Water system" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All water systems</SelectItem>
              {(filterOptions?.waterSystems ?? []).map((ws) => (
                <SelectItem key={ws} value={ws}>{ws}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Country dropdown */}
          <Select
            value={country ?? "__all__"}
            onValueChange={(v) => { setCountry(v === "__all__" ? null : v); setPage(0); }}
          >
            <SelectTrigger className="h-8 text-xs w-[130px]" data-testid="filter-country">
              <SelectValue placeholder="Country" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All countries</SelectItem>
              {(filterOptions?.countries ?? []).map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Clear filters */}
          {(lifecycle || waterSystem || country || debouncedSearch) && (
            <button
              onClick={() => { setLifecycle(null); setWaterSystem(null); setCountry(null); setSearch(""); setDebouncedSearch(""); setPage(0); }}
              className="text-xs px-2.5 py-1 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      {listQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
        </div>
      ) : listQuery.isError ? (
        <div className="text-center p-10 bg-card border border-dashed rounded-xl space-y-3">
          <p className="text-sm text-destructive font-medium">Failed to load HouseholdMeters from eWater</p>
          <Button size="sm" variant="outline" data-testid="button-retry-fleet" onClick={() => void listQuery.refetch()}>Retry</Button>
        </div>
      ) : meters.length === 0 ? (
        <div className="text-center p-10 bg-card border border-dashed rounded-xl space-y-3">
          <p className="text-sm text-muted-foreground">No HouseholdMeter assets returned by eWater</p>
          <Button size="sm" variant="outline" data-testid="button-refresh-empty" onClick={() => void listQuery.refetch()}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-x-auto bg-card">
          <table className="w-full text-xs">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="border-b border-border bg-muted/40">
                  {hg.headers.map((h) => (
                    <th key={h.id} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  data-testid={`row-meter-${row.original.meter.id}`}
                  onClick={() => onSelectMeter(row.original.meter.id)}
                  className="border-b border-border/40 last:border-0 hover:bg-muted/40 cursor-pointer transition-colors"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2 whitespace-nowrap align-top">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalCount > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span data-testid="text-fleet-page-info">
            Page {page + 1} of {pageCount} · {totalCount} meters
          </span>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" data-testid="button-fleet-prev" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              <ChevronLeft className="w-4 h-4" /> Prev
            </Button>
            <Button size="sm" variant="outline" data-testid="button-fleet-next" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Render helper: skeleton while a row's state is loading, honest fallback after.
function stateCell(
  s: MeterStateResult,
  render: (st: NonNullable<MeterStateResult["state"]>) => React.ReactNode,
): React.ReactNode {
  if (s.isLoading) return <Skeleton className="h-3 w-14" />;
  if (!s.state) return <NotReported />;
  return render(s.state);
}
