import { useState, useEffect, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/date";
import { cn } from "@/lib/utils";
import { Info, Loader2 } from "lucide-react";

interface LogEntry {
  id: string;
  timestamp: string;
  source: string | null;
  protocol: string | null;
  pipeline: string | null;
  message: string | null;
}

interface LogPage {
  entries: LogEntry[];
  nextBefore: string | null;
  hasMore: boolean;
}

async function fetchLogPage(
  assetId: string,
  before: string,
  protocol: string | null,
): Promise<LogPage> {
  const params = new URLSearchParams({ before, limit: "50" });
  if (protocol) params.set("protocol", protocol);
  const res = await fetch(`/api/ewater/assets/${encodeURIComponent(assetId)}/logs?${params}`);
  if (!res.ok) throw new Error("Failed to fetch logs");
  return res.json();
}

function base64ToHex(b64: string): string {
  try {
    const binary = atob(b64);
    return Array.from(binary)
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join(" ");
  } catch {
    return b64;
  }
}

function protocolClass(protocol: string | null): string {
  if (!protocol) return "text-muted-foreground bg-muted/40 border-border";
  const p = protocol.toLowerCase();
  if (p.startsWith("ewc")) return "text-primary bg-primary/10 border-primary/20";
  if (p.startsWith("4cc")) return "text-violet-600 dark:text-violet-400 bg-violet-500/10 border-violet-500/20";
  if (p.startsWith("command")) return "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20";
  return "text-muted-foreground bg-muted/40 border-border";
}

function LogRow({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const raw = entry.message ?? "";
  const message = raw ? base64ToHex(raw) : "—";
  const long = message.length > 80;

  return (
    <div
      className={cn("px-3 py-2.5 hover:bg-muted/30 transition-colors", long && "cursor-pointer")}
      onClick={() => long && setExpanded((v) => !v)}
    >
      {/* Time + source + protocol */}
      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
        <span className="font-mono text-[10px] text-muted-foreground shrink-0">
          {formatDateTime(entry.timestamp)}
        </span>
        {entry.source && (
          <>
            <span className="text-muted-foreground/30 text-[10px]">·</span>
            <span className="font-mono text-[10px] text-muted-foreground/70 truncate max-w-[120px]">
              {entry.source}
            </span>
          </>
        )}
        {entry.protocol && (
          <span className={cn(
            "ml-auto text-[10px] font-mono px-1.5 py-0 rounded border shrink-0",
            protocolClass(entry.protocol),
          )}>
            {entry.protocol}
          </span>
        )}
      </div>
      {/* Hex message */}
      <p className={cn(
        "text-[11px] font-mono break-all leading-relaxed text-foreground/80",
        !expanded && long && "line-clamp-2",
      )}>
        {message}
      </p>
      {long && (
        <span className="text-[10px] text-primary mt-0.5 block">
          {expanded ? "Show less" : "Show more"}
        </span>
      )}
    </div>
  );
}

export function AssetLogs({ assetId }: { assetId: string }) {
  const [protocol, setProtocol] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
  } = useInfiniteQuery<LogPage, Error>({
    queryKey: ["asset-logs", assetId, protocol],
    queryFn: ({ pageParam }) =>
      fetchLogPage(assetId, (pageParam as string | undefined) ?? new Date().toISOString(), protocol),
    getNextPageParam: (last) => (last.hasMore && last.nextBefore ? last.nextBefore : undefined),
    initialPageParam: new Date().toISOString(),
    staleTime: 60_000,
  });

  // Infinite scroll: fire when sentinel enters viewport
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const allEntries = data?.pages.flatMap((p) => p.entries) ?? [];

  // Collect unique protocols across all fetched pages for filter chips
  const seenProtocols = [...new Set(
    data?.pages.flatMap((p) => p.entries.map((e) => e.protocol).filter(Boolean)) ?? []
  )] as string[];

  return (
    <div className="space-y-2">
      {/* Protocol filter chips — shown once we have data */}
      {seenProtocols.length > 1 && (
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setProtocol(null)}
            className={cn(
              "text-xs px-2.5 py-1 rounded-full border transition-colors",
              protocol === null
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:border-foreground/30",
            )}
          >
            All
          </button>
          {seenProtocols.map((p) => (
            <button
              key={p}
              onClick={() => setProtocol(protocol === p ? null : p)}
              className={cn(
                "text-xs px-2.5 py-1 rounded-full border transition-colors font-mono",
                protocol === p
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-foreground/30",
              )}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Log list */}
      <Card className="shadow-sm border overflow-hidden">
        <div className="divide-y divide-border/40">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-3 py-2.5">
                <Skeleton className="h-4 w-1/3 mb-1.5" />
                <Skeleton className="h-8 w-full" />
              </div>
            ))
          ) : isError ? (
            <div className="p-8 text-center text-muted-foreground flex flex-col items-center gap-2">
              <Info className="w-6 h-6 opacity-40" />
              <span className="text-sm">Failed to load logs</span>
            </div>
          ) : allEntries.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground flex flex-col items-center gap-2">
              <Info className="w-6 h-6 opacity-40" />
              <span className="text-sm">No log entries in the last 7 days</span>
              {protocol && (
                <button onClick={() => setProtocol(null)} className="text-xs text-primary underline">
                  Clear filter
                </button>
              )}
            </div>
          ) : (
            allEntries.map((entry) => <LogRow key={entry.id} entry={entry} />)
          )}
        </div>
      </Card>

      {/* Scroll sentinel + status */}
      <div ref={sentinelRef} className="flex items-center justify-center py-2 min-h-[28px]">
        {isFetchingNextPage && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            Loading more…
          </div>
        )}
        {!hasNextPage && allEntries.length > 0 && !isFetchingNextPage && (
          <span className="text-[11px] text-muted-foreground/40">End of logs</span>
        )}
      </div>
    </div>
  );
}
