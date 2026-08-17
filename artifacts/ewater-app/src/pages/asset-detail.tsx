import { useState, useEffect, useCallback } from "react";
import { Layout } from "@/components/layout";
import { ESenseCharts } from "@/components/esense-charts";
import { BatteryPanel } from "@/components/battery-panel";
import { useGetAssetTech, getGetAssetTechQueryKey } from "@workspace/api-client-react";
import { AssetLogs } from "@/components/asset-logs";
import { DeviceStatusCard } from "@/components/device-status-card";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatTimeAgo } from "@/lib/date";
import {
  MapPin, Battery, Signal, Wifi, WifiOff, ShieldCheck,
  TrendingDown, TrendingUp, Minus, Droplet, Zap, Cpu, Radio,
  AlertTriangle, CheckCircle2, Clock, Activity, Info,
  Bell, Lock, RefreshCw, Star, CircleDollarSign, Gauge,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FavouriteButton } from "@/components/FavouriteButton";
import { useFavourites } from "@/contexts/FavouritesContext";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EwcSettingsPanel } from "@/components/ewc-settings-panel";
import { MeterReadingPanel } from "@/components/water-meter";
import { RawPacketsPanel } from "@/components/raw-packets-panel";
import { DisbursementsPanel } from "@/components/disbursements-panel";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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

// ---------------------------------------------------------------------------
// Alert Rules Section
// ---------------------------------------------------------------------------

interface AlertRules {
  offlineEnabled: boolean; offlineHours: number;
  lowBatteryEnabled: boolean; lowBatteryVoltage: number;
  lowTankEnabled: boolean; lowTankPercent: number;
  lowFlowEnabled: boolean; lowFlowLitres: number;
  highFlowEnabled: boolean; highFlowLitres: number;
  stuckValveEnabled: boolean;
  priceCheckEnabled: boolean; targetPrice: number; priceDeviancePercent: number;
  cooldownMinutes: number;
}

const DEFAULT_RULES: AlertRules = {
  offlineEnabled: true, offlineHours: 48,
  lowBatteryEnabled: true, lowBatteryVoltage: 11.5,
  lowTankEnabled: true, lowTankPercent: 20,
  lowFlowEnabled: false, lowFlowLitres: 10,
  highFlowEnabled: false, highFlowLitres: 500,
  stuckValveEnabled: false,
  priceCheckEnabled: false, targetPrice: 1.5, priceDeviancePercent: 0.5,
  cooldownMinutes: 60,
};

function SliderRow({
  label, value, min, max, step, unit, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number; unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5 pt-2">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-medium">{value}{unit}</span>
      </div>
      <Slider
        value={[value]}
        min={min} max={max} step={step}
        onValueChange={([v]) => onChange(v!)}
        className="w-full"
      />
    </div>
  );
}

function AlertRuleRow({
  icon, title, description, enabled, onToggle, children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("py-3 border-b border-border/40 last:border-0", !enabled && "opacity-60")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-primary shrink-0">{icon}</span>
          <div>
            <p className="text-sm font-medium leading-tight">{title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={onToggle} className="shrink-0 mt-0.5" />
      </div>
      {enabled && children}
    </div>
  );
}

function AssetAlertRules({ assetId, assetName }: { assetId: string; assetName: string }) {
  const { isFavourite, toggleFavourite } = useFavourites();
  const starred = isFavourite(assetId);

  const [rules, setRules] = useState<AlertRules>(DEFAULT_RULES);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!starred) return;
    fetch(`${BASE}/api/ewater/alert-rules/${encodeURIComponent(assetId)}`)
      .then((r) => r.json())
      .then((data) => { setRules({ ...DEFAULT_RULES, ...data }); setLoaded(true); })
      .catch(() => { setLoaded(true); });
  }, [assetId, starred]);

  const updateRule = <K extends keyof AlertRules>(key: K, value: AlertRules[K]) => {
    setRules((r) => ({ ...r, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`${BASE}/api/ewater/alert-rules/${encodeURIComponent(assetId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rules),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { /* ignore */ }
    setSaving(false);
  };

  return (
    <Card className="shadow-sm border">
      <CardHeader className="py-3 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Bell className="w-3.5 h-3.5" />
          Alert Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 py-0">
        {!starred ? (
          <div className="py-5 flex flex-col items-center gap-3 text-center">
            <Star className="w-6 h-6 text-muted-foreground/40" />
            <div>
              <p className="text-sm text-muted-foreground">Star this asset to configure alert thresholds</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">Alerts fire when monitored values exceed your thresholds</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => toggleFavourite(assetId, assetName)}>
              <Star className="w-3.5 h-3.5 mr-1.5" />
              Add to watchlist
            </Button>
          </div>
        ) : !loaded ? (
          <div className="py-4 space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : (
          <>
            <AlertRuleRow
              icon={<Wifi className="w-4 h-4" />}
              title="Offline / No Comms"
              description="Alert when the asset hasn't reported in."
              enabled={rules.offlineEnabled}
              onToggle={(v) => updateRule("offlineEnabled", v)}
            >
              <SliderRow label="No comms for more than" value={rules.offlineHours} min={2} max={168} step={2} unit="h" onChange={(v) => updateRule("offlineHours", v)} />
            </AlertRuleRow>

            <AlertRuleRow
              icon={<Battery className="w-4 h-4" />}
              title="Low Battery"
              description="Alert when battery voltage drops below threshold."
              enabled={rules.lowBatteryEnabled}
              onToggle={(v) => updateRule("lowBatteryEnabled", v)}
            >
              <SliderRow label="Battery below" value={rules.lowBatteryVoltage} min={10} max={13} step={0.1} unit="V" onChange={(v) => updateRule("lowBatteryVoltage", v)} />
            </AlertRuleRow>

            <AlertRuleRow
              icon={<Droplet className="w-4 h-4" />}
              title="Low Tank Level"
              description="Alert when water tank height falls below threshold."
              enabled={rules.lowTankEnabled}
              onToggle={(v) => updateRule("lowTankEnabled", v)}
            >
              <SliderRow label="Tank below" value={rules.lowTankPercent} min={0} max={100} step={1} unit="%" onChange={(v) => updateRule("lowTankPercent", v)} />
            </AlertRuleRow>

            <AlertRuleRow
              icon={<Droplet className="w-4 h-4 rotate-180" />}
              title="Low Daily Flow"
              description="Alert when daily water dispensed is unexpectedly low."
              enabled={rules.lowFlowEnabled}
              onToggle={(v) => updateRule("lowFlowEnabled", v)}
            >
              <SliderRow label="Less than" value={rules.lowFlowLitres} min={1} max={100} step={1} unit="L/day" onChange={(v) => updateRule("lowFlowLitres", v)} />
            </AlertRuleRow>

            <AlertRuleRow
              icon={<TrendingUp className="w-4 h-4" />}
              title="High Flow Anomaly"
              description="Alert when daily flow is unusually high — possible leak."
              enabled={rules.highFlowEnabled}
              onToggle={(v) => updateRule("highFlowEnabled", v)}
            >
              <SliderRow label="More than" value={rules.highFlowLitres} min={100} max={2000} step={50} unit="L/day" onChange={(v) => updateRule("highFlowLitres", v)} />
            </AlertRuleRow>

            <AlertRuleRow
              icon={<Lock className="w-4 h-4" />}
              title="Possible Stuck Valve"
              description="Alert when zero tap events and zero flow are recorded today."
              enabled={rules.stuckValveEnabled}
              onToggle={(v) => updateRule("stuckValveEnabled", v)}
            />

            <AlertRuleRow
              icon={<CircleDollarSign className="w-4 h-4" />}
              title="Price of Water"
              description="Alert when calculated price (FX × LCF ÷ FCF ÷ 1M) deviates from target."
              enabled={rules.priceCheckEnabled}
              onToggle={(v) => updateRule("priceCheckEnabled", v)}
            >
              <div className="space-y-2 pt-2">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground w-28 shrink-0">Target price</label>
                  <input
                    type="number"
                    value={rules.targetPrice}
                    min="0"
                    step="0.01"
                    onChange={(e) => updateRule("targetPrice", parseFloat(e.target.value) || 0)}
                    className="flex-1 min-w-0 border border-border rounded-md px-2 py-1 text-sm font-mono bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground w-28 shrink-0">Deviance</label>
                  <input
                    type="number"
                    value={rules.priceDeviancePercent}
                    min="0"
                    step="0.1"
                    onChange={(e) => updateRule("priceDeviancePercent", parseFloat(e.target.value) || 0)}
                    className="flex-1 min-w-0 border border-border rounded-md px-2 py-1 text-sm font-mono bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <span className="text-xs text-muted-foreground shrink-0">%</span>
                </div>
                <p className="text-xs text-muted-foreground/70">
                  Alert if price &lt; {(rules.targetPrice * (1 - rules.priceDeviancePercent / 100)).toFixed(4)} or &gt; {(rules.targetPrice * (1 + rules.priceDeviancePercent / 100)).toFixed(4)}
                </p>
              </div>
            </AlertRuleRow>

            <div className="py-3">
              <SliderRow label="Notification cooldown" value={rules.cooldownMinutes} min={15} max={480} step={15} unit="min" onChange={(v) => updateRule("cooldownMinutes", v)} />
              <p className="text-xs text-muted-foreground mt-1">Minimum gap between repeat alerts for this asset.</p>
            </div>

            <div className="pb-3">
              <Button className="w-full" size="sm" onClick={handleSave} disabled={saving}>
                {saving ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin mr-2" />
                ) : saved ? (
                  <CheckCircle2 className="w-3.5 h-3.5 mr-2 text-emerald-500" />
                ) : null}
                {saved ? "Saved" : "Save Alert Settings"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AssetDetail() {
  const [, params] = useRoute("/assets/:id");
  const id = params?.id ?? "";
  const [alertSheetOpen, setAlertSheetOpen] = useState(false);

  const { data: tech, isLoading: isLoadingTech } = useGetAssetTech(id, {
    query: { enabled: !!id, queryKey: getGetAssetTechQueryKey(id) },
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

  const isEsense = tech.purpose?.toLowerCase() === "esense";
  const isCommunityTap = tech.purpose?.toLowerCase() === "communitytap";
  const isHhm = tech.purpose?.toLowerCase() === "householdmeter";
  const hasDatalogCharts = isEsense || isCommunityTap;
  const hasImei = tech.imeis.length > 0;
  const tamper = hasFlag(tech.healthFlags, "tamper") || (tech.tamperSwitchState != null && tech.tamperSwitchState !== "None" && tech.tamperSwitchState !== "");
  const lowBattery = hasFlag(tech.healthFlags, "lowbattery") || hasFlag(tech.healthFlags, "low battery");
  const hasAlerts = lowBattery;

  const alertHeaderButton = (
    <button
      onClick={() => setAlertSheetOpen(true)}
      className="p-2 rounded-full hover:bg-primary-foreground/10 transition-colors"
      title="Alert settings"
    >
      <Bell className="w-5 h-5" />
    </button>
  );

  return (
    <Layout title={tech.name} showBack backTo="/assets" headerActions={alertHeaderButton}>
      <Sheet open={alertSheetOpen} onOpenChange={setAlertSheetOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl px-4 pb-8">
          <SheetHeader className="mb-4">
            <SheetTitle className="text-base flex items-center gap-2">
              <Bell className="w-4 h-4" /> Alert Settings — {tech.name}
            </SheetTitle>
          </SheetHeader>
          <AssetAlertRules assetId={id} assetName={tech.name} />
        </SheetContent>
      </Sheet>
      <Tabs defaultValue="status" className="w-full">
        <TabsList className={cn(
          "grid w-full h-auto gap-1 p-1",
          isEsense && hasImei ? "grid-cols-7"
          : isEsense || hasImei ? "grid-cols-6"
          : "grid-cols-5",
        )}>
          <TabsTrigger value="status" className="text-xs px-1 py-1.5">Status</TabsTrigger>
          <TabsTrigger value="battery" className="text-xs px-1 py-1.5">Battery</TabsTrigger>
          <TabsTrigger value="water" className="text-xs px-1 py-1.5">Water</TabsTrigger>
          <TabsTrigger value="ewc" className="text-xs px-1 py-1.5">EWC</TabsTrigger>
          {isEsense && (
            <TabsTrigger value="sense" className="text-xs px-1 py-1.5">Sense</TabsTrigger>
          )}
          {hasImei && (
            <TabsTrigger value="packets" className="text-xs px-1 py-1.5">Packets</TabsTrigger>
          )}
          <TabsTrigger value="logs" className="text-xs px-1 py-1.5">Logs</TabsTrigger>
        </TabsList>

        {/* ─── Status ─── */}
        <TabsContent value="status" className="space-y-3 mt-3">
          {/* Header / details card */}
          <Card className="border-none shadow-md overflow-hidden relative">
            <div className={cn(
              "absolute top-0 left-0 w-full h-1",
              tamper || lowBattery ? "bg-amber-500" : isOnline ? "bg-emerald-500" : "bg-zinc-400",
            )} />
            <CardContent className="p-4 pt-5">
              <div className="flex justify-between items-start mb-3 gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold tracking-tight truncate">{tech.name}</h2>
                    <FavouriteButton assetId={id} assetName={tech.name} />
                  </div>
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
                  <span className="text-muted-foreground block mb-0.5">Asset ID</span>
                  <span className="font-mono text-[11px]">{id}</span>
                </div>
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
                {tech.imeis.length > 0 && (
                  <div>
                    <span className="text-muted-foreground block mb-0.5">
                      {tech.imeis.length > 1 ? "IMEIs" : "IMEI"}
                    </span>
                    {tech.imeis.length > 1 ? (
                      <div className="space-y-0.5">
                        {tech.imeis.map((imei) => (
                          <span key={imei} className="font-mono text-[11px] block">{imei}</span>
                        ))}
                      </div>
                    ) : (
                      <span className="font-mono text-[11px]">{tech.imeis[0]}</span>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* HHM shortcut — shown only for HouseholdMeter assets */}
          {isHhm && (
            <Link href={`/hhm/${id}`}>
              <Button className="w-full gap-2" variant="default">
                <Gauge className="w-4 h-4" />
                See Household Meter
              </Button>
            </Link>
          )}

          {/* Device status (from latest GetStatus reply) */}
          <DeviceStatusCard assetId={id} />

          {/* Alerts */}
          {hasAlerts && (
            <div className="space-y-2">
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
        </TabsContent>

        {/* ─── Battery ─── */}
        <TabsContent value="battery" className="space-y-3 mt-3">
          <BatteryPanel assetId={id} tech={tech} />
        </TabsContent>

        {/* ─── Water ─── */}
        <TabsContent value="water" className="space-y-3 mt-3">
          {/* Meter reading */}
          <MeterReadingPanel assetId={id} />

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
            {tech.priceOfWater != null && (
              <div className="mt-2 pt-2 border-t border-border/40">
                <div className="flex items-baseline gap-2 py-1">
                  <CircleDollarSign className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-bold font-mono">{tech.priceOfWater.toFixed(4)}</span>
                      <span className="text-xs text-muted-foreground">price of water</span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                      {tech.ewcFx != null && <span className="text-[10px] text-muted-foreground font-mono">FX {tech.ewcFx.toLocaleString()}</span>}
                      {tech.ewcLcf != null && <span className="text-[10px] text-muted-foreground font-mono">LCF {tech.ewcLcf}</span>}
                      {tech.ewcFcf != null && <span className="text-[10px] text-muted-foreground font-mono">FCF {tech.ewcFcf}</span>}
                      {tech.ewcPreload != null && <span className="text-[10px] text-muted-foreground font-mono">Preload {tech.ewcPreload}</span>}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </SectionCard>

          {/* Daily disbursements from Usage API */}
          <SectionCard
            title="Daily Disbursements (last 30 days)"
            icon={<Droplet className="w-3.5 h-3.5" />}
            className="!px-0"
          >
            <div className="-mx-4">
              <DisbursementsPanel
                url={`${BASE}/api/ewater/assets/${encodeURIComponent(id)}/disbursements`}
                days={30}
              />
            </div>
          </SectionCard>

          {/* Water usage + flow rate charts (eSense + CommunityTap) */}
          {hasDatalogCharts && (
            <ESenseCharts assetId={id} isEsense={isEsense} show={{ usage: true, flow: true, dispense: true }} showTitle={false} />
          )}
        </TabsContent>

        {/* ─── EWC ─── */}
        <TabsContent value="ewc" className="space-y-3 mt-3">
          <EwcSettingsPanel assetId={id} isEsense={isEsense} variant="ewc-only" />
        </TabsContent>

        {/* ─── Sense (eSense only) ─── */}
        {isEsense && (
          <TabsContent value="sense" className="space-y-3 mt-3">
            {/* Tank height chart */}
            <ESenseCharts assetId={id} isEsense={isEsense} show={{ tankHeight: true }} />
            {/* VSEN sensor settings */}
            <EwcSettingsPanel assetId={id} isEsense={isEsense} variant="sensor-only" />
          </TabsContent>
        )}

        {/* ─── Packets (NB-IoT meter, IMEI assets only) ─── */}
        {hasImei && (
          <TabsContent value="packets" className="space-y-3 mt-3">
            <RawPacketsPanel assetId={id} imeis={tech.imeis} />
          </TabsContent>
        )}

        {/* ─── Protocol logs ─── */}
        <TabsContent value="logs" className="space-y-3 mt-3">
          <section>
            <div className="flex items-center gap-2 mb-2 px-0.5">
              <Activity className="w-3.5 h-3.5 text-muted-foreground" />
              <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Protocol Logs</h3>
            </div>
            <AssetLogs assetId={id} isEsense={isEsense} />
          </section>
        </TabsContent>
      </Tabs>
    </Layout>
  );
}
