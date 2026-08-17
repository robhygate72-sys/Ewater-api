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
  Gauge,
  Droplets,
  Power,
  TrendingUp,
  BatteryMedium,
  Zap,
  Signal,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Cpu,
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

function batteryColorClass(state: string | null) {
  if (!state) return { text: "text-muted-foreground", bg: "bg-muted/50" };
  const s = state.toLowerCase();
  if (s.includes("low") || s.includes("critical") || s.includes("damage"))
    return { text: "text-destructive", bg: "bg-destructive/10" };
  if (s.includes("good") || s.includes("normal") || s.includes("full"))
    return { text: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950/40" };
  return { text: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-950/40" };
}

function voltageColorClass(v: number | null) {
  if (v === null) return { text: "text-muted-foreground", bg: "bg-muted/50" };
  if (v < 3.2) return { text: "text-destructive", bg: "bg-destructive/10" };
  if (v < 3.5) return { text: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-950/40" };
  return { text: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950/40" };
}

function valveColorClass(status: string | null) {
  if (!status) return { text: "text-muted-foreground", bg: "bg-muted/30" };
  const s = status.toLowerCase();
  if (s.includes("open")) return { text: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950/40" };
  if (s.includes("close") || s.includes("shut")) return { text: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-950/40" };
  return { text: "text-muted-foreground", bg: "bg-muted/30" };
}

function hasError(s: ShengdaDecoded): boolean {
  return (s.errorCode !== null && s.errorCode !== 0) || s.magneticAttack === true || !s.valid;
}

function parseDesc(desc: string | null, label: string): string | null {
  if (!desc) return null;
  const m = desc.match(new RegExp(`${label}\\s*:\\s*(.+?)(?:\\r?\\n|$)`, "i"));
  return m ? (m[1]?.trim() ?? null) : null;
}

/** Format "21600 s" → "6 h" where possible, otherwise return raw */
function formatCycle(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d+)\s*s$/i);
  if (m) {
    const secs = parseInt(m[1]!, 10);
    if (secs % 3600 === 0) return `${secs / 3600} h`;
    if (secs % 60 === 0) return `${secs / 60} min`;
    return `${secs} s`;
  }
  return raw;
}

/** Strip the trailing "(rsrp)" / "(snr)" suffix for compact display */
function signalNum(raw: string | null): string | null {
  if (!raw) return null;
  return raw.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

// ─── BigStatCard ─────────────────────────────────────────────────────────────

function BigStatCard({
  icon: Icon,
  label,
  value,
  unit,
  sub,
  textClass,
  bgClass,
  loading = false,
  fullWidth = false,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number | null | undefined;
  unit?: string;
  sub?: string;
  textClass?: string;
  bgClass?: string;
  loading?: boolean;
  fullWidth?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl p-4 flex flex-col gap-1.5",
        bgClass ?? "bg-muted/40",
        fullWidth && "col-span-2",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <Icon className={cn("w-4 h-4 opacity-50", textClass ?? "text-muted-foreground")} />
      </div>
      {loading ? (
        <Skeleton className="h-8 w-24 mt-0.5" />
      ) : (
        <div className="flex items-baseline gap-1">
          <span className={cn("text-3xl font-bold tabular-nums leading-none", textClass)}>
            {value ?? "—"}
          </span>
          {unit && value != null && (
            <span className={cn("text-sm font-semibold", textClass, "opacity-70")}>{unit}</span>
          )}
        </div>
      )}
      {sub && <span className="text-[10px] text-muted-foreground leading-tight">{sub}</span>}
    </div>
  );
}

// ─── HealthPill ───────────────────────────────────────────────────────────────

function HealthPill({
  icon: Icon,
  label,
  value,
  textClass,
  bgClass,
  loading = false,
}: {
  icon: React.ElementType;
  label: string;
  value: string | null;
  textClass?: string;
  bgClass?: string;
  loading?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex-1 rounded-xl border border-border/50 px-2 py-2.5 flex flex-col items-center gap-1.5 min-w-0",
        bgClass ?? "bg-card",
      )}
    >
      <Icon className={cn("w-4 h-4 shrink-0", textClass ?? "text-muted-foreground")} />
      {loading ? (
        <Skeleton className="h-3 w-10" />
      ) : (
        <span className={cn("text-[11px] font-bold tabular-nums text-center leading-tight", textClass)}>
          {value ?? "—"}
        </span>
      )}
      <span className="text-[9px] text-muted-foreground text-center leading-tight uppercase tracking-wide">
        {label}
      </span>
    </div>
  );
}

// ─── DeviceInfoRow ────────────────────────────────────────────────────────────

function DeviceInfoRow({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex justify-between items-center py-2 border-b border-border/30 last:border-0 gap-3">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className={cn("text-xs font-medium text-right break-all", mono && "font-mono text-[11px]")}>
        {value}
      </span>
    </div>
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
  const [deviceExpanded, setDeviceExpanded] = useState(false);

  const shengdaEntries = useMemo(
    () => allEntries.filter((e) => !!e.shengda),
    [allEntries],
  );

  const latest = shengdaEntries[0] ?? null;
  const latestS = latest?.shengda ?? null;
  const desc = latestS?.description ?? null;

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

  useEffect(() => { void loadInitial(); }, [loadInitial]);

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
      } catch { /* transient */ } finally {
        setIsPolling(false);
      }
    };
    const interval = setInterval(poll, POLL_MS);
    return () => clearInterval(interval);
  }, [isPolling, assetId]);

  useEffect(() => {
    const tick = setInterval(() => setCountdown((s) => (s <= 1 ? POLL_MS / 1000 : s - 1)), 1000);
    return () => clearInterval(tick);
  }, []);

  // ── Derived values ─────────────────────────────────────────────────────────
  const imei = latest?.source ?? parseDesc(desc, "IMEI");
  const rtc = parseDesc(desc, "Current Time");
  const fwVersion = parseDesc(desc, "Software Version");
  const hwVersion = parseDesc(desc, "Hardware Version");
  const model = parseDesc(desc, "Model");
  const serialNumber = parseDesc(desc, "Serial Number");
  const reportCycle = formatCycle(parseDesc(desc, "Report Cycle"));
  const overdraftVol = parseDesc(desc, "Overdraft Volume");
  const paymentFunc = parseDesc(desc, "Payment Function");

  const batteryC = batteryColorClass(latestS?.batteryState ?? null);
  const voltageC = voltageColorClass(latestS?.supplyVoltage ?? null);
  const valveC = valveColorClass(latestS?.valveStatus ?? null);

  const hasAlarm = latestS ? hasError(latestS) : false;
  const alarmText = latestS
    ? latestS.magneticAttack ? "Attack!" : !latestS.valid ? "Bad CRC" : `Err ${latestS.errorCode}`
    : null;

  const prepayLow = latestS?.prepayLitres != null && latestS.prepayLitres < 20;

  const rsrp = signalNum(latestS?.signalPower ?? null);
  const snr = signalNum(latestS?.signalSnr ?? null);

  return (
    <Layout title="HHM Dashboard" showBack backTo={`/assets/${assetId}`}>
      <div className="space-y-5">

        {/* ── Compact banner ───────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldAlert className="w-4 h-4 text-primary shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">Asset {assetId}</p>
              <p className="text-[10px] text-muted-foreground">Shengda NB-IoT</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {lastPoll && (
              <span className="text-[10px] text-muted-foreground hidden sm:block">
                {formatTimeAgo(lastPoll.toISOString())}
              </span>
            )}
            <div className="flex items-center gap-1 text-[10px] text-emerald-600">
              <Radio className="w-3 h-3 animate-pulse" />
              <span className="font-mono tabular-nums">{countdown}s</span>
            </div>
            <button
              onClick={loadInitial}
              disabled={isLoading}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors"
              title="Refresh"
            >
              <RefreshCw className={cn("w-3.5 h-3.5 text-muted-foreground", isLoading && "animate-spin")} />
            </button>
          </div>
        </div>

        {/* Error states */}
        {isError && (
          <div className="flex items-center gap-2 rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3">
            <XCircle className="w-4 h-4 text-destructive shrink-0" />
            <p className="text-sm text-destructive font-medium flex-1">Failed to load</p>
            <button onClick={loadInitial} className="text-xs text-destructive underline">Retry</button>
          </div>
        )}
        {!isLoading && hasAlarm && (
          <div className="flex items-center gap-2 rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 animate-pulse" />
            <p className="text-sm text-destructive font-medium">
              {latestS?.magneticAttack
                ? "Magnetic attack detected"
                : !latestS?.valid
                ? "Latest packet has invalid CRC"
                : `Device error code ${latestS?.errorCode}`}
            </p>
          </div>
        )}

        {/* ── Meter info: 2×2 big stat grid ────────────────────────── */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2.5 px-0.5">
            Meter Information
          </p>
          <div className="grid grid-cols-2 gap-3">
            <BigStatCard
              icon={Gauge}
              label="Meter Reading"
              value={latestS?.meterReading?.toLocaleString() ?? null}
              unit="L"
              sub={latest ? `as of ${formatTimeAgo(latest.timestamp)}` : undefined}
              textClass="text-primary"
              bgClass="bg-primary/8 dark:bg-primary/15"
              loading={isLoading}
            />
            <BigStatCard
              icon={Droplets}
              label="Prepay Balance"
              value={latestS?.prepayLitres?.toLocaleString() ?? null}
              unit="L"
              sub={prepayLow ? "⚠ Low — top up soon" : undefined}
              textClass={prepayLow ? "text-destructive" : "text-sky-600 dark:text-sky-400"}
              bgClass={prepayLow ? "bg-destructive/10" : "bg-sky-50 dark:bg-sky-950/40"}
              loading={isLoading}
            />
            <BigStatCard
              icon={Power}
              label="Valve"
              value={latestS?.valveStatus ?? null}
              textClass={valveC.text}
              bgClass={valveC.bg}
              loading={isLoading}
            />
            <BigStatCard
              icon={TrendingUp}
              label="24 h Usage"
              value={dailyConsumption?.toLocaleString() ?? null}
              unit={dailyConsumption != null ? "L" : undefined}
              sub={dailyConsumption == null ? "Not enough data" : undefined}
              textClass="text-indigo-600 dark:text-indigo-400"
              bgClass="bg-indigo-50 dark:bg-indigo-950/40"
              loading={isLoading}
            />
          </div>
        </div>

        {/* ── Device health pills ───────────────────────────────────── */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2.5 px-0.5">
            Device Health
          </p>
          <div className="flex gap-2">
            <HealthPill
              icon={BatteryMedium}
              label="Battery"
              value={latestS?.batteryState ?? null}
              textClass={batteryC.text}
              bgClass={batteryC.bg}
              loading={isLoading}
            />
            <HealthPill
              icon={Zap}
              label="Voltage"
              value={latestS?.supplyVoltage != null ? `${latestS.supplyVoltage.toFixed(2)}V` : null}
              textClass={voltageC.text}
              bgClass={voltageC.bg}
              loading={isLoading}
            />
            <HealthPill
              icon={Signal}
              label="RSRP"
              value={rsrp}
              textClass="text-foreground"
              loading={isLoading}
            />
            <HealthPill
              icon={hasAlarm ? AlertTriangle : ShieldCheck}
              label="Alarms"
              value={hasAlarm ? (alarmText ?? "Alarm") : (latestS ? "OK" : null)}
              textClass={hasAlarm ? "text-destructive" : "text-emerald-600"}
              bgClass={hasAlarm ? "bg-destructive/10" : undefined}
              loading={isLoading}
            />
          </div>
          {/* SNR sub-line */}
          {snr && !isLoading && (
            <p className="text-[10px] text-muted-foreground mt-1.5 px-0.5">
              Signal SNR: {snr}
            </p>
          )}
        </div>

        {/* ── Usage / Meter detail ─────────────────────────────────── */}
        {(overdraftVol != null || paymentFunc != null || latest) && !isLoading && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2.5 px-0.5">
              Usage Detail
            </p>
            <Card className="shadow-sm">
              <CardContent className="px-4 py-1">
                {overdraftVol != null && (
                  <DeviceInfoRow label="Overdraft Volume" value={`${overdraftVol} L`} />
                )}
                {paymentFunc != null && (
                  <DeviceInfoRow label="Payment Function" value={paymentFunc} />
                )}
                {latest && (
                  <DeviceInfoRow label="Last packet" value={formatDateTime(latest.timestamp)} />
                )}
                {reportCycle && (
                  <DeviceInfoRow label="Report Cycle" value={reportCycle} />
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Device info (collapsible) ─────────────────────────────── */}
        {(model ?? fwVersion ?? imei) && !isLoading && (
          <div>
            <button
              onClick={() => setDeviceExpanded((v) => !v)}
              className="flex items-center justify-between w-full px-0.5 mb-2.5 group"
            >
              <div className="flex items-center gap-2">
                <Cpu className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground group-hover:text-foreground transition-colors">
                  Device Info
                </p>
              </div>
              {deviceExpanded
                ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
            </button>
            {deviceExpanded && (
              <Card className="shadow-sm">
                <CardContent className="px-4 py-1">
                  <DeviceInfoRow label="Model" value={model} />
                  <DeviceInfoRow label="FW Version" value={fwVersion} mono />
                  <DeviceInfoRow label="HW Version" value={hwVersion} />
                  <DeviceInfoRow label="Serial Number" value={serialNumber} mono />
                  <DeviceInfoRow label="IMEI" value={imei} mono />
                  <DeviceInfoRow label="RTC (device time)" value={rtc} mono />
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ── Communication Log ─────────────────────────────────────── */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2.5 px-0.5">
            Communication Log
          </p>
          <AssetLogs assetId={assetId} />
        </div>

      </div>
    </Layout>
  );
}
