import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  listHouseholdMeters,
  useGetHouseholdMeterCommissioning,
  getGetHouseholdMeterCommissioningQueryKey,
  type HouseholdMeterSummary,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle2, XCircle, HelpCircle, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTimeAgo, formatDateTime } from "@/lib/date";
import { useMeterStates } from "./use-meter-states";
import { obsStr, connectivityColor, StatusBadge } from "./shared";

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
async function fetchAllMeters(status: string): Promise<HouseholdMeterSummary[]> {
  const all: HouseholdMeterSummary[] = [];
  for (let page = 0; page < MAX_API_PAGES; page++) {
    const res = await listHouseholdMeters({ status, limit: API_PAGE_SIZE, offset: page * API_PAGE_SIZE });
    all.push(...res.items);
    if (!res.hasMore) return all;
  }
  throw new Error(`Commissioning queue for ${status} exceeds ${MAX_API_PAGES * API_PAGE_SIZE} meters; refusing to show a truncated queue`);
}

function overallBadge(overall: string) {
  switch (overall) {
    case "ready": return "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25";
    case "attention": return "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/25";
    default: return "text-muted-foreground bg-muted/40 border-border";
  }
}

function CheckIcon({ status }: { status: string }) {
  if (status === "pass") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
  if (status === "fail") return <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />;
  return <HelpCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
}

// ── Expandable checks row (read-only checklist — Phase 3 adds persistence) ──

function ChecksPanel({ assetId }: { assetId: string }) {
  const query = useGetHouseholdMeterCommissioning(assetId, {
    query: { queryKey: getGetHouseholdMeterCommissioningQueryKey(assetId), staleTime: 30_000, refetchInterval: 90_000 },
  });

  if (query.isLoading) {
    return (
      <div className="space-y-1.5 p-3">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
      </div>
    );
  }
  if (query.isError || !query.data) {
    return <p className="text-[11px] text-destructive p-3">Failed to load commissioning status</p>;
  }
  const d = query.data;
  return (
    <div className="p-3 space-y-2 bg-muted/20">
      <div className="flex items-center gap-2 flex-wrap">
        <StatusBadge label={d.overall} className={overallBadge(d.overall)} testId={`status-commissioning-${assetId}`} />
        <span className="text-[10px] text-muted-foreground">
          Evaluated {formatTimeAgo(d.evaluatedAt)}
          {d.sourceObservedAt ? ` · newest device observation ${formatTimeAgo(d.sourceObservedAt)}` : ""}
        </span>
      </div>
      <ul className="space-y-1.5">
        {d.checks.map((c) => (
          <li key={c.id} className="flex items-start gap-2 text-[11px]" data-testid={`check-${assetId}-${c.id}`}>
            <CheckIcon status={c.status} />
            <div className="min-w-0">
              <span className="font-medium">{c.label}</span>
              <span className="text-muted-foreground"> — {c.detail}</span>
              {c.observedAt && (
                <span className="text-[9px] text-muted-foreground block" title={formatDateTime(c.observedAt)}>
                  Observed {formatTimeAgo(c.observedAt)}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-muted-foreground italic">
        Automated checks derived from live data. The persisted commissioning checklist arrives in a later phase.
      </p>
    </div>
  );
}

// ── Queue table ─────────────────────────────────────────────────────────────

export function CommissioningTab({ onSelectMeter }: { onSelectMeter: (id: string) => void }) {
  const [stage, setStage] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);

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

  const meters: HouseholdMeterSummary[] = useMemo(() => {
    const all = lifecycleQueries.flatMap((q) => q.data ?? []);
    const filtered = stage ? all.filter((m) => m.status === stage) : all;
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifecycleQueries[0]?.data, lifecycleQueries[1]?.data, lifecycleQueries[2]?.data, stage]);

  const pageCount = Math.max(1, Math.ceil(meters.length / UI_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = meters.slice(safePage * UI_PAGE_SIZE, (safePage + 1) * UI_PAGE_SIZE);
  // Device state is loaded progressively for the visible page only.
  const states = useMeterStates(visible.map((m) => m.id));
  const stateById = new Map(states.map((s) => [s.assetId, s]));

  return (
    <div className="space-y-4">
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
        <button
          data-testid="button-refresh-commissioning"
          onClick={refetchAll}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          title="Refresh queue"
        >
          <RefreshCw className={cn("w-3.5 h-3.5 text-muted-foreground", isFetching && "animate-spin")} />
        </button>
      </div>

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
        <div className="text-center p-10 bg-card border border-dashed rounded-xl">
          <p className="text-sm text-muted-foreground">No HouseholdMeter assets returned by eWater for the selected stage</p>
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
                {expanded && <ChecksPanel assetId={m.id} />}
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
