import { useState, useEffect, useRef, useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useGetAssetEwc, getGetAssetEwcQueryKey } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/date";
import { cn } from "@/lib/utils";
import { Info, Loader2, Radio } from "lucide-react";
import { Ewc25PacketView, EwcReplyView, CommandApiPacketView } from "@/components/ewc25-packet-view";

const LIVE_POLL_MS = 30_000;
const NEW_HIGHLIGHT_MS = 6_000;

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

function LogRow({ entry, isEsense, lcf, isNew = false, sensorRangeMetres1, sensorRangeMetres2, sensorRangeMetres3 }: {
  entry: LogEntry;
  isEsense: boolean;
  lcf?: number | null;
  isNew?: boolean;
  sensorRangeMetres1?: number | null;
  sensorRangeMetres2?: number | null;
  sensorRangeMetres3?: number | null;
}) {
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
    <div className={cn(
      "px-3 py-2.5 hover:bg-muted/30 transition-colors duration-1000",
      isNew && "bg-emerald-500/10 border-l-2 border-emerald-500",
    )}>
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
        <Ewc25PacketView hexPayload={hexStr} isEsense={isEsense} lcf={lcf} sensorRangeMetres1={sensorRangeMetres1} sensorRangeMetres2={sensorRangeMetres2} sensorRangeMetres3={sensorRangeMetres3} />
      ) : isReply && raw ? (
        <EwcReplyView hexPayload={hexStr} lcf={lcf} />
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

export function AssetLogs({ assetId, isEsense = false }: { assetId: string; isEsense?: boolean }) {
  const [category, setCategory] = useState<LogCategory | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [sensorRanges, setSensorRanges] = useState<[number | null, number | null, number | null]>([null, null, null]);

  // ── Live tail: opt-in polling that prepends newly-detected entries ──
  const [live, setLive] = useState(false);
  const [liveEntries, setLiveEntries] = useState<LogEntry[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [countdown, setCountdown] = useState(LIVE_POLL_MS / 1000);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const pollingRef = useRef(false);

  // Reset live state when switching assets
  useEffect(() => {
    setLive(false);
    setLiveEntries([]);
    setNewIds(new Set());
  }, [assetId]);

  // Tick the countdown to the next poll once per second while live.
  useEffect(() => {
    if (!live) {
      setCountdown(LIVE_POLL_MS / 1000);
      return;
    }
    const tick = setInterval(() => {
      setCountdown((s) => (s <= 1 ? LIVE_POLL_MS / 1000 : s - 1));
    }, 1000);
    return () => clearInterval(tick);
  }, [live]);

  // Authoritative LCF (ticks/litre) for decoding per-session litres in packets.
  const { data: ewc } = useGetAssetEwc(assetId, {
    query: { queryKey: getGetAssetEwcQueryKey(assetId) },
  });
  const lcf = ewc?.ewcLcf ?? null;

  useEffect(() => {
    if (!isEsense) return;
    fetch(`/api/ewater/alert-rules/${encodeURIComponent(assetId)}`)
      .then((r) => r.json())
      .then((d: { sensorRangeMetres1?: number | null; sensorRangeMetres2?: number | null; sensorRangeMetres3?: number | null }) => {
        setSensorRanges([d.sensorRangeMetres1 ?? null, d.sensorRangeMetres2 ?? null, d.sensorRangeMetres3 ?? null]);
      })
      .catch(() => {});
  }, [assetId, isEsense]);

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

  const fetchedEntries = useMemo(
    () => data?.pages.flatMap((p) => p.entries) ?? [],
    [data],
  );

  // Merge live-tail entries (newest, polled) with fetched history, deduped by id,
  // kept in descending time order.
  const allEntries = useMemo(() => {
    const map = new Map<string, LogEntry>();
    for (const e of liveEntries) map.set(e.id, e);
    for (const e of fetchedEntries) if (!map.has(e.id)) map.set(e.id, e);
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }, [liveEntries, fetchedEntries]);

  // Keep a ref of all known ids so the poll loop can detect genuinely-new entries.
  useEffect(() => {
    const ids = new Set<string>();
    for (const e of allEntries) ids.add(e.id);
    knownIdsRef.current = ids;
  }, [allEntries]);

  // Live poll: fetch the newest page and prepend any entries we haven't seen.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const poll = async () => {
      if (pollingRef.current) return; // skip if a previous poll is still in-flight
      pollingRef.current = true;
      setCountdown(LIVE_POLL_MS / 1000);
      try {
        const page = await fetchLogPage(assetId, new Date().toISOString());
        if (cancelled) return;
        const fresh = page.entries.filter((e) => !knownIdsRef.current.has(e.id));
        if (fresh.length === 0) return;
        setLiveEntries((prev) => [...fresh, ...prev]);
        setNewIds((prev) => {
          const next = new Set(prev);
          for (const e of fresh) next.add(e.id);
          return next;
        });
        const freshIds = fresh.map((e) => e.id);
        timers.push(setTimeout(() => {
          if (cancelled) return;
          setNewIds((prev) => {
            const next = new Set(prev);
            for (const id of freshIds) next.delete(id);
            return next;
          });
        }, NEW_HIGHLIGHT_MS));
      } catch {
        /* transient poll error — ignore, next tick retries */
      } finally {
        pollingRef.current = false;
      }
    };

    poll();
    const interval = setInterval(poll, LIVE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
      timers.forEach(clearTimeout);
    };
  }, [live, assetId]);

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
      {/* Header: title + live toggle */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Protocol Logs
        </span>
        <button
          onClick={() => setLive((v) => !v)}
          aria-pressed={live}
          className={cn(
            "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors",
            live
              ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/40"
              : "bg-background text-muted-foreground border-border hover:border-foreground/30",
          )}
        >
          <Radio className={cn("w-3 h-3", live && "animate-pulse")} />
          {live ? (
            <>
              Live
              <span className="font-mono tabular-nums text-emerald-600/70">
                {countdown}s
              </span>
            </>
          ) : (
            "Go live"
          )}
        </button>
      </div>

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
            visibleEntries.map((entry) => <LogRow key={entry.id} entry={entry} isEsense={isEsense} lcf={lcf} isNew={newIds.has(entry.id)} sensorRangeMetres1={sensorRanges[0]} sensorRangeMetres2={sensorRanges[1]} sensorRangeMetres3={sensorRanges[2]} />)
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
