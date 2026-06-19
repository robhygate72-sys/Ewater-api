import { useState, useEffect, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/date";
import { cn } from "@/lib/utils";
import { Info, Loader2 } from "lucide-react";
import { Ewc25PacketView, EwcReplyView, CommandApiPacketView } from "@/components/ewc25-packet-view";

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

// ─── category system ───────────────────────────────────────────────────────────

type LogCategory = "commands" | "health-state" | "ewc-other" | "gadwall" | "other";

const CATEGORIES: { id: LogCategory; label: string }[] = [
  { id: "commands",      label: "Commands" },
  { id: "health-state",  label: "Health State" },
  { id: "ewc-other",     label: "EWC Other" },
  { id: "gadwall",       label: "Gadwall" },
  { id: "other",         label: "Other" },
];

function msgByte(b64: string, idx: number): number | null {
  try {
    const s = atob(b64);
    return s.length > idx ? s.charCodeAt(idx) : null;
  } catch {
    return null;
  }
}

function categorizeEntry(entry: LogEntry): LogCategory {
  const protocol = entry.protocol ?? "";
  const msg = entry.message ?? "";
  const isEwc = protocol.toLowerCase().startsWith("ewc");

  if (protocol === "CommandApi_1") return "commands";

  if (isEwc) {
    const b0 = msg ? msgByte(msg, 0) : null;
    if (b0 === 0x80 || b0 === 0x88) return "commands";
    if (b0 === 0x44) {
      const eventByte = msgByte(msg, 5);
      return eventByte === 0x19 ? "health-state" : "ewc-other";
    }
    return "other";
  }

  if (protocol === "4CCv1") return "gadwall";

  return "other";
}

// ─── fetch (no server-side protocol filter — all filtering is client-side) ────

async function fetchLogPage(assetId: string, before: string): Promise<LogPage> {
  const params = new URLSearchParams({ before, limit: "50" });
  const res = await fetch(`/api/ewater/assets/${encodeURIComponent(assetId)}/logs?${params}`);
  if (!res.ok) throw new Error("Failed to fetch logs");
  return res.json();
}

// ─── helpers ──────────────────────────────────────────────────────────────────

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

function firstByte(b64: string): number | null {
  return msgByte(b64, 0);
}

// ─── log row ──────────────────────────────────────────────────────────────────

function LogRow({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const raw = entry.message ?? "";
  const hexStr = raw ? base64ToHex(raw) : "—";

  const protocol = entry.protocol ?? "";
  const isEwcProtocol = protocol.toLowerCase().startsWith("ewc");
  const isCommandApi = protocol === "CommandApi_1";

  const fb = raw ? firstByte(raw) : null;
  const isDatalog = isEwcProtocol && fb === 0x44;
  const isReply   = isEwcProtocol && (fb === 0x80 || fb === 0x88);
  const isDecoded = isDatalog || isReply || isCommandApi;
  const long = !isDecoded && hexStr.length > 80;

  return (
    <div className="px-3 py-2.5 hover:bg-muted/30 transition-colors">
      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
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
        {protocol && !isEwcProtocol && !isCommandApi && (
          <span className="ml-auto text-[10px] font-mono px-1.5 py-0 rounded border shrink-0 text-muted-foreground bg-muted/40 border-border">
            {protocol}
          </span>
        )}
      </div>

      {isDatalog && raw ? (
        <Ewc25PacketView hexPayload={hexStr} />
      ) : isReply && raw ? (
        <EwcReplyView hexPayload={hexStr} />
      ) : isCommandApi && raw ? (
        <CommandApiPacketView base64Payload={raw} />
      ) : (
        <div
          className={cn(long && "cursor-pointer")}
          onClick={() => long && setExpanded((v) => !v)}
        >
          <p className={cn(
            "text-[11px] font-mono break-all leading-relaxed text-foreground/80",
            !expanded && long && "line-clamp-2",
          )}>
            {hexStr}
          </p>
          {long && (
            <span className="text-[10px] text-primary mt-0.5 block">
              {expanded ? "Show less" : "Show more"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export function AssetLogs({ assetId }: { assetId: string }) {
  const [category, setCategory] = useState<LogCategory | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
  } = useInfiniteQuery<LogPage, Error>({
    queryKey: ["asset-logs", assetId],
    queryFn: ({ pageParam }) =>
      fetchLogPage(assetId, (pageParam as string | undefined) ?? new Date().toISOString()),
    getNextPageParam: (last) => (last.hasMore && last.nextBefore ? last.nextBefore : undefined),
    initialPageParam: new Date().toISOString(),
    staleTime: 60_000,
  });

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

  // Count entries per category (from what's loaded so far)
  const counts = allEntries.reduce<Record<LogCategory, number>>(
    (acc, e) => { const cat = categorizeEntry(e); acc[cat]++; return acc; },
    { commands: 0, "health-state": 0, "ewc-other": 0, gadwall: 0, other: 0 },
  );

  const visibleEntries = category
    ? allEntries.filter((e) => categorizeEntry(e) === category)
    : allEntries;

  return (
    <div className="space-y-2">
      {/* Semantic category filter chips — always visible */}
      <div className="flex gap-1.5 flex-wrap">
        <button
          onClick={() => setCategory(null)}
          className={cn(
            "text-xs px-2.5 py-1 rounded-full border transition-colors",
            category === null
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background text-muted-foreground border-border hover:border-foreground/30",
          )}
        >
          All
        </button>
        {CATEGORIES.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setCategory(category === id ? null : id)}
            className={cn(
              "text-xs px-2.5 py-1 rounded-full border transition-colors",
              category === id
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:border-foreground/30",
              !isLoading && counts[id] === 0 && "opacity-40",
            )}
          >
            {label}
            {!isLoading && counts[id] > 0 && (
              <span className={cn(
                "ml-1 text-[10px] opacity-60",
                category === id && "opacity-80",
              )}>
                {counts[id]}
              </span>
            )}
          </button>
        ))}
      </div>

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
          ) : visibleEntries.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground flex flex-col items-center gap-2">
              <Info className="w-6 h-6 opacity-40" />
              <span className="text-sm">
                {category
                  ? `No "${CATEGORIES.find(c => c.id === category)?.label}" entries in the loaded window`
                  : "No log entries in the last 7 days"}
              </span>
              {category && (
                <button onClick={() => setCategory(null)} className="text-xs text-primary underline">
                  Clear filter
                </button>
              )}
            </div>
          ) : (
            visibleEntries.map((entry) => <LogRow key={entry.id} entry={entry} />)
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
