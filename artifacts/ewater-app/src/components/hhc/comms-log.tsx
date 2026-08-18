import { useEffect, useState } from "react";
import {
  useGetHouseholdMeterCommunications,
  getGetHouseholdMeterCommunicationsQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime, formatTimeAgo } from "@/lib/date";
import { SectionCard, StatusBadge } from "./shared";

const PAGE_SIZE = 25;
const HOURS_OPTIONS = [
  { value: 24, label: "24 h" },
  { value: 72, label: "3 d" },
  { value: 7 * 24, label: "7 d" },
  { value: 30 * 24, label: "30 d" },
];

export function CommsLog({ assetId }: { assetId: string }) {
  const [validOnly, setValidOnly] = useState(false);
  const [messageFunction, setMessageFunction] = useState("");
  const [imeiFilter, setImeiFilter] = useState("");
  const [debouncedImei, setDebouncedImei] = useState("");
  const [hours, setHours] = useState(72);
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Debounce the IMEI filter, then apply it server-side so pagination and
  // totals reflect the filtered set.
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedImei(imeiFilter.trim()); setOffset(0); }, 350);
    return () => clearTimeout(t);
  }, [imeiFilter]);

  const params = {
    hours,
    ...(validOnly ? { validOnly: true } : {}),
    ...(messageFunction.trim() ? { messageFunction: messageFunction.trim() } : {}),
    ...(debouncedImei ? { imei: debouncedImei } : {}),
    limit: PAGE_SIZE,
    offset,
  };

  const query = useGetHouseholdMeterCommunications(assetId, params, {
    query: {
      queryKey: getGetHouseholdMeterCommunicationsQueryKey(assetId, params),
      staleTime: 30_000,
    },
  });

  const items = query.data?.items ?? [];

  const totalCount = query.data?.totalCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const page = Math.floor(offset / PAGE_SIZE);

  return (
    <SectionCard
      title="Communications log"
      actions={
        <button
          data-testid="button-refresh-comms"
          onClick={() => void query.refetch()}
          className="p-1 rounded-md hover:bg-muted transition-colors"
          title="Refresh log"
        >
          <RefreshCw className={cn("w-3 h-3 text-muted-foreground", query.isFetching && "animate-spin")} />
        </button>
      }
    >
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <button
          data-testid="filter-comms-valid"
          onClick={() => { setValidOnly((v) => !v); setOffset(0); }}
          className={cn(
            "text-[10px] px-2 py-1 rounded-md border transition-colors",
            validOnly ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:bg-muted",
          )}
        >
          Valid CRC only
        </button>
        {HOURS_OPTIONS.map((o) => (
          <button
            key={o.value}
            data-testid={`filter-comms-hours-${o.value}`}
            onClick={() => { setHours(o.value); setOffset(0); }}
            className={cn(
              "text-[10px] px-2 py-1 rounded-md border transition-colors",
              hours === o.value ? "bg-secondary text-secondary-foreground border-secondary" : "bg-card text-muted-foreground border-border hover:bg-muted",
            )}
          >
            {o.label}
          </button>
        ))}
        <Input
          data-testid="input-comms-message-function"
          placeholder="Message type…"
          value={messageFunction}
          onChange={(e) => { setMessageFunction(e.target.value); setOffset(0); }}
          className="h-7 w-32 text-[11px]"
        />
        <Input
          data-testid="input-comms-imei"
          placeholder="IMEI…"
          value={imeiFilter}
          onChange={(e) => setImeiFilter(e.target.value)}
          className="h-7 w-32 text-[11px]"
        />
      </div>

      {query.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full rounded-lg" />)}
        </div>
      ) : query.isError ? (
        <p className="text-xs text-destructive py-4 text-center">Failed to load communications log</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center italic">
          No packets in the selected window{debouncedImei ? " matching the IMEI filter" : ""}
        </p>
      ) : (
        <div className="divide-y divide-border/40 -mx-1">
          {items.map((p) => {
            const expanded = expandedId === p.id;
            return (
              <div key={p.id} className="px-1">
                <button
                  data-testid={`row-comm-${p.id}`}
                  onClick={() => setExpandedId(expanded ? null : p.id)}
                  className="w-full text-left py-2 hover:bg-muted/30 transition-colors rounded"
                >
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono text-[10px] text-muted-foreground">{formatDateTime(p.timestamp)}</span>
                    {p.valid != null && (
                      <StatusBadge
                        label={p.valid ? "CRC ok" : "CRC invalid"}
                        className={p.valid
                          ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25"
                          : "text-destructive bg-destructive/10 border-destructive/25"}
                      />
                    )}
                    {p.messageFunction && <span className="text-[10px] font-medium">{p.messageFunction}</span>}
                    {p.protocol && <span className="text-[10px] text-muted-foreground font-mono">{p.protocol}</span>}
                    {p.imei && <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[110px]">{p.imei}</span>}
                    {p.meterReadingLitres != null && (
                      <span className="text-[10px] text-muted-foreground ml-auto">{p.meterReadingLitres.toLocaleString()} L</span>
                    )}
                    {expanded ? <ChevronUp className="w-3 h-3 text-muted-foreground shrink-0" /> : <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />}
                  </div>
                </button>
                {expanded && (
                  <div className="pb-2.5 pl-1 space-y-1.5">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px]">
                      <span className="text-muted-foreground">Server receive time</span>
                      <span className="font-mono">{formatDateTime(p.timestamp)}</span>
                      <span className="text-muted-foreground">Source IMEI</span>
                      <span className="font-mono">{p.imei ?? "Not reported"}</span>
                      <span className="text-muted-foreground">Pipeline</span>
                      <span className="font-mono">{p.pipeline ?? "Not reported"}</span>
                      <span className="text-muted-foreground">Message type</span>
                      <span>{p.messageType ?? "Not reported"}</span>
                    </div>
                    {p.description ? (
                      <pre className="text-[10px] font-mono bg-muted/40 rounded-lg p-2 whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                        {p.description}
                      </pre>
                    ) : (
                      <p className="text-[10px] text-muted-foreground italic">No decoded description — payload is not a Shengda LwM2M frame</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalCount > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-3 text-[10px] text-muted-foreground">
          <span>Page {page + 1} of {pageCount} · {totalCount} packets</span>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" data-testid="button-comms-prev" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}>Prev</Button>
            <Button size="sm" variant="outline" data-testid="button-comms-next" disabled={page + 1 >= pageCount} onClick={() => setOffset((o) => o + PAGE_SIZE)}>Next</Button>
          </div>
        </div>
      )}
      {query.data?.fetchedAt && (
        <p className="text-[9px] text-muted-foreground mt-2 text-right">Fetched {formatTimeAgo(query.data.fetchedAt)}</p>
      )}
    </SectionCard>
  );
}
