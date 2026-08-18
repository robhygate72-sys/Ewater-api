import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  listHouseholdMeters,
  useGetHhcConfig,
  useUpdateHhcConfig,
  useHhcOperatorLogin,
  getGetHhcConfigQueryKey,
  type HouseholdMeterSummary,
  type HhcConfigurationUpdate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Settings2, UserCircle2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTimeAgo } from "@/lib/date";
import { useMeterStates } from "./use-meter-states";
import { obsStr, connectivityColor, StatusBadge } from "./shared";
import { CommissioningPanel } from "./commissioning-detail";
import { getSession, useOperatorSession, saveSession, clearSession, getOperator, isAdminRole, operatorHeaders, type OperatorSessionInfo } from "./operator";

const QUEUE_LIFECYCLES = ["PreInstallation", "Staged", "Active"] as const;
const STAGE_LABEL: Record<string, string> = {
  PreInstallation: "Pre-install",
  Staged: "Staged",
  Active: "Active",
};
const API_PAGE_SIZE = 100;
const UI_PAGE_SIZE = 25;
const MAX_API_PAGES = 100; // runaway-loop guard: 10,000 meters per lifecycle

/**
 * Fetch EVERY page of a lifecycle so the queue never silently omits meters.
 * Throws (surfacing the error state) rather than returning a silently
 * truncated set if the guard ceiling is ever hit.
 */
export async function fetchAllMeters(status: string): Promise<HouseholdMeterSummary[]> {
  const all: HouseholdMeterSummary[] = [];
  for (let page = 0; page < MAX_API_PAGES; page++) {
    const res = await listHouseholdMeters({ status, limit: API_PAGE_SIZE, offset: page * API_PAGE_SIZE });
    all.push(...res.items);
    if (!res.hasMore) return all;
  }
  throw new Error(`Commissioning queue for ${status} exceeds ${MAX_API_PAGES * API_PAGE_SIZE} meters; refusing to show a truncated queue`);
}

// ── Operator sign-in bar ─────────────────────────────────────────────────────
// The access key is verified server-side; the returned token carries the
// operator's verified identity and role.

export function OperatorBar() {
  const session = useOperatorSession();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const login = useHhcOperatorLogin({
    mutation: {
      onSuccess: (data) => {
        saveSession(data as OperatorSessionInfo);
        setKey("");
        setError(null);
      },
      onError: (err) => setError(err instanceof Error ? err.message : "Sign-in failed"),
    },
  });
  return (
    <div className="flex items-center gap-2 flex-wrap rounded-xl border border-border bg-card px-3 py-2">
      <UserCircle2 className="w-4 h-4 text-muted-foreground shrink-0" />
      {session ? (
        <>
          <span className="text-[11px]" data-testid="text-operator-signed-in">
            Signed in as <span className="font-semibold">{session.operator}</span>
          </span>
          <StatusBadge
            label={session.role}
            className={session.role === "admin"
              ? "text-violet-600 dark:text-violet-400 bg-violet-500/10 border-violet-500/25"
              : "text-sky-600 dark:text-sky-400 bg-sky-500/10 border-sky-500/25"}
            testId="badge-operator-role"
          />
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[11px] ml-auto"
            data-testid="button-operator-signout"
            onClick={() => clearSession()}
          >
            Sign out
          </Button>
        </>
      ) : (
        <>
          <span className="text-[11px] text-muted-foreground">Operator sign-in</span>
          <Input
            data-testid="input-operator-name"
            className="h-7 text-[11px] w-40"
            placeholder="Your name / ID"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(null); }}
          />
          <Input
            data-testid="input-operator-key"
            className="h-7 text-[11px] w-40"
            type="password"
            placeholder="Access key"
            value={key}
            onChange={(e) => { setKey(e.target.value); setError(null); }}
          />
          <Button
            size="sm"
            className="h-7 text-[11px]"
            disabled={login.isPending || !name.trim() || !key}
            data-testid="button-operator-login"
            onClick={() => login.mutate({ data: { operatorName: name.trim(), accessKey: key } })}
          >
            Sign in
          </Button>
          {error && <span className="text-[10px] text-destructive">{error}</span>}
          <span className="text-[10px] text-muted-foreground ml-auto">
            Commissioning actions require a verified operator token
          </span>
        </>
      )}
    </div>
  );
}

// ── HHC configuration settings panel ────────────────────────────────────────

const CONFIG_FIELDS: { key: keyof HhcConfigurationUpdate; label: string; unit: string; nullable?: boolean }[] = [
  { key: "batteryCriticalVoltage", label: "Battery critical", unit: "V" },
  { key: "batteryWarningVoltage", label: "Battery warning", unit: "V" },
  { key: "gate3SamplePct", label: "Gate 3 sample", unit: "%" },
  { key: "rtcToleranceSeconds", label: "RTC tolerance", unit: "s", nullable: true },
  { key: "requiredOverdraftLitres", label: "Required overdraft", unit: "L" },
  { key: "tariffKesPer1000L", label: "Tariff", unit: "KES/1000L" },
];

function ConfigPanel() {
  useOperatorSession(); // re-render on sign-in/sign-out so admin gating stays current
  const queryClient = useQueryClient();
  const queryKey = getGetHhcConfigQueryKey();
  const query = useGetHhcConfig({ query: { queryKey, staleTime: 60_000 } });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const mutation = useUpdateHhcConfig({
    mutation: {
      onSuccess: (data) => {
        setMessage("Configuration saved");
        setDraft({});
        queryClient.setQueryData(queryKey, data);
      },
      onError: (err) => setMessage(err instanceof Error ? err.message : "Save failed"),
    },
    request: { headers: operatorHeaders() },
  });

  if (query.isLoading) return <Skeleton className="h-16 w-full rounded-xl" />;
  if (query.isError || !query.data) return <p className="text-[11px] text-destructive">Failed to load HHC configuration</p>;
  const cfg = query.data as unknown as Record<string, number | null>;

  const save = () => {
    const update: HhcConfigurationUpdate = {};
    for (const f of CONFIG_FIELDS) {
      const raw = draft[f.key];
      if (raw === undefined) continue;
      if (raw === "" && f.nullable) (update as Record<string, unknown>)[f.key] = null;
      else if (raw !== "" && !isNaN(Number(raw))) (update as Record<string, unknown>)[f.key] = Number(raw);
    }
    setMessage(null);
    mutation.mutate({ data: update });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        {CONFIG_FIELDS.map((f) => (
          <label key={f.key} className="space-y-0.5">
            <span className="text-[10px] text-muted-foreground block">{f.label} ({f.unit}){f.nullable ? " — blank = not configured" : ""}</span>
            <Input
              data-testid={`input-config-${f.key}`}
              className="h-7 text-[11px]"
              type="number"
              value={draft[f.key] ?? (cfg[f.key] == null ? "" : String(cfg[f.key]))}
              onChange={(e) => { setDraft((d) => ({ ...d, [f.key]: e.target.value })); setMessage(null); }}
            />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          className="h-7 text-[11px]"
          disabled={mutation.isPending || Object.keys(draft).length === 0 || !isAdminRole()}
          data-testid="button-save-config"
          onClick={save}
        >
          Save configuration
        </Button>
        {!isAdminRole() && (
          <span className="text-[10px] text-amber-600 dark:text-amber-400">Requires sign-in with an admin access key</span>
        )}
        {message && <span className={cn("text-[10px]", mutation.isError ? "text-destructive" : "text-emerald-600 dark:text-emerald-400")}>{message}</span>}
        {query.data.updatedBy && (
          <span className="text-[10px] text-muted-foreground ml-auto">Last updated by {query.data.updatedBy}</span>
        )}
      </div>
    </div>
  );
}

// ── Queue table ─────────────────────────────────────────────────────────────

export function CommissioningTab({ onSelectMeter }: { onSelectMeter: (id: string) => void }) {
  const [stage, setStage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [waterSystem, setWaterSystem] = useState<string | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [showConfig, setShowConfig] = useState(false);

  // Fetch the FULL set of meters for each queue lifecycle (all API pages).
  const lifecycleQueries = useQueries({
    queries: QUEUE_LIFECYCLES.map((lc) => ({
      queryKey: ["hhc-commissioning-queue", lc],
      queryFn: () => fetchAllMeters(lc),
      staleTime: 90_000,
      refetchInterval: 90_000,
    })),
  });
  const isLoading = lifecycleQueries.some((q) => q.isLoading);
  // Any failed lifecycle means the queue would be silently incomplete — treat
  // it as an error rather than showing partial totals as if they were complete.
  const isError = lifecycleQueries.some((q) => q.isError);
  const failedStages = QUEUE_LIFECYCLES.filter((_, i) => lifecycleQueries[i]?.isError);
  const isFetching = lifecycleQueries.some((q) => q.isFetching);
  const refetchAll = () => lifecycleQueries.forEach((q) => void q.refetch());

  const allMeters: HouseholdMeterSummary[] = useMemo(
    () => lifecycleQueries.flatMap((q) => q.data ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lifecycleQueries[0]?.data, lifecycleQueries[1]?.data, lifecycleQueries[2]?.data],
  );

  // Dropdown options come from the full queue (all lifecycles), so a filter
  // never hides its own options.
  const waterSystemOptions = useMemo(
    () => [...new Set(allMeters.map((m) => m.waterSystemName).filter((v): v is string => !!v))].sort(),
    [allMeters],
  );
  const countryOptions = useMemo(
    () => [...new Set(allMeters.map((m) => m.countryName).filter((v): v is string => !!v))].sort(),
    [allMeters],
  );

  const meters: HouseholdMeterSummary[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = allMeters.filter((m) =>
      (!stage || m.status === stage) &&
      (!waterSystem || m.waterSystemName === waterSystem) &&
      (!country || m.countryName === country) &&
      (!q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)),
    );
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  }, [allMeters, stage, search, waterSystem, country]);

  const pageCount = Math.max(1, Math.ceil(meters.length / UI_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = meters.slice(safePage * UI_PAGE_SIZE, (safePage + 1) * UI_PAGE_SIZE);
  // Device state is loaded progressively for the visible page only.
  const states = useMeterStates(visible.map((m) => m.id));
  const stateById = new Map(states.map((s) => [s.assetId, s]));

  return (
    <div className="space-y-4">
      <OperatorBar />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1.5">
          <button
            data-testid="filter-stage-all"
            onClick={() => { setStage(null); setPage(0); }}
            className={cn(
              "text-xs px-3 py-1.5 rounded-lg border transition-colors",
              stage == null ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:bg-muted",
            )}
          >
            All stages
          </button>
          {QUEUE_LIFECYCLES.map((lc) => (
            <button
              key={lc}
              data-testid={`filter-stage-${lc.toLowerCase()}`}
              onClick={() => { setStage(lc); setPage(0); }}
              className={cn(
                "text-xs px-3 py-1.5 rounded-lg border transition-colors",
                stage === lc ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:bg-muted",
              )}
            >
              {STAGE_LABEL[lc]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            data-testid="button-toggle-config"
            onClick={() => setShowConfig((s) => !s)}
            className={cn("p-1.5 rounded-lg hover:bg-muted transition-colors", showConfig && "bg-muted")}
            title="HHC configuration"
          >
            <Settings2 className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
          <button
            data-testid="button-refresh-commissioning"
            onClick={refetchAll}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            title="Refresh queue"
          >
            <RefreshCw className={cn("w-3.5 h-3.5 text-muted-foreground", isFetching && "animate-spin")} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            data-testid="input-commissioning-search"
            className="h-8 pl-8 text-xs"
            placeholder="Search by name or asset ID"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          />
        </div>
        <Select
          value={waterSystem ?? "__all__"}
          onValueChange={(v) => { setWaterSystem(v === "__all__" ? null : v); setPage(0); }}
        >
          <SelectTrigger data-testid="filter-commissioning-water-system" className="h-8 w-[180px] text-xs">
            <SelectValue placeholder="Water system" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All water systems</SelectItem>
            {waterSystemOptions.map((o) => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={country ?? "__all__"}
          onValueChange={(v) => { setCountry(v === "__all__" ? null : v); setPage(0); }}
        >
          <SelectTrigger data-testid="filter-commissioning-country" className="h-8 w-[150px] text-xs">
            <SelectValue placeholder="Country" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All countries</SelectItem>
            {countryOptions.map((o) => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(search || waterSystem || country) && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            data-testid="button-clear-commissioning-filters"
            onClick={() => { setSearch(""); setWaterSystem(null); setCountry(null); setPage(0); }}
          >
            Clear
          </Button>
        )}
      </div>

      {showConfig && <ConfigPanel />}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
        </div>
      ) : isError ? (
        <div className="text-center p-10 bg-card border border-dashed rounded-xl space-y-3">
          <p className="text-sm text-destructive font-medium">
            Failed to load the commissioning queue from eWater
            {failedStages.length < QUEUE_LIFECYCLES.length
              ? ` (stage${failedStages.length !== 1 ? "s" : ""}: ${failedStages.map((lc) => STAGE_LABEL[lc]).join(", ")})`
              : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            The queue is not shown partially, because totals would be misleading.
          </p>
          <Button size="sm" variant="outline" data-testid="button-retry-commissioning" onClick={refetchAll}>Retry</Button>
        </div>
      ) : meters.length === 0 ? (
        <div className="text-center p-10 bg-card border border-dashed rounded-xl space-y-3">
          <p className="text-sm text-muted-foreground">
            {search || waterSystem || country || stage
              ? "No meters match the current filters"
              : "No HouseholdMeter assets returned by eWater"}
          </p>
          {(search || waterSystem || country || stage) && (
            <Button
              size="sm"
              variant="outline"
              data-testid="button-clear-filters-empty"
              onClick={() => { setSearch(""); setWaterSystem(null); setCountry(null); setStage(null); setPage(0); }}
            >
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] text-muted-foreground" data-testid="text-commissioning-total">
            {meters.length} meter{meters.length !== 1 ? "s" : ""} in the queue
            {stage ? ` (${STAGE_LABEL[stage]})` : ""}
          </p>
          {visible.map((m) => {
            const s = stateById.get(m.id);
            const st = s?.state;
            const expanded = expandedId === m.id;
            return (
              <div key={m.id} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    data-testid={`button-commissioning-open-${m.id}`}
                    onClick={() => onSelectMeter(m.id)}
                    className="flex-1 min-w-0 text-left"
                    title="Open in Operations & Maintenance"
                  >
                    <p className="text-sm font-semibold truncate">{m.name}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">
                      #{m.id}
                      {st ? ` · SN ${obsStr(st.state.device, "serialNumber") ?? obsStr(st.state.meter, "waterMeterNo") ?? "Not reported"}` : ""}
                      {st ? ` · IMEI ${obsStr(st.state.network, "imei") ?? "Not reported"}` : ""}
                      {st ? ` · ICCID ${obsStr(st.state.network, "iccid") ?? "Not reported"}` : ""}
                    </p>
                  </button>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <StatusBadge label={STAGE_LABEL[m.status ?? ""] ?? m.status ?? "Unknown"} className="text-muted-foreground bg-muted/40 border-border" />
                    {s?.isLoading ? (
                      <Skeleton className="h-4 w-14" />
                    ) : st ? (
                      <StatusBadge label={st.connectivity.status} className={connectivityColor(st.connectivity.status)} />
                    ) : null}
                    <span className="text-[10px] text-muted-foreground w-16 text-right">
                      {s?.isLoading
                        ? ""
                        : st?.state.lastPacketAt
                          ? formatTimeAgo(st.state.lastPacketAt)
                          : "no packets"}
                    </span>
                    <button
                      data-testid={`button-commissioning-expand-${m.id}`}
                      onClick={() => setExpandedId(expanded ? null : m.id)}
                      className="p-1 rounded-md hover:bg-muted transition-colors"
                      title="Show commissioning checks"
                    >
                      {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </button>
                  </div>
                </div>
                {expanded && <CommissioningPanel assetId={m.id} />}
              </div>
            );
          })}
          {meters.length > UI_PAGE_SIZE && (
            <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
              <span data-testid="text-commissioning-page-info">
                Page {safePage + 1} of {pageCount} · {meters.length} meters
              </span>
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" data-testid="button-commissioning-prev" disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                  <ChevronLeft className="w-4 h-4" /> Prev
                </Button>
                <Button size="sm" variant="outline" data-testid="button-commissioning-next" disabled={safePage + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}>
                  Next <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
