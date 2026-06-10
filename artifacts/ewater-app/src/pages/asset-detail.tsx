import { Layout } from "@/components/layout";
import { useGetAssetTech, getGetAssetTechQueryKey, useFetchAssetTelemetry, getFetchAssetTelemetryQueryKey } from "@workspace/api-client-react";
import { useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatTimeAgo } from "@/lib/date";
import {
  MapPin, Battery, Signal, Wifi, WifiOff, ShieldAlert, ShieldCheck,
  TrendingDown, TrendingUp, Minus, Droplet, Zap, Cpu, Radio,
  Terminal, AlertTriangle, CheckCircle2, Clock, Activity, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

function Row({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-border/40 last:border-0 gap-4">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className={cn("text-xs text-right", mono && "font-mono")}>{value ?? <span className="text-muted-foreground/50">—</span>}</span>
    </div>
  );
}

function SectionCard({ title, icon, children, className }: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("shadow-sm border", className)}>
      <CardHeader className="py-3 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 py-1">{children}</CardContent>
    </Card>
  );
}

function TrendIcon({ trend }: { trend: string | null | undefined }) {
  if (!trend) return null;
  const t = trend.toLowerCase();
  if (t.includes("fall") || t.includes("declin")) return <TrendingDown className="w-3.5 h-3.5 text-amber-500" />;
  if (t.includes("ris") || t.includes("charg")) return <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />;
  return <Minus className="w-3.5 h-3.5 text-muted-foreground" />;
}

function hasFlag(flags: string | null | undefined, keyword: string) {
  if (!flags) return false;
  return flags.toLowerCase().split(",").some((f) => f.trim().toLowerCase().includes(keyword.toLowerCase()));
}

export default function AssetDetail() {
  const [, params] = useRoute("/assets/:id");
  const id = params?.id ?? "";

  const { data: tech, isLoading: isLoadingTech } = useGetAssetTech(id, {
    query: { enabled: !!id, queryKey: getGetAssetTechQueryKey(id) },
  });

  const { data: telemetry, isLoading: isLoadingTelemetry } = useFetchAssetTelemetry(id, {
    query: {
      enabled: !!id,
      queryKey: getFetchAssetTelemetryQueryKey(id),
    },
  });

  if (isLoadingTech) {
    return (
      <Layout title="Asset Detail" showBack backTo="/assets">
        <div className="space-y-4">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      </Layout>
    );
  }

  if (!tech) {
    return (
      <Layout title="Asset Not Found" showBack backTo="/assets">
        <div className="text-center p-8 bg-card border border-dashed rounded-xl">
          <AlertTriangle className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-50" />
          <p className="text-sm text-muted-foreground">Asset could not be loaded</p>
        </div>
      </Layout>
    );
  }

  const isOnline = tech.lastCommsDt
    ? Date.now() - new Date(tech.lastCommsDt).getTime() < 48 * 3600 * 1000
    : false;

  const tamper = hasFlag(tech.healthFlags, "tamper") || (tech.tamperSwitchState != null && tech.tamperSwitchState !== "None" && tech.tamperSwitchState !== "");
  const lowBattery = hasFlag(tech.healthFlags, "lowbattery") || hasFlag(tech.healthFlags, "low battery");
  const hasAlerts = tamper || lowBattery || (tech.healthFlags && tech.healthFlags.toLowerCase() !== "none" && tech.healthFlags !== "");

  return (
    <Layout title={tech.name} showBack backTo="/assets">
      <div className="space-y-3">

        {/* Header card */}
        <Card className="border-none shadow-md overflow-hidden relative">
          <div className={cn(
            "absolute top-0 left-0 w-full h-1",
            tamper || lowBattery ? "bg-amber-500" : isOnline ? "bg-emerald-500" : "bg-zinc-400",
          )} />
          <CardContent className="p-4 pt-5">
            <div className="flex justify-between items-start mb-3 gap-2">
              <div className="min-w-0">
                <h2 className="text-lg font-bold tracking-tight truncate">{tech.name}</h2>
                <div className="flex items-center text-xs text-muted-foreground mt-0.5 gap-1.5 flex-wrap">
                  {tech.waterSystemName && (
                    <>
                      <Droplet className="w-3 h-3" />
                      <span>{tech.waterSystemName}</span>
                    </>
                  )}
                  {tech.countryName && (
                    <>
                      <span className="opacity-40">·</span>
                      <MapPin className="w-3 h-3" />
                      <span>{tech.countryName}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <Badge
                  variant={isOnline ? "default" : "secondary"}
                  className={cn(
                    "text-xs px-2 py-0.5 font-medium uppercase tracking-wider shadow-none",
                    isOnline ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-0" : "",
                  )}
                >
                  {isOnline ? "Online" : "Offline"}
                </Badge>
                {tech.lifecycleState && (
                  <span className="text-[10px] text-muted-foreground">{tech.lifecycleState}</span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs bg-muted/40 p-3 rounded-lg">
              <div>
                <span className="text-muted-foreground block mb-0.5">Last comms</span>
                <span className="font-mono text-[11px]">{tech.lastCommsDt ? formatDateTime(tech.lastCommsDt) : "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-0.5">Network</span>
                <span className="font-medium capitalize">{tech.lastNetwork ?? "—"}</span>
              </div>
              {tech.purpose && (
                <div>
                  <span className="text-muted-foreground block mb-0.5">Type</span>
                  <span className="font-medium">{tech.purpose}</span>
                </div>
              )}
              {tech.imei && (
                <div>
                  <span className="text-muted-foreground block mb-0.5">IMEI</span>
                  <span className="font-mono text-[11px]">{tech.imei}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Alerts */}
        {hasAlerts && (
          <div className="space-y-2">
            {tamper && (
              <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-3">
                <ShieldAlert className="w-5 h-5 text-red-500 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-red-600 dark:text-red-400">Tamper Detected</p>
                  {tech.tamperSwitchState && (
                    <p className="text-xs text-red-500/80 font-mono mt-0.5">{tech.tamperSwitchState}</p>
                  )}
                </div>
              </div>
            )}
            {lowBattery && (
              <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/25 rounded-xl px-4 py-3">
                <Battery className="w-5 h-5 text-amber-500 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">Low Battery</p>
                  {tech.batteryVoltage != null && (
                    <p className="text-xs text-amber-500/80 font-mono mt-0.5">{tech.batteryVoltage}V</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Connectivity */}
        <SectionCard title="Connectivity" icon={<Wifi className="w-3.5 h-3.5" />}>
          <Row label="Last comms" value={tech.lastCommsDt ? formatTimeAgo(tech.lastCommsDt) : null} />
          <Row label="Last comms (exact)" value={tech.lastCommsDt ? formatDateTime(tech.lastCommsDt) : null} mono />
          <Row label="Network" value={tech.lastNetwork ?? null} />
          <Row label="Tap events/min (today)" value={tech.tapEventsPerMinuteToday?.toFixed(4) ?? null} mono />
          <Row label="Tap events/min (week)" value={tech.tapEventsPerMinuteThisWeek?.toFixed(4) ?? null} mono />
        </SectionCard>

        {/* Battery */}
        <SectionCard title="Battery" icon={<Battery className="w-3.5 h-3.5" />}>
          <div className="py-3 flex items-center justify-between">
            <div>
              <span className="text-3xl font-bold font-mono">
                {tech.batteryVoltage != null ? `${tech.batteryVoltage}V` : "—"}
              </span>
              {tech.batteryTrend && (
                <span className="ml-2 text-xs text-muted-foreground">{tech.batteryTrend}</span>
              )}
            </div>
            {tech.batteryTrend && <TrendIcon trend={tech.batteryTrend} />}
          </div>
          {(tech.batteryTodayHigh != null || tech.batteryTodayLow != null) && (
            <div className="flex gap-4 mb-2 bg-muted/40 rounded-lg px-3 py-2">
              <div>
                <span className="text-[10px] text-muted-foreground block">Today high</span>
                <span className="text-xs font-mono font-medium text-emerald-600 dark:text-emerald-400">
                  {tech.batteryTodayHigh != null ? `${tech.batteryTodayHigh}V` : "—"}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground block">Today low</span>
                <span className="text-xs font-mono font-medium text-amber-600 dark:text-amber-400">
                  {tech.batteryTodayLow != null ? `${tech.batteryTodayLow}V` : "—"}
                </span>
              </div>
              {tech.lowBatteryEventCount != null && (
                <div>
                  <span className="text-[10px] text-muted-foreground block">Low events</span>
                  <span className="text-xs font-mono font-medium">{tech.lowBatteryEventCount}</span>
                </div>
              )}
            </div>
          )}
        </SectionCard>

        {/* Usage */}
        <SectionCard title="Water Usage" icon={<Droplet className="w-3.5 h-3.5" />}>
          {tech.litresDispensedToday != null && (
            <div className="py-3">
              <span className="text-3xl font-bold font-mono">{tech.litresDispensedToday.toFixed(1)}</span>
              <span className="ml-1.5 text-sm text-muted-foreground">litres today</span>
            </div>
          )}
          <Row label="Last usage" value={tech.lastUsageDt ? formatDateTime(tech.lastUsageDt) : null} mono />
          <Row label="Flow rate (this hour)" value={tech.flowRateHour != null ? `${tech.flowRateHour.toFixed(2)} L/min` : null} mono />
          <Row label="Flow rate (today avg)" value={tech.flowRateToday != null ? `${tech.flowRateToday.toFixed(2)} L/min` : null} mono />
          <Row label="Flow rate (week avg)" value={tech.flowRateWeek != null ? `${tech.flowRateWeek.toFixed(2)} L/min` : null} mono />
        </SectionCard>

        {/* Firmware */}
        {tech.firmware && tech.firmware.length > 0 && (
          <SectionCard title="Firmware" icon={<Cpu className="w-3.5 h-3.5" />}>
            {tech.firmware.map((fw, i) => (
              <div key={i} className="py-2 border-b border-border/40 last:border-0">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-medium">{fw.deviceType}</span>
                  <span className="text-xs font-mono text-muted-foreground">{fw.version ?? "—"}</span>
                </div>
                <div className="flex justify-between items-center mt-0.5">
                  {fw.phase && (
                    <span className="text-[10px] text-muted-foreground">{fw.phase}</span>
                  )}
                  {fw.lastKnownDate && (
                    <span className="text-[10px] text-muted-foreground font-mono">{formatDateTime(fw.lastKnownDate)}</span>
                  )}
                </div>
              </div>
            ))}
          </SectionCard>
        )}

        {/* Recent Commands */}
        {tech.recentCommands && tech.recentCommands.length > 0 && (
          <SectionCard title="Recent Commands" icon={<Terminal className="w-3.5 h-3.5" />}>
            {tech.recentCommands.map((cmd) => (
              <div key={cmd.id} className="py-2 border-b border-border/40 last:border-0">
                <div className="flex justify-between items-start gap-2">
                  <span className="text-xs font-medium">{cmd.command ?? "Unknown"}</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] h-4 px-1.5 font-mono shrink-0",
                      cmd.phase?.toLowerCase() === "idle" && "text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
                      cmd.phase?.toLowerCase() === "pending" && "text-amber-600 dark:text-amber-400 border-amber-500/30",
                      cmd.phase?.toLowerCase() === "failed" && "text-red-600 dark:text-red-400 border-red-500/30",
                    )}
                  >
                    {cmd.phase ?? "—"}
                  </Badge>
                </div>
                {cmd.createdDt && (
                  <span className="text-[10px] text-muted-foreground font-mono">{formatDateTime(cmd.createdDt)}</span>
                )}
              </div>
            ))}
          </SectionCard>
        )}

        {/* Raw telemetry logs */}
        <section>
          <div className="flex items-center gap-2 mb-2 px-0.5">
            <Activity className="w-3.5 h-3.5 text-muted-foreground" />
            <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Telemetry Logs</h3>
          </div>
          <Card className="shadow-sm border">
            <div className="divide-y divide-border">
              {isLoadingTelemetry ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="p-4">
                    <Skeleton className="h-10 w-full" />
                  </div>
                ))
              ) : telemetry && telemetry.length > 0 ? (
                telemetry.map((entry) => (
                  <div key={entry.id} className="p-3 text-sm hover:bg-muted/30 transition-colors">
                    <div className="flex justify-between items-start mb-1.5 gap-2">
                      <span className="font-mono text-[10px] text-muted-foreground">{formatDateTime(entry.timestamp)}</span>
                      {entry.pipeline && (
                        <Badge variant="outline" className="text-[10px] h-4 py-0 px-1.5 font-mono bg-background shrink-0">
                          {entry.pipeline}
                        </Badge>
                      )}
                    </div>
                    <div className="bg-muted p-2 rounded text-[11px] font-mono break-all whitespace-pre-wrap max-h-28 overflow-y-auto">
                      {entry.payload ?? "No payload"}
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-8 text-center text-muted-foreground flex flex-col items-center">
                  <Info className="w-7 h-7 opacity-40 mb-2" />
                  <span className="text-sm">No telemetry available</span>
                </div>
              )}
            </div>
          </Card>
        </section>
      </div>
    </Layout>
  );
}
