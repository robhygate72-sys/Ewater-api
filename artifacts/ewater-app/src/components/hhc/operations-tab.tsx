import { useMemo, useState } from "react";
import {
  useGetHouseholdMeterState,
  getGetHouseholdMeterStateQueryKey,
  useListHouseholdMeters,
  getListHouseholdMetersQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Gauge, Droplets, TrendingUp, Radio, BatteryMedium, Zap, Signal, Power,
  AlertTriangle, RefreshCw, Search, Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime, formatTimeAgo } from "@/lib/date";
import { UsageCharts } from "./usage-charts";
import { CommsLog } from "./comms-log";
import {
  obs, obsNum, obsStr, fmtSeconds, connectivityColor, healthColor,
  StatusBadge, InfoRow, SectionCard, ObservedValue,
} from "./shared";
import {
  useGetHouseholdMeterHistory,
  getGetHouseholdMeterHistoryQueryKey,
} from "@workspace/api-client-react";
import { AlarmsPanel, MaintenancePanel, AuditPanel } from "./om-maintenance";
import { OperatorBar } from "./commissioning-tab";

const STATE_POLL_MS = 30_000;

// ── Meter picker (shown when no assetId selected) ───────────────────────────

function MeterPicker({ onSelect }: { onSelect: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const params = { ...(search.trim() ? { search: search.trim() } : {}), limit: 20, offset: 0 };
  const query = useListHouseholdMeters(params, {
    query: { queryKey: getListHouseholdMetersQueryKey(params) },
  });
  const meters = query.data?.items ?? [];

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Select a HouseholdMeter to inspect.</p>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          data-testid="input-om-meter-search"
          placeholder="Search meters…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-9 text-sm"
        />
      </div>
      {query.isLoading ? (
        Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)
      ) : meters.length === 0 ? (
        <div className="text-center p-8 bg-card border border-dashed rounded-xl space-y-3">
          <p className="text-sm text-muted-foreground">No HouseholdMeter assets returned by eWater</p>
          <Button size="sm" variant="outline" data-testid="button-om-picker-refresh" onClick={() => void query.refetch()}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
          </Button>
        </div>
      ) : (
        meters.map((m) => (
          <button
            key={m.id}
            data-testid={`button-om-pick-${m.id}`}
            onClick={() => onSelect(m.id)}
            className="w-full text-left rounded-xl border border-border bg-card px-4 py-3 hover:bg-muted/40 transition-colors"
          >
            <p className="text-sm font-semibold">{m.name}</p>
            <p className="text-[11px] text-muted-foreground">
              #{m.id}{m.waterSystemName ? ` · ${m.waterSystemName}` : ""}{m.countryName ? ` · ${m.countryName}` : ""}
            </p>
          </button>
        ))
      )}
    </div>
  );
}

// ── Primary stat card ───────────────────────────────────────────────────────

function Stat({ icon: Icon, label, value, unit, sub, loading, className, testId }: {
  icon: React.ElementType;
  label: string;
  value: string | null;
  unit?: string;
  sub?: string | null;
  loading?: boolean;
  className?: string;
  testId?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</span>
        <Icon className={cn("w-3.5 h-3.5 opacity-60", className ?? "text-muted-foreground")} />
      </div>
      {loading ? (
        <Skeleton className="h-6 w-16 mt-1" />
      ) : value == null ? (
        <p className="text-xs text-muted-foreground italic mt-1.5" data-testid={testId}>Not reported</p>
      ) : (
        <p className={cn("text-lg font-bold tabular-nums leading-tight mt-0.5", className)} data-testid={testId}>
          {value}{unit && <span className="text-xs font-semibold opacity-70 ml-0.5">{unit}</span>}
        </p>
      )}
      {sub && <p className="text-[9px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Disabled control button ─────────────────────────────────────────────────

function DisabledControl({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
        <Lock className="w-3 h-3" /> Not yet available — write API not verified
      </span>
    </div>
  );
}

// ── Main tab ────────────────────────────────────────────────────────────────

export function OperationsTab({ assetId, onSelectMeter }: {
  assetId: string | null;
  onSelectMeter: (id: string) => void;
}) {
  if (!assetId) return <MeterPicker onSelect={onSelectMeter} />;
  return <MeterDetail key={assetId} assetId={assetId} />;
}

function MeterDetail({ assetId }: { assetId: string }) {
  const stateQuery = useGetHouseholdMeterState(assetId, {
    query: {
      queryKey: getGetHouseholdMeterStateQueryKey(assetId),
      refetchInterval: STATE_POLL_MS,
    },
  });

  // 24h usage from the history endpoint (real derived data, not an estimate).
  const histParams = { period: "24h" as const };
  const histQuery = useGetHouseholdMeterHistory(assetId, histParams, {
    query: { queryKey: getGetHouseholdMeterHistoryQueryKey(assetId, histParams), staleTime: 5 * 60_000 },
  });

  const d = stateQuery.data;
  const st = d?.state;
  const meter = d?.meter ?? null;
  const conn = d?.connectivity;
  const health = d?.health;
  const loading = stateQuery.isLoading;

  const reading = useMemo(() => obs(st?.meter, "meterReadingLitres"), [st]);
  const prepaid = useMemo(() => obs(st?.meter, "availableWaterAllowanceLitres"), [st]);
  const voltage = obsNum(st?.meter, "batteryVoltage") ?? obsNum(st?.device, "powerSupplyVoltage");
  const batteryStatus = obsStr(st?.device, "batteryStatus");
  const batteryPct = obsNum(st?.device, "batteryLevelPercent");
  const rsrp = obsNum(st?.network, "rsrp");
  const snr = obsNum(st?.network, "snr");
  const valveStatus = obsStr(st?.valve, "status");
  const usage24h = histQuery.data?.totalConsumptionLitres ?? null;

  if (stateQuery.isError) {
    return (
      <div className="text-center p-10 bg-card border border-dashed rounded-xl space-y-3">
        <p className="text-sm text-destructive font-medium">Failed to load meter state from eWater</p>
        <Button size="sm" variant="outline" data-testid="button-om-retry" onClick={() => void stateQuery.refetch()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="rounded-xl border border-border bg-card p-4">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <h2 className="text-base font-bold truncate" data-testid="text-om-meter-name">
                  {meter?.name ?? `Asset ${assetId}`}
                </h2>
                <p className="text-[11px] text-muted-foreground">
                  #{assetId}
                  {meter?.status ? ` · ${meter.status}` : ""}
                  {meter?.waterSystemName ? ` · ${meter.waterSystemName}` : ""}
                  {meter?.countryName ? ` · ${meter.countryName}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {conn && <StatusBadge label={conn.status} className={connectivityColor(conn.status)} testId="status-om-connectivity" />}
                <button
                  data-testid="button-om-refresh"
                  onClick={() => void stateQuery.refetch()}
                  className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                  title="Refresh state"
                >
                  <RefreshCw className={cn("w-3.5 h-3.5 text-muted-foreground", stateQuery.isFetching && "animate-spin")} />
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-2 flex-wrap text-[10px] text-muted-foreground">
              <span className="font-mono">Serial: {obsStr(st?.device, "serialNumber") ?? obsStr(st?.meter, "waterMeterNo") ?? "Not reported"}</span>
              <span className="font-mono">IMEI: {obsStr(st?.network, "imei") ?? "Not reported"}</span>
              <span className="font-mono">ICCID: {obsStr(st?.network, "iccid") ?? "Not reported"}</span>
            </div>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Radio className="w-3 h-3" />
                Last valid comm:{" "}
                {conn?.lastValidPacketAt
                  ? <span title={formatDateTime(conn.lastValidPacketAt)}>{formatTimeAgo(conn.lastValidPacketAt)} (device)</span>
                  : "never"}
              </span>
              {d?.fetchedAt && <span>API fetched {formatTimeAgo(d.fetchedAt)} · polls every {STATE_POLL_MS / 1000}s</span>}
            </div>
            {conn?.reason && <p className="text-[10px] text-muted-foreground mt-1 italic">{conn.reason}</p>}
          </>
        )}
      </div>

      {/* ── Primary stat row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat
          icon={Droplets} label="Prepaid allowance" loading={loading}
          value={typeof prepaid?.value === "number" ? prepaid.value.toLocaleString() : null} unit="L"
          sub={prepaid ? `Observed ${formatTimeAgo(prepaid.observedAt)}` : null}
          className="text-sky-600 dark:text-sky-400" testId="stat-om-prepaid"
        />
        <Stat
          icon={TrendingUp} label="24 h usage" loading={loading || histQuery.isLoading}
          value={usage24h != null ? usage24h.toLocaleString() : null} unit="L"
          sub={usage24h == null && !histQuery.isLoading ? "Not derivable from readings" : null}
          className="text-indigo-600 dark:text-indigo-400" testId="stat-om-usage24h"
        />
        <Stat
          icon={Gauge} label="Cumulative reading" loading={loading}
          value={typeof reading?.value === "number" ? reading.value.toLocaleString() : null} unit="L"
          sub={reading ? `Observed ${formatTimeAgo(reading.observedAt)}` : null}
          className="text-primary" testId="stat-om-reading"
        />
        <Stat
          icon={Radio} label="Last comm" loading={loading}
          value={conn?.lastValidPacketAt ? formatTimeAgo(conn.lastValidPacketAt) : null}
          sub={conn?.reportCycleSeconds != null ? `Expected every ${fmtSeconds(conn.reportCycleSeconds)}` : "No report cycle established"}
          testId="stat-om-lastcomm"
        />
      </div>

      {/* ── Device health ── */}
      <SectionCard title="Device health">
        <div className="grid grid-cols-5 gap-2 mb-3">
          <HealthPill icon={BatteryMedium} label="Battery" loading={loading}
            value={batteryStatus ?? (batteryPct != null ? `${batteryPct}%` : null)} />
          <HealthPill icon={Zap} label="Voltage" loading={loading}
            value={voltage != null ? `${voltage.toFixed(2)} V` : null}
            className={voltage != null && voltage > 0 && voltage < 3.2 ? "text-destructive" : undefined} />
          <HealthPill icon={Signal} label="Signal" loading={loading}
            value={rsrp != null ? `${rsrp} dBm${snr != null ? ` / ${snr}` : ""}` : null} />
          <HealthPill icon={Power} label="Valve" loading={loading} value={valveStatus} />
          <HealthPill icon={AlertTriangle} label="Health" loading={loading}
            value={health?.status ?? null}
            className={health ? healthColor(health.status).split(" ")[0] : undefined} />
        </div>
        {health && health.reasons.length > 0 && (
          <ul className="space-y-1" data-testid="list-om-health-reasons">
            {health.reasons.map((r, i) => (
              <li key={`${r.code}-${i}`} className="flex items-start gap-1.5 text-[11px]">
                <span className={cn(
                  "mt-1 w-1.5 h-1.5 rounded-full shrink-0",
                  r.severity === "critical" ? "bg-destructive" : r.severity === "warning" ? "bg-amber-500" : "bg-emerald-500",
                )} />
                <span className="flex-1">{r.message}</span>
                {r.observedAt && <span className="text-[9px] text-muted-foreground shrink-0">Observed {formatTimeAgo(r.observedAt)}</span>}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* ── Identity / Network / Commercial ── */}
      <div className="grid sm:grid-cols-2 gap-4">
        <SectionCard title="Meter identity">
          <InfoRow label="Manufacturer" field={obs(st?.device, "manufacturer")} />
          <InfoRow label="Model" field={obs(st?.device, "model")} />
          <InfoRow label="Serial number" field={obs(st?.device, "serialNumber")} mono />
          <InfoRow label="Water meter no." field={obs(st?.meter, "waterMeterNo")} mono />
          <InfoRow label="Firmware" field={obs(st?.device, "firmwareVersion")} mono />
          <InfoRow label="Hardware" field={obs(st?.device, "hardwareVersion")} mono />
          <InfoRow label="Software" field={obs(st?.device, "softwareVersion")} mono />
          <InfoRow label="Device RTC time" field={obs(st?.device, "rtcTime")} mono />
          <InfoRow label="Meter DN size" field={obs(st?.meter, "meterDnSize")} />
        </SectionCard>
        <SectionCard title="Network">
          <InfoRow label="IMEI" field={obs(st?.network, "imei")} mono />
          <InfoRow label="IMSI" field={obs(st?.network, "imsi")} mono />
          <InfoRow label="ICCID" field={obs(st?.network, "iccid")} mono />
          <InfoRow label="NB module" field={obs(st?.network, "nbModuleVersion")} mono />
          <InfoRow label="APN" field={obs(st?.network, "apn")} mono />
          <InfoRow label="Cell ID" field={obs(st?.network, "cellId")} mono />
          <InfoRow label="RSRP" field={obs(st?.network, "rsrp")} unit="dBm" />
          <InfoRow label="SNR" field={obs(st?.network, "snr")} unit="dB" />
          <InfoRow label="RSSI" field={obs(st?.network, "rssi")} unit="dBm" />
          <InfoRow label="ECL" field={obs(st?.network, "ecl")} />
          <InfoRow label="Report cycle" field={obs(st?.reporting, "reportCycleSeconds")} unit="s" />
        </SectionCard>
        <SectionCard title="Commercial">
          <InfoRow label="Payment function" field={obs(st?.meter, "paymentFunctionEnabled")} />
          <InfoRow label="Prepaid allowance" field={obs(st?.meter, "availableWaterAllowanceLitres")} unit="L" />
          <InfoRow label="Low-allowance alarm at" field={obs(st?.meter, "availableWaterAllowanceAlarmLitres")} unit="L" />
          <InfoRow label="Overdraft volume" field={obs(st?.meter, "overdraftVolumeLitres")} unit="L" />
          <InfoRow label="Cumulative reading" field={obs(st?.meter, "meterReadingLitres")} unit="L" />
          <InfoRow label="Forward flow" field={obs(st?.meter, "forwardFlowLitres")} unit="L" />
          <InfoRow label="Reverse flow" field={obs(st?.meter, "reverseFlowLitres")} unit="L" />
        </SectionCard>
        <SectionCard title="Control (read-only)">
          <p className="text-[10px] text-muted-foreground mb-2">
            This phase is read-only. Current valve state:{" "}
            <ObservedValue field={obs(st?.valve, "status")} />
          </p>
          <div className="space-y-1.5">
            <DisabledControl label="Open valve" />
            <DisabledControl label="Close valve" />
            <DisabledControl label="Top up prepaid allowance" />
            <DisabledControl label="Change report cycle" />
          </div>
        </SectionCard>
      </div>

      {/* ── Alarms (Pulse faults + Shengda health) ── */}
      <AlarmsPanel assetId={assetId} />

      {/* ── Activity ── */}
      <OperatorBar />
      <MaintenancePanel assetId={assetId} />
      <AuditPanel assetId={assetId} />
      <UsageCharts assetId={assetId} />
      <CommsLog assetId={assetId} />
    </div>
  );
}

function HealthPill({ icon: Icon, label, value, loading, className }: {
  icon: React.ElementType;
  label: string;
  value: string | null;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-card px-1.5 py-2 flex flex-col items-center gap-1 min-w-0">
      <Icon className={cn("w-3.5 h-3.5", className ?? "text-muted-foreground")} />
      {loading ? (
        <Skeleton className="h-3 w-8" />
      ) : (
        <span className={cn("text-[10px] font-bold text-center leading-tight break-words", className)}>
          {value ?? <span className="text-muted-foreground/60 italic font-normal">Not reported</span>}
        </span>
      )}
      <span className="text-[8px] text-muted-foreground uppercase tracking-wide">{label}</span>
    </div>
  );
}
