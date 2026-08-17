import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useRoute } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { formatDateTime, formatTimeAgo } from "@/lib/date";
import { cn } from "@/lib/utils";
import {
  Gauge,
  Droplets,
  Zap,
  BatteryMedium,
  Power,
  Signal,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Radio,
  RefreshCw,
  ChevronRight,
  Info,
  ShieldAlert,
  Activity,
} from "lucide-react";

// ─── Constants ───────────────────────────────────────────────────────────────

const POLL_MS = 30_000;
const NEW_HIGHLIGHT_MS = 8_000;

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── Data fetching ───────────────────────────────────────────────────────────

async function fetchLogPage(assetId: string, before: string, limit = 50): Promise<LogPage> {
  const params = new URLSearchParams({ before, limit: String(limit) });
  const res = await fetch(`/api/ewater/assets/${assetId}/logs?${params}`);
  if (!res.ok) throw new Error("Failed to fetch logs");
  return res.json() as Promise<LogPage>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function batteryColor(state: string | null): string {
  if (!state) return "text-muted-foreground";
  const s = state.toLowerCase();
  if (s.includes("low") || s.includes("critical")) return "text-destructive";
  if (s.includes("good") || s.includes("normal") || s.includes("full")) return "text-emerald-600";
  return "text-amber-500";
}

function valveColor(status: string | null): string {
  if (!status) return "text-muted-foreground";
  const s = status.toLowerCase();
  if (s.includes("open")) return "text-emerald-600";
  if (s.includes("close") || s.includes("shut")) return "text-amber-500";
  return "text-muted-foreground";
}

function voltageColor(v: number | null): string {
  if (v === null) return "text-muted-foreground";
  if (v < 3.2) return "text-destructive";
  if (v < 3.5) return "text-amber-500";
  return "text-emerald-600";
}

function hasError(s: ShengdaDecoded): boolean {
  return (s.errorCode !== null && s.errorCode !== 0) || s.magneticAttack === true || !s.valid;
}

function meterDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  const d = current - previous;
  return d > 0 ? d : null;
}

// ─── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  valueClass = "",
  loading,
}: {
  icon: React.FC<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
  loading?: boolean;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          <div className="mt-0.5 shrink-0 w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="w-3.5 h-3.5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none mb-1">
              {label}
            </p>
            {loading ? (
              <Skeleton className="h-5 w-16" />
            ) : (
              <p className={cn("text-base font-semibold leading-tight truncate", valueClass)}>
                {value}
              </p>
            )}
            {sub && !loading && (
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-none">{sub}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Log Row ─────────────────────────────────────────────────────────────────

function LogRow({
  entry,
  prevMeterReading,
  isNew,
  onClick,
}: {
  entry: LogEntry;
  prevMeterReading: number | null;
  isNew: boolean;
  onClick: () => void;
}) {
  const s = entry.shengda!;
  const isError = hasError(s);
  const delta = meterDelta(s.meterReading, prevMeterReading);

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-2.5 hover:bg-muted/40 transition-colors duration-700 flex items-start gap-2 group",
        isNew && "bg-emerald-500/10 border-l-2 border-emerald-500",
        !isNew && "border-l-2 border-transparent",
      )}
    >
      {/* Error/OK indicator */}
      <div className="mt-0.5 shrink-0">
        {isError ? (
          <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
        ) : (
          <div className="w-3.5 h-3.5 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          <span className="text-[10px] font-mono text-muted-foreground shrink-0">
            {formatDateTime(entry.timestamp)}
          </span>
          {isNew && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-emerald-500/50 text-emerald-600 bg-emerald-500/10">
              new
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {/* Message type */}
          {s.messageFunction && (
            <span className="text-[11px] font-medium text-foreground">
              {s.messageFunction}
            </span>
          )}

          {/* Meter reading */}
          {s.meterReading !== null && (
            <span className="text-[11px] text-muted-foreground">
              <span className="font-mono">{s.meterReading.toLocaleString()}</span>
              {" "}L
              {delta !== null && (
                <span className="text-emerald-600 ml-1">+{delta.toLocaleString()}</span>
              )}
            </span>
          )}

          {/* Valve */}
          {s.valveStatus && (
            <span className={cn("text-[11px]", valveColor(s.valveStatus))}>
              {s.valveStatus}
            </span>
          )}

          {/* Error */}
          {isError && (
            <span className="text-[11px] text-destructive">
              {s.magneticAttack ? "Magnetic attack" : !s.valid ? "CRC invalid" : `Error ${s.errorCode}`}
            </span>
          )}
        </div>
      </div>

      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-muted-foreground mt-1 shrink-0 transition-colors" />
    </button>
  );
}

// ─── Log Detail Dialog ────────────────────────────────────────────────────────

function FieldRow({ label, value, valueClass }: { label: string; value: string | number | null | boolean; valueClass?: string }) {
  if (value === null || value === undefined) return null;
  const display =
    typeof value === "boolean"
      ? value ? "Yes" : "No"
      : String(value);
  return (
    <div className="flex justify-between items-start gap-3 py-2 border-b border-border/40 last:border-0">
      <span className="text-[11px] text-muted-foreground shrink-0 font-medium">{label}</span>
      <span className={cn("text-[11px] text-right font-mono break-all", valueClass ?? "text-foreground")}>
        {display}
      </span>
    </div>
  );
}

function LogDetailDialog({
  entry,
  open,
  onClose,
  assetId,
}: {
  entry: LogEntry | null;
  open: boolean;
  onClose: () => void;
  assetId: string;
}) {
  if (!entry?.shengda) return null;
  const s = entry.shengda;
  const isError = hasError(s);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto p-0">
        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/60">
          <div className="flex items-center gap-2 mb-1">
            {s.valid ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 text-destructive shrink-0" />
            )}
            <Badge variant={s.valid ? "outline" : "destructive"} className="text-[10px] px-1.5 py-0 h-4">
              {s.valid ? "Checksum OK" : "Invalid CRC"}
            </Badge>
            {isError && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">
                Error
              </Badge>
            )}
          </div>
          <DialogTitle className="text-sm font-semibold leading-snug">
            {s.messageFunction ?? s.messageType ?? "Shengda Packet"}
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            {formatDateTime(entry.timestamp)} · Asset {assetId}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-3 space-y-4">

          {/* Meter / Water */}
          <section>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1.5">
              <Droplets className="w-3 h-3" /> Meter
            </p>
            <div className="rounded-lg border border-border/60 px-3 divide-y divide-border/40">
              <FieldRow
                label="Meter Reading"
                value={s.meterReading !== null ? `${s.meterReading.toLocaleString()} L` : null}
              />
              <FieldRow
                label="Prepay Balance"
                value={s.prepayLitres !== null ? `${s.prepayLitres.toLocaleString()} L` : null}
              />
            </div>
          </section>

          {/* Power */}
          <section>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1.5">
              <Zap className="w-3 h-3" /> Power
            </p>
            <div className="rounded-lg border border-border/60 px-3 divide-y divide-border/40">
              <FieldRow
                label="Supply Voltage"
                value={s.supplyVoltage !== null ? `${s.supplyVoltage.toFixed(2)} V` : null}
                valueClass={voltageColor(s.supplyVoltage)}
              />
              <FieldRow
                label="Battery State"
                value={s.batteryState}
                valueClass={batteryColor(s.batteryState)}
              />
            </div>
          </section>

          {/* Valve & System */}
          <section>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1.5">
              <Power className="w-3 h-3" /> System
            </p>
            <div className="rounded-lg border border-border/60 px-3 divide-y divide-border/40">
              <FieldRow
                label="Valve Status"
                value={s.valveStatus}
                valueClass={valveColor(s.valveStatus)}
              />
              <FieldRow
                label="Error Code"
                value={s.errorCode !== null ? (s.errorCode === 0 ? "None (0)" : `${s.errorCode}`) : null}
                valueClass={s.errorCode !== null && s.errorCode !== 0 ? "text-destructive" : undefined}
              />
              <FieldRow
                label="Magnetic Attack"
                value={s.magneticAttack !== null ? s.magneticAttack : null}
                valueClass={s.magneticAttack ? "text-destructive" : "text-emerald-600"}
              />
            </div>
          </section>

          {/* Signal */}
          {(s.signalPower || s.signalSnr) && (
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1.5">
                <Signal className="w-3 h-3" /> Signal
              </p>
              <div className="rounded-lg border border-border/60 px-3 divide-y divide-border/40">
                <FieldRow label="Signal Power (RSRP)" value={s.signalPower} />
                <FieldRow label="Signal SNR" value={s.signalSnr} />
              </div>
            </section>
          )}

          {/* Protocol */}
          <section>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1.5">
              <Activity className="w-3 h-3" /> Protocol
            </p>
            <div className="rounded-lg border border-border/60 px-3 divide-y divide-border/40">
              <FieldRow label="Message Type" value={s.messageType} />
              <FieldRow label="Message Function" value={s.messageFunction} />
              <FieldRow label="Pipeline" value={entry.pipeline} />
              <FieldRow label="Source (IMEI)" value={entry.source} />
            </div>
          </section>

          {/* Raw description (collapsible) */}
          {s.description && (
            <RawDescription description={s.description} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RawDescription({ description }: { description: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1.5 hover:text-foreground transition-colors"
      >
        <Info className="w-3 h-3" /> Raw Frame Description
        <ChevronRight className={cn("w-3 h-3 transition-transform", expanded && "rotate-90")} />
      </button>
      {expanded && (
        <pre className="text-[10px] font-mono leading-relaxed whitespace-pre-wrap break-all bg-muted/40 rounded-lg p-3 text-muted-foreground">
          {description}
        </pre>
      )}
    </section>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function HhmPage() {
  const [, params] = useRoute("/hhm/:id");
  const assetId = params?.id ?? "";

  const [allEntries, setAllEntries] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [countdown, setCountdown] = useState(POLL_MS / 1000);
  const [selectedEntry, setSelectedEntry] = useState<LogEntry | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [lastPoll, setLastPoll] = useState<Date | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const knownIdsRef = useRef<Set<string>>(new Set());

  // Only Shengda entries
  const shengdaEntries = useMemo(
    () => allEntries.filter((e) => !!e.shengda),
    [allEntries],
  );

  // Latest Shengda entry for status cards
  const latest = shengdaEntries[0] ?? null;
  const latestS = latest?.shengda ?? null;

  // ── Initial load ─────────────────────────────────────────────────────────
  const loadInitial = useCallback(async () => {
    if (!assetId) return;
    setIsLoading(true);
    setIsError(false);
    try {
      const page = await fetchLogPage(assetId, new Date().toISOString(), 100);
      setAllEntries(page.entries);
      const ids = new Set(page.entries.map((e) => e.id));
      knownIdsRef.current = ids;
      setLastPoll(new Date());
    } catch {
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  }, [assetId]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  // ── Auto-poll every 30s ──────────────────────────────────────────────────
  useEffect(() => {
    const poll = async () => {
      if (isPolling) return;
      setIsPolling(true);
      setCountdown(POLL_MS / 1000);
      try {
        const page = await fetchLogPage(assetId, new Date().toISOString(), 50);
        const fresh = page.entries.filter((e) => !knownIdsRef.current.has(e.id));
        if (fresh.length > 0) {
          setAllEntries((prev) => {
            const map = new Map<string, LogEntry>();
            for (const e of fresh) map.set(e.id, e);
            for (const e of prev) if (!map.has(e.id)) map.set(e.id, e);
            return Array.from(map.values()).sort(
              (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
            );
          });
          const freshIds = fresh.map((e) => e.id);
          setNewIds((prev) => {
            const next = new Set(prev);
            for (const id of freshIds) next.add(id);
            return next;
          });
          for (const e of fresh) knownIdsRef.current.add(e.id);
          // Clear highlights after N seconds
          setTimeout(() => {
            setNewIds((prev) => {
              const next = new Set(prev);
              for (const id of freshIds) next.delete(id);
              return next;
            });
          }, NEW_HIGHLIGHT_MS);
        }
        setLastPoll(new Date());
      } catch {
        /* transient error — retry next tick */
      } finally {
        setIsPolling(false);
      }
    };

    const interval = setInterval(poll, POLL_MS);
    return () => clearInterval(interval);
  }, [isPolling]);

  // ── Countdown ticker ─────────────────────────────────────────────────────
  useEffect(() => {
    const tick = setInterval(() => {
      setCountdown((s) => (s <= 1 ? POLL_MS / 1000 : s - 1));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  // ── Open dialog ──────────────────────────────────────────────────────────
  const openEntry = (entry: LogEntry) => {
    setSelectedEntry(entry);
    setDialogOpen(true);
  };

  // ── Derived status values ─────────────────────────────────────────────────

  const statusItems = [
    {
      icon: Gauge,
      label: "Meter Reading",
      value: latestS?.meterReading != null ? `${latestS.meterReading.toLocaleString()} L` : "—",
      sub: latest ? `as of ${formatTimeAgo(latest.timestamp)}` : undefined,
    },
    {
      icon: Droplets,
      label: "Prepay Balance",
      value: latestS?.prepayLitres != null ? `${latestS.prepayLitres.toLocaleString()} L` : "—",
      sub: latestS?.prepayLitres != null && latestS.prepayLitres < 20 ? "⚠ Low balance" : undefined,
    },
    {
      icon: Zap,
      label: "Supply Voltage",
      value: latestS?.supplyVoltage != null ? `${latestS.supplyVoltage.toFixed(2)} V` : "—",
      valueClass: voltageColor(latestS?.supplyVoltage ?? null),
    },
    {
      icon: BatteryMedium,
      label: "Battery",
      value: latestS?.batteryState ?? "—",
      valueClass: batteryColor(latestS?.batteryState ?? null),
    },
    {
      icon: Power,
      label: "Valve",
      value: latestS?.valveStatus ?? "—",
      valueClass: valveColor(latestS?.valveStatus ?? null),
    },
    {
      icon: Signal,
      label: "Signal",
      value: latestS?.signalPower ? latestS.signalPower.split(" ")[0]! : "—",
      sub: latestS?.signalSnr ? `SNR ${latestS.signalSnr.split(" ")[0]}` : undefined,
    },
  ];

  return (
    <Layout title="HHM Dashboard">
      <div className="space-y-4">

        {/* ── Asset banner ─────────────────────────────────────────── */}
        <div className="rounded-xl bg-primary/5 border border-primary/20 px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <ShieldAlert className="w-4 h-4 text-primary shrink-0" />
                <p className="text-sm font-semibold text-foreground">
                  Household Meter – Asset {assetId}
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Shengda NB-IoT · O&amp;M Management Dashboard
              </p>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <div className="flex items-center gap-1.5 text-[10px] text-emerald-600">
                <Radio className="w-3 h-3 animate-pulse" />
                <span className="font-mono tabular-nums">{countdown}s</span>
              </div>
              {lastPoll && (
                <span className="text-[10px] text-muted-foreground">
                  Updated {formatTimeAgo(lastPoll.toISOString())}
                </span>
              )}
            </div>
          </div>

          {/* Alert banner for errors */}
          {!isLoading && latestS && hasError(latestS) && (
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
              <p className="text-[11px] text-destructive font-medium">
                {latestS.magneticAttack
                  ? "Magnetic attack detected on latest packet"
                  : !latestS.valid
                  ? "Latest packet has invalid CRC"
                  : `Error code ${latestS.errorCode} on latest packet`}
              </p>
            </div>
          )}
        </div>

        {/* ── Status cards ─────────────────────────────────────────── */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
            Current Status
          </p>
          <div className="grid grid-cols-2 gap-2">
            {statusItems.map((item) => (
              <StatCard
                key={item.label}
                icon={item.icon}
                label={item.label}
                value={item.value}
                sub={item.sub}
                valueClass={item.valueClass}
                loading={isLoading}
              />
            ))}
          </div>
        </div>

        {/* ── Log timeline ─────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Data Log
              {!isLoading && shengdaEntries.length > 0 && (
                <span className="ml-1.5 font-normal normal-case text-muted-foreground/60">
                  ({shengdaEntries.length} packets)
                </span>
              )}
            </p>
            <button
              onClick={loadInitial}
              disabled={isLoading}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className={cn("w-3 h-3", isLoading && "animate-spin")} />
              Refresh
            </button>
          </div>

          <Card className="shadow-sm overflow-hidden">
            {isLoading ? (
              <div className="divide-y divide-border/40">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="px-3 py-2.5 flex gap-2">
                    <Skeleton className="w-3.5 h-3.5 rounded-full mt-0.5 shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3 w-32" />
                      <Skeleton className="h-3.5 w-48" />
                    </div>
                  </div>
                ))}
              </div>
            ) : isError ? (
              <div className="p-8 text-center flex flex-col items-center gap-2 text-muted-foreground">
                <XCircle className="w-6 h-6 opacity-40" />
                <p className="text-sm">Failed to load logs</p>
                <button
                  onClick={loadInitial}
                  className="text-xs text-primary underline"
                >
                  Retry
                </button>
              </div>
            ) : shengdaEntries.length === 0 ? (
              <div className="p-8 text-center flex flex-col items-center gap-2 text-muted-foreground">
                <Info className="w-6 h-6 opacity-40" />
                <p className="text-sm">No Shengda packets found in the last 7 days</p>
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {shengdaEntries.map((entry, idx) => (
                  <LogRow
                    key={entry.id}
                    entry={entry}
                    prevMeterReading={shengdaEntries[idx + 1]?.shengda?.meterReading ?? null}
                    isNew={newIds.has(entry.id)}
                    onClick={() => openEntry(entry)}
                  />
                ))}
              </div>
            )}
          </Card>

          {!isLoading && shengdaEntries.length > 0 && (
            <p className="text-center text-[10px] text-muted-foreground/40 mt-2">
              Tap any row to view full packet details
            </p>
          )}
        </div>
      </div>

      {/* ── Log detail dialog ─────────────────────────────────────── */}
      <LogDetailDialog
        entry={selectedEntry}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        assetId={assetId}
      />
    </Layout>
  );
}
