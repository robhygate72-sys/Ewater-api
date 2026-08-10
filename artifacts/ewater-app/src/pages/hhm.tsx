import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatTimeAgo, formatDateTime } from "@/lib/date";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import {
  Droplets,
  Zap,
  Radio,
  AlertTriangle,
  CheckCircle2,
  Activity,
  Gauge,
  ShieldAlert,
  Waves,
  RefreshCw,
} from "lucide-react";
import { format } from "date-fns";

// ── Asset config ────────────────────────────────────────────────────────────
const HHM_ASSET_ID = "2971";
const POLL_MS = 30_000;
const HISTORY_DAYS = 7;

// ── Types ───────────────────────────────────────────────────────────────────

interface ShengdaDecoded {
  valid: boolean;
  messageType: string | null;
  messageFunction: string | null;
  meterReading: number | null;
  prepayLitres: number | null;
  supplyVoltage: number | null;
  batteryState: string | null;
  valveStatus: string | null;
  signalPower: string | null;
  signalSnr: string | null;
  errorCode: number | null;
  magneticAttack: boolean | null;
  description: string | null;
}

interface LogEntry {
  id: string;
  timestamp: string;
  source: string | null;
  protocol: string | null;
  pipeline: string | null;
  message: string | null;
  shengda?: ShengdaDecoded | null;
}

interface LogPage {
  entries: LogEntry[];
  nextBefore: string | null;
  hasMore: boolean;
}

// ── Fetch ───────────────────────────────────────────────────────────────────

async function fetchHhmLogs(): Promise<LogEntry[]> {
  const params = new URLSearchParams({
    limit: "100",
    windowDays: String(HISTORY_DAYS),
  });
  const res = await fetch(
    `/api/ewater/assets/${HHM_ASSET_ID}/logs?${params}`,
  );
  if (!res.ok) throw new Error("Failed to fetch HHM logs");
  const page: LogPage = await res.json();
  return page.entries.filter((e) => e.shengda !== null && e.shengda !== undefined);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseSignal(raw: string | null): number | null {
  if (!raw) return null;
  const m = raw.match(/-?\d+/);
  return m ? parseInt(m[0]!, 10) : null;
}

function signalLabel(rsrp: number | null): { label: string; ok: boolean } {
  if (rsrp === null) return { label: "Unknown", ok: false };
  if (rsrp >= -85) return { label: "Excellent", ok: true };
  if (rsrp >= -100) return { label: "Good", ok: true };
  if (rsrp >= -110) return { label: "Fair", ok: true };
  return { label: "Poor", ok: false };
}

function batteryOk(state: string | null): boolean {
  if (!state) return false;
  return state.toLowerCase().includes("normal") || state.toLowerCase().includes("good");
}

function voltageLabel(v: number | null): string {
  if (v === null) return "—";
  return `${v.toFixed(2)} V`;
}

function formatShortTime(iso: string): string {
  try {
    return format(new Date(iso), "dd/MM HH:mm");
  } catch {
    return iso;
  }
}

// ── Status card ──────────────────────────────────────────────────────────────

function StatusCard({
  icon: Icon,
  label,
  value,
  sub,
  ok,
  warn,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  ok?: boolean;
  warn?: boolean;
}) {
  return (
    <Card
      className={cn(
        "border shadow-sm",
        ok === true && "border-emerald-500/40 bg-emerald-500/5",
        warn === true && "border-amber-500/40 bg-amber-500/5",
        ok === false && warn !== true && "border-destructive/40 bg-destructive/5",
      )}
    >
      <CardContent className="p-3 flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <Icon
            className={cn(
              "w-3.5 h-3.5 shrink-0",
              ok === true && "text-emerald-600",
              warn === true && "text-amber-600",
              ok === false && warn !== true && "text-destructive",
              ok === undefined && warn === undefined && "text-muted-foreground",
            )}
          />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
        </div>
        <span className="text-base font-bold leading-tight tabular-nums">{value}</span>
        {sub && <span className="text-[10px] text-muted-foreground">{sub}</span>}
      </CardContent>
    </Card>
  );
}

// ── Trend chart ──────────────────────────────────────────────────────────────

interface ChartPoint {
  ts: number;
  label: string;
  value: number | null;
}

function TrendChart({
  title,
  data,
  unit,
  color,
  refLineValue,
  refLineLabel,
  domain,
}: {
  title: string;
  data: ChartPoint[];
  unit: string;
  color: string;
  refLineValue?: number;
  refLineLabel?: string;
  domain?: [number | string, number | string];
}) {
  if (data.length === 0) {
    return (
      <Card className="border shadow-sm">
        <CardHeader className="pb-1 pt-3 px-4">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
            No data
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border shadow-sm">
      <CardHeader className="pb-1 pt-3 px-4">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-1 pb-3">
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 9, fill: "rgba(0,0,0,0.4)" }}
              interval="preserveStartEnd"
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 9, fill: "rgba(0,0,0,0.4)" }}
              tickLine={false}
              axisLine={false}
              domain={domain}
              width={48}
              tickFormatter={(v) => `${v}${unit}`}
            />
            <Tooltip
              contentStyle={{ fontSize: 11, borderRadius: 6 }}
              formatter={(v: number) => [`${v}${unit}`, title]}
              labelFormatter={(l) => String(l)}
            />
            {refLineValue !== undefined && (
              <ReferenceLine
                y={refLineValue}
                stroke="rgba(239,68,68,0.5)"
                strokeDasharray="4 2"
                label={{ value: refLineLabel ?? "", fontSize: 9, fill: "rgba(239,68,68,0.7)" }}
              />
            )}
            <Line
              type="monotone"
              dataKey="value"
              stroke={color}
              dot={false}
              strokeWidth={2}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ── Event row ────────────────────────────────────────────────────────────────

function EventRow({
  entry,
  isNew,
}: {
  entry: LogEntry;
  isNew: boolean;
}) {
  const s = entry.shengda!;
  const hasError = s.errorCode !== null && s.errorCode !== 0;
  const hasMagnetic = s.magneticAttack === true;
  const isAlert = hasError || hasMagnetic;

  return (
    <div
      className={cn(
        "px-3 py-2.5 border-b border-border/40 last:border-0 transition-colors duration-700",
        isNew && "bg-emerald-500/10 border-l-2 border-l-emerald-500",
        isAlert && !isNew && "bg-amber-500/5",
      )}
    >
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        {isAlert && <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />}
        <span className="text-[10px] font-mono text-muted-foreground shrink-0">
          {formatDateTime(entry.timestamp)}
        </span>
        <span className="text-[10px] font-medium text-muted-foreground/70 truncate">
          {s.messageType ?? "Packet"} · {s.messageFunction ?? "—"}
        </span>
        {isNew && (
          <Badge className="ml-auto text-[9px] px-1.5 py-0 h-4 bg-emerald-500 text-white border-0">
            NEW
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {s.meterReading !== null && (
          <span className="text-xs text-foreground">
            <span className="text-muted-foreground">Meter:</span>{" "}
            <span className="font-mono font-semibold">{s.meterReading.toLocaleString()}</span>
            <span className="text-muted-foreground text-[10px]"> pulses</span>
          </span>
        )}
        {s.prepayLitres !== null && (
          <span className="text-xs text-foreground">
            <span className="text-muted-foreground">Prepay:</span>{" "}
            <span className="font-mono font-semibold">{s.prepayLitres.toFixed(1)}</span>
            <span className="text-muted-foreground text-[10px]"> L</span>
          </span>
        )}
        {s.supplyVoltage !== null && (
          <span className="text-xs text-foreground">
            <span className="text-muted-foreground">Voltage:</span>{" "}
            <span className="font-mono font-semibold">{s.supplyVoltage.toFixed(2)}</span>
            <span className="text-muted-foreground text-[10px]"> V</span>
          </span>
        )}
        {s.valveStatus && (
          <span className="text-xs text-foreground">
            <span className="text-muted-foreground">Valve:</span>{" "}
            <span
              className={cn(
                "font-semibold",
                s.valveStatus.toLowerCase().includes("open")
                  ? "text-emerald-600"
                  : "text-muted-foreground",
              )}
            >
              {s.valveStatus}
            </span>
          </span>
        )}
        {s.signalPower && (
          <span className="text-xs text-muted-foreground">
            Signal: {s.signalPower}
          </span>
        )}
        {hasError && (
          <span className="text-xs text-amber-600 font-semibold">
            ⚠ Error {s.errorCode}
          </span>
        )}
        {hasMagnetic && (
          <span className="text-xs text-destructive font-semibold">
            ⚠ Magnetic attack
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function HhmPage() {
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const knownIdsRef = useRef<Set<string>>(new Set());
  const [secondsToRefresh, setSecondsToRefresh] = useState(POLL_MS / 1000);

  const { data: entries = [], isLoading, isError, dataUpdatedAt } = useQuery<LogEntry[], Error>({
    queryKey: ["hhm-logs", HHM_ASSET_ID],
    queryFn: fetchHhmLogs,
    refetchInterval: POLL_MS,
    staleTime: POLL_MS,
  });

  // Detect newly arrived entries and highlight them briefly
  useEffect(() => {
    if (!entries.length) return;
    const fresh = entries.filter((e) => !knownIdsRef.current.has(e.id));
    if (fresh.length === 0) return;

    const freshIds = new Set(fresh.map((e) => e.id));
    setNewIds((prev) => new Set([...prev, ...freshIds]));
    for (const e of entries) knownIdsRef.current.add(e.id);

    const timer = setTimeout(() => {
      setNewIds((prev) => {
        const next = new Set(prev);
        for (const id of freshIds) next.delete(id);
        return next;
      });
    }, 6000);
    return () => clearTimeout(timer);
  }, [entries]);

  // Countdown to next poll
  useEffect(() => {
    if (!dataUpdatedAt) return;
    setSecondsToRefresh(POLL_MS / 1000);
    const tick = setInterval(() => {
      setSecondsToRefresh((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(tick);
  }, [dataUpdatedAt]);

  // ── Latest values ────────────────────────────────────────────────────────

  const latest = useMemo(() => {
    return entries.find((e) => e.shengda !== null)?.shengda ?? null;
  }, [entries]);

  // ── Chart data ───────────────────────────────────────────────────────────

  const { voltagePoints, meterPoints, prepayPoints } = useMemo(() => {
    const reversed = [...entries].reverse(); // chronological order for charts
    const voltagePoints: ChartPoint[] = reversed
      .filter((e) => e.shengda?.supplyVoltage !== null)
      .map((e) => ({
        ts: new Date(e.timestamp).getTime(),
        label: formatShortTime(e.timestamp),
        value: e.shengda!.supplyVoltage!,
      }));

    const meterPoints: ChartPoint[] = reversed
      .filter((e) => e.shengda?.meterReading !== null)
      .map((e) => ({
        ts: new Date(e.timestamp).getTime(),
        label: formatShortTime(e.timestamp),
        value: e.shengda!.meterReading!,
      }));

    const prepayPoints: ChartPoint[] = reversed
      .filter((e) => e.shengda?.prepayLitres !== null)
      .map((e) => ({
        ts: new Date(e.timestamp).getTime(),
        label: formatShortTime(e.timestamp),
        value: e.shengda!.prepayLitres!,
      }));

    return { voltagePoints, meterPoints, prepayPoints };
  }, [entries]);

  // ── Derived status ───────────────────────────────────────────────────────

  const rsrp = parseSignal(latest?.signalPower ?? null);
  const sig = signalLabel(rsrp);
  const batOk = batteryOk(latest?.batteryState ?? null);
  const hasErrors = entries.some(
    (e) => e.shengda?.errorCode !== null && e.shengda!.errorCode !== 0,
  );
  const faultCount = entries.filter(
    (e) => e.shengda?.errorCode !== null && e.shengda!.errorCode !== 0,
  ).length;

  const lastSeen = entries[0]?.timestamp ?? null;

  return (
    <Layout title="HHM Dashboard">
      <div className="space-y-4">

        {/* ── Header strip ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Asset 2971 · Shengda NB-IoT
            </p>
            {lastSeen && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Last packet {formatTimeAgo(lastSeen)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <RefreshCw className={cn("w-3 h-3", secondsToRefresh === 0 && "animate-spin")} />
            <span className="tabular-nums">{secondsToRefresh}s</span>
          </div>
        </div>

        {/* ── Loading skeleton ──────────────────────────────────────────── */}
        {isLoading && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-lg" />
              ))}
            </div>
            <Skeleton className="h-32 rounded-lg" />
            <Skeleton className="h-32 rounded-lg" />
          </div>
        )}

        {/* ── Error ────────────────────────────────────────────────────── */}
        {isError && !isLoading && (
          <Card className="border-destructive bg-destructive/5">
            <CardContent className="p-4 flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="text-sm">Failed to load HHM logs for asset {HHM_ASSET_ID}.</span>
            </CardContent>
          </Card>
        )}

        {!isLoading && !isError && (
          <>
            {/* ── No Shengda data yet ───────────────────────────────────── */}
            {entries.length === 0 && (
              <Card className="border border-dashed">
                <CardContent className="p-8 flex flex-col items-center gap-2 text-center">
                  <Radio className="w-8 h-8 text-muted-foreground opacity-30" />
                  <p className="text-sm text-muted-foreground">
                    No Shengda NB-IoT packets from asset {HHM_ASSET_ID} in the last {HISTORY_DAYS} days.
                  </p>
                </CardContent>
              </Card>
            )}

            {entries.length > 0 && (
              <>
                {/* ── Status grid ──────────────────────────────────────── */}
                <section>
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Current Status
                  </h2>
                  <div className="grid grid-cols-2 gap-2">
                    <StatusCard
                      icon={Waves}
                      label="Valve"
                      value={latest?.valveStatus ?? "—"}
                      ok={latest?.valveStatus?.toLowerCase().includes("open") ? true : latest?.valveStatus ? false : undefined}
                    />
                    <StatusCard
                      icon={Zap}
                      label="Battery"
                      value={latest?.batteryState ?? "—"}
                      sub={voltageLabel(latest?.supplyVoltage ?? null)}
                      ok={batOk ? true : latest?.batteryState ? false : undefined}
                    />
                    <StatusCard
                      icon={Gauge}
                      label="Meter Reading"
                      value={latest?.meterReading !== null && latest?.meterReading !== undefined
                        ? latest.meterReading.toLocaleString()
                        : "—"}
                      sub="pulses (lifetime)"
                    />
                    <StatusCard
                      icon={Droplets}
                      label="Prepay Balance"
                      value={latest?.prepayLitres !== null && latest?.prepayLitres !== undefined
                        ? `${latest.prepayLitres.toFixed(1)} L`
                        : "—"}
                      ok={
                        latest?.prepayLitres !== null && latest?.prepayLitres !== undefined
                          ? latest.prepayLitres > 10
                            ? true
                            : false
                          : undefined
                      }
                      warn={
                        latest?.prepayLitres !== null && latest?.prepayLitres !== undefined
                          ? latest.prepayLitres > 0 && latest.prepayLitres <= 10
                          : false
                      }
                    />
                    <StatusCard
                      icon={Radio}
                      label="Signal"
                      value={sig.label}
                      sub={rsrp !== null ? `${rsrp} dBm RSRP` : undefined}
                      ok={sig.ok}
                    />
                    <StatusCard
                      icon={faultCount > 0 ? AlertTriangle : CheckCircle2}
                      label="Faults (7d)"
                      value={faultCount === 0 ? "None" : String(faultCount)}
                      ok={faultCount === 0 ? true : false}
                      warn={faultCount > 0}
                    />
                  </div>
                </section>

                {/* ── Magnetic attack banner ────────────────────────────── */}
                {entries.some((e) => e.shengda?.magneticAttack === true) && (
                  <Card className="border-destructive bg-destructive/10">
                    <CardContent className="p-3 flex items-center gap-2 text-destructive">
                      <ShieldAlert className="w-4 h-4 shrink-0" />
                      <span className="text-sm font-semibold">
                        Magnetic attack detected in recent packets
                      </span>
                    </CardContent>
                  </Card>
                )}

                {/* ── Trends ───────────────────────────────────────────── */}
                <section>
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    7-Day Trends
                  </h2>
                  <div className="space-y-3">
                    <TrendChart
                      title="Supply Voltage"
                      data={voltagePoints}
                      unit=" V"
                      color="#3b82f6"
                      refLineValue={3.0}
                      refLineLabel="Low"
                      domain={["auto", "auto"]}
                    />
                    <TrendChart
                      title="Prepay Balance"
                      data={prepayPoints}
                      unit=" L"
                      color="#10b981"
                      refLineValue={10}
                      refLineLabel="10L"
                      domain={[0, "auto"]}
                    />
                    <TrendChart
                      title="Meter Reading"
                      data={meterPoints}
                      unit=""
                      color="#8b5cf6"
                      domain={["auto", "auto"]}
                    />
                  </div>
                </section>

                {/* ── Event feed ───────────────────────────────────────── */}
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Recent Packets
                    </h2>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <Activity className="w-3 h-3" />
                      <span>{entries.length} in {HISTORY_DAYS}d</span>
                    </div>
                  </div>
                  <Card className="border shadow-sm overflow-hidden">
                    {entries.slice(0, 20).map((entry) => (
                      <EventRow
                        key={entry.id}
                        entry={entry}
                        isNew={newIds.has(entry.id)}
                      />
                    ))}
                  </Card>
                </section>
              </>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
