import { useState, useEffect, useCallback, useMemo } from "react";
import { useRoute } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AssetLogs } from "@/components/asset-logs";
import { formatDateTime, formatTimeAgo } from "@/lib/date";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Radio,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from "lucide-react";

// ─── Constants ───────────────────────────────────────────────────────────────

const POLL_MS = 30_000;

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
  if (!state) return "";
  const s = state.toLowerCase();
  if (s.includes("low") || s.includes("critical") || s.includes("damage")) return "text-destructive";
  if (s.includes("good") || s.includes("normal") || s.includes("full")) return "text-emerald-600";
  return "text-amber-500";
}

function valveColor(status: string | null): string {
  if (!status) return "";
  const s = status.toLowerCase();
  if (s.includes("open")) return "text-emerald-600";
  if (s.includes("close") || s.includes("shut")) return "text-amber-500";
  return "";
}

function voltageColor(v: number | null): string {
  if (v === null) return "";
  if (v < 3.2) return "text-destructive";
  if (v < 3.5) return "text-amber-500";
  return "text-emerald-600";
}

function hasError(s: ShengdaDecoded): boolean {
  return (s.errorCode !== null && s.errorCode !== 0) || s.magneticAttack === true || !s.valid;
}

/** Extract a labelled field value from the decoded description text block. */
function parseDesc(desc: string | null, label: string): string | null {
  if (!desc) return null;
  const m = desc.match(new RegExp(`${label}\\s*:\\s*(.+?)(?:\\r?\\n|$)`, "i"));
  return m ? (m[1]?.trim() ?? null) : null;
}

// ─── InfoRow ─────────────────────────────────────────────────────────────────

function InfoRow({
  label,
  value,
  mono = false,
  valueClass,
  loading = false,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  valueClass?: string;
  loading?: boolean;
}) {
  // Hide row entirely when not loading and no value
  if (!loading && (value == null || value === "")) return null;
  return (
    <div className="flex justify-between items-center py-2.5 border-b border-border/40 last:border-0 gap-4 min-h-[36px]">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      {loading && value == null ? (
        <Skeleton className="h-3.5 w-28" />
      ) : (
        <span
          className={cn(
            "text-xs font-medium text-right break-all",
            mono && "font-mono text-[11px]",
            valueClass,
          )}
        >
          {value}
        </span>
      )}
    </div>
  );
}

// ─── SectionHeading ──────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
      {children}
    </p>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function HhmPage() {
  const [, params] = useRoute("/hhm/:id");
  const assetId = params?.id ?? "";

  const [allEntries, setAllEntries] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [countdown, setCountdown] = useState(POLL_MS / 1000);
  const [lastPoll, setLastPoll] = useState<Date | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  // Only Shengda entries, newest-first
  const shengdaEntries = useMemo(
    () => allEntries.filter((e) => !!e.shengda),
    [allEntries],
  );

  const latest = shengdaEntries[0] ?? null;
  const latestS = latest?.shengda ?? null;
  const desc = latestS?.description ?? null;

  // ── Daily consumption: diff between latest and oldest reading within 24h ──
  const dailyConsumption = useMemo(() => {
    if (!latestS?.meterReading) return null;
    const cutoff = Date.now() - 24 * 3600 * 1000;
    const in24h = shengdaEntries.filter(
      (e) => new Date(e.timestamp).getTime() > cutoff && e.shengda?.meterReading != null,
    );
    if (in24h.length < 2) return null;
    const oldest = in24h[in24h.length - 1]!.shengda!.meterReading!;
    const diff = latestS.meterReading - oldest;
    return diff >= 0 ? diff : null;
  }, [shengdaEntries, latestS]);

  // ── Initial load ─────────────────────────────────────────────────────────
  const loadInitial = useCallback(async () => {
    if (!assetId) return;
    setIsLoading(true);
    setIsError(false);
    try {
      const page = await fetchLogPage(assetId, new Date().toISOString(), 100);
      setAllEntries(page.entries);
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

  // ── Auto-poll every 30s for live status updates ──────────────────────────
  useEffect(() => {
    const poll = async () => {
      if (isPolling) return;
      setIsPolling(true);
      setCountdown(POLL_MS / 1000);
      try {
        const page = await fetchLogPage(assetId, new Date().toISOString(), 50);
        setAllEntries((prev) => {
          const prevIds = new Set(prev.map((e) => e.id));
          const fresh = page.entries.filter((e) => !prevIds.has(e.id));
          if (fresh.length === 0) return prev;
          const map = new Map<string, LogEntry>();
          for (const e of fresh) map.set(e.id, e);
          for (const e of prev) if (!map.has(e.id)) map.set(e.id, e);
          return Array.from(map.values()).sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
          );
        });
        setLastPoll(new Date());
      } catch {
        /* transient — retry next tick */
      } finally {
        setIsPolling(false);
      }
    };
    const interval = setInterval(poll, POLL_MS);
    return () => clearInterval(interval);
  }, [isPolling, assetId]);

  // ── Countdown ticker ─────────────────────────────────────────────────────
  useEffect(() => {
    const tick = setInterval(() => {
      setCountdown((s) => (s <= 1 ? POLL_MS / 1000 : s - 1));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  // ── Parsed description fields ─────────────────────────────────────────────
  // IMEI is stored directly as entry.source by the API
  const imei = latest?.source ?? parseDesc(desc, "IMEI");
  const rtc = parseDesc(desc, "Current Time");
  const fwVersion = parseDesc(desc, "Software Version");
  const hwVersion = parseDesc(desc, "Hardware Version");
  const model = parseDesc(desc, "Model");
  const serialNumber = parseDesc(desc, "Serial Number");
  const reportCycle = parseDesc(desc, "Report Cycle");
  const overdraftVol = parseDesc(desc, "Overdraft Volume");
  const paymentFunc = parseDesc(desc, "Payment Function");

  const alarmValue = latestS
    ? latestS.magneticAttack
      ? "Magnetic attack"
      : latestS.errorCode != null && latestS.errorCode !== 0
      ? `Error ${latestS.errorCode}`
      : "None"
    : null;

  const alarmClass =
    latestS?.magneticAttack || (latestS?.errorCode != null && latestS.errorCode !== 0)
      ? "text-destructive font-semibold"
      : "text-emerald-600";

  return (
    <Layout title="HHM Dashboard" showBack backTo={`/assets/${assetId}`}>
      <div className="space-y-4">

        {/* ── Asset banner ─────────────────────────────────────── */}
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
              <button
                onClick={loadInitial}
                disabled={isLoading}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors mt-0.5"
              >
                <RefreshCw className={cn("w-3 h-3", isLoading && "animate-spin")} />
                Refresh
              </button>
            </div>
          </div>

          {/* Alarm banner */}
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

          {/* Fetch error */}
          {isError && (
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-1.5">
              <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
              <p className="text-[11px] text-destructive font-medium">
                Failed to load status.{" "}
                <button onClick={loadInitial} className="underline">Retry</button>
              </p>
            </div>
          )}
        </div>

        {/* ── Diagnostics ──────────────────────────────────────── */}
        <div>
          <SectionHeading>Diagnostics</SectionHeading>
          <Card>
            <CardContent className="px-4 py-0">
              <InfoRow
                label="Supply Voltage"
                value={latestS?.supplyVoltage != null ? `${latestS.supplyVoltage.toFixed(2)} V` : null}
                valueClass={voltageColor(latestS?.supplyVoltage ?? null)}
                loading={isLoading}
              />
              <InfoRow
                label="Battery"
                value={latestS?.batteryState ?? null}
                valueClass={batteryColor(latestS?.batteryState ?? null)}
                loading={isLoading}
              />
              <InfoRow
                label="Error / Alarms"
                value={alarmValue}
                valueClass={alarmClass}
                loading={isLoading}
              />
              <InfoRow
                label="Signal (RSRP)"
                value={latestS?.signalPower ?? null}
                loading={isLoading}
              />
              <InfoRow
                label="Signal SNR"
                value={latestS?.signalSnr ?? null}
                loading={isLoading}
              />
              <InfoRow
                label="RTC (device time)"
                value={rtc}
                loading={isLoading}
              />
              <InfoRow
                label="FW Version"
                value={fwVersion}
                loading={isLoading}
              />
              <InfoRow
                label="HW Version"
                value={hwVersion}
                loading={isLoading}
              />
              <InfoRow
                label="Model"
                value={model}
                loading={isLoading}
              />
              <InfoRow
                label="Serial Number"
                value={serialNumber}
                mono
                loading={isLoading}
              />
              <InfoRow
                label="IMEI"
                value={imei}
                mono
                loading={isLoading}
              />
              <InfoRow
                label="Report Cycle"
                value={reportCycle}
                loading={isLoading}
              />
            </CardContent>
          </Card>
        </div>

        {/* ── Meter / Customer Detail ───────────────────────────── */}
        <div>
          <SectionHeading>Meter / Customer Detail</SectionHeading>
          <Card>
            <CardContent className="px-4 py-0">
              <InfoRow
                label="Meter Reading"
                value={latestS?.meterReading != null ? `${latestS.meterReading.toLocaleString()} L` : null}
                loading={isLoading}
              />
              <InfoRow
                label="Prepay Balance"
                value={latestS?.prepayLitres != null ? `${latestS.prepayLitres.toLocaleString()} L` : null}
                valueClass={
                  latestS?.prepayLitres != null && latestS.prepayLitres < 20
                    ? "text-destructive font-semibold"
                    : undefined
                }
                loading={isLoading}
              />
              <InfoRow
                label="Valve Status"
                value={latestS?.valveStatus ?? null}
                valueClass={valveColor(latestS?.valveStatus ?? null)}
                loading={isLoading}
              />
              <InfoRow
                label="Daily Consumption (24 h)"
                value={dailyConsumption != null ? `${dailyConsumption.toLocaleString()} L` : null}
              />
              <InfoRow
                label="Overdraft Volume"
                value={overdraftVol}
                loading={isLoading}
              />
              <InfoRow
                label="Payment Function"
                value={paymentFunc}
                loading={isLoading}
              />
              {latest && (
                <InfoRow
                  label="As of"
                  value={formatDateTime(latest.timestamp)}
                />
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Communication Log ─────────────────────────────────── */}
        <div>
          <SectionHeading>Communication Log</SectionHeading>
          <AssetLogs assetId={assetId} />
        </div>

      </div>
    </Layout>
  );
}
