import { useState, useEffect, useRef, useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useGetAssetEwc, getGetAssetEwcQueryKey } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/date";
import { cn } from "@/lib/utils";
import { Info, Loader2, Radio, FlaskConical } from "lucide-react";
import { Ewc25PacketView, EwcReplyView, CommandApiPacketView } from "@/components/ewc25-packet-view";
import { TapVisualizer, type ActiveTapAnim } from "@/components/tap-visualizer";
import { entryToTapAnim, type TapAnim } from "@/lib/tap-animation";

const LIVE_POLL_MS = 30_000;
const NEW_HIGHLIGHT_MS = 6_000;
const ANIM_SETTLE_MS = 9_000;

// ── TESTING ONLY: every animation the tap visualizer can play, so the
// animations can be forced manually without waiting for a real log.
// Remove this block (and its UI panel below) once testing is finished.
const TEST_ANIMS: TapAnim[] = [
  { kind: "dispense", label: "Water dispensed", tone: "water" },
  { kind: "tag-removed", label: "Tag removed", tone: "warn" },
  { kind: "dispense-limit", label: "Dispense limit reached", tone: "warn" },
  { kind: "no-credit", label: "No credit", tone: "warn" },
  { kind: "valve-off", label: "Host valve off", tone: "warn" },
  { kind: "no-flow", label: "No flow", tone: "warn" },
  { kind: "low-battery", label: "Low battery", tone: "warn" },
  { kind: "tamper", label: "Tamper detected", tone: "error" },
  { kind: "prox", label: "Proximity detect", tone: "info" },
  { kind: "pressure", label: "Pressure event", tone: "info" },
  { kind: "health", label: "Healthy signal", tone: "good" },
  { kind: "startup", label: "Start-up", tone: "info" },
  { kind: "command", label: "Command reply", tone: "info" },
  { kind: "gadwall", label: "Gadwall signal", tone: "info" },
  { kind: "beam", label: "Beam signal", tone: "info" },
  { kind: "error", label: "Error event", tone: "error" },
];

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
  const [activeAnim, setActiveAnim] = useState<ActiveTapAnim | null>(null);
  const [showTester, setShowTester] = useState(false); // TESTING ONLY
  const knownIdsRef = useRef<Set<string>>(new Set());
  const pollingRef = useRef(false);
  const animNonceRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Short synthesized chime for newly-arrived log entries (no asset file needed).
  const playChime = () => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(1175, now + 0.12);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.36);
  };

  // Toggle live mode; lazily create/resume the AudioContext on the user gesture
  // so the browser permits sound playback.
  const toggleLive = () => {
    setLive((v) => {
      const next = !v;
      if (next) {
        try {
          audioCtxRef.current ??= new (window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
          void audioCtxRef.current.resume();
        } catch {
          /* audio unsupported — live tail still works silently */
        }
      }
      return next;
    });
  };

  // TESTING ONLY: force a given animation to play, mimicking a fresh log.
  const fireTestAnim = (anim: TapAnim) => {
    animNonceRef.current += 1;
    setActiveAnim({ ...anim, nonce: animNonceRef.current });
  };

  // Close the AudioContext when the component unmounts.
  useEffect(() => {
    return () => {
      void audioCtxRef.current?.close();
      audioCtxRef.current = null;
    };
  }, []);

  // Reset live state when switching assets
  useEffect(() => {
    setLive(false);
    setLiveEntries([]);
    setNewIds(new Set());
    setActiveAnim(null);
  }, [assetId]);

  // Clear the tap animation when live mode is turned off.
  useEffect(() => {
    if (!live) setActiveAnim(null);
  }, [live]);

  // Settle the animation back to idle after a short while so a stale
  // dispense/error state doesn't linger between (30s-apart) polls.
  useEffect(() => {
    if (!activeAnim || activeAnim.kind === "idle") return;
    const t = setTimeout(() => {
      animNonceRef.current += 1;
      setActiveAnim({ kind: "idle", label: "", tone: "water", nonce: animNonceRef.current });
    }, ANIM_SETTLE_MS);
    return () => clearTimeout(t);
  }, [activeAnim]);

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
        playChime();
        // Drive the tap visualizer from the newest fresh entry.
        const newest = fresh[0];
        if (newest) {
          const anim = entryToTapAnim(newest.protocol, newest.message);
          animNonceRef.current += 1;
          setActiveAnim({ ...anim, nonce: animNonceRef.current });
        }
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
        <div className="flex items-center gap-1.5">
          {/* TESTING ONLY: toggle the animation tester panel */}
          <button
            onClick={() => setShowTester((v) => !v)}
            aria-pressed={showTester}
            className={cn(
              "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors",
              showTester
                ? "bg-purple-500/10 text-purple-600 border-purple-500/40"
                : "bg-background text-muted-foreground border-border hover:border-foreground/30",
            )}
          >
            <FlaskConical className="w-3 h-3" />
            Test
          </button>
          <button
            onClick={toggleLive}
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
      </div>

      {/* TESTING ONLY: animation tester — pick any animation to force it.
          Remove this block and the TEST_ANIMS / fireTestAnim helpers when done. */}
      {showTester && (
        <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-2.5 space-y-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-purple-600">
            <FlaskConical className="w-3 h-3" />
            Animation tester
          </p>
          <div className="flex flex-wrap gap-1.5">
            {TEST_ANIMS.map((anim) => (
              <button
                key={anim.kind}
                onClick={() => fireTestAnim(anim)}
                className="text-xs px-2.5 py-1 rounded-full border border-purple-500/30 bg-background text-foreground/80 hover:border-purple-500/60 hover:bg-purple-500/10 transition-colors"
              >
                {anim.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Live tap visualizer — reacts to incoming entries while live or testing */}
      {(live || showTester) && (
        <div className="py-1">
          <TapVisualizer active={activeAnim} />
        </div>
      )}

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
