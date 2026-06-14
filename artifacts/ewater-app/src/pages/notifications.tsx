import { useState, useEffect } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { Bell, BellOff, Wifi, Battery, Droplets, TrendingUp, Lock, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface AlertRules {
  offlineEnabled: boolean; offlineHours: number;
  lowBatteryEnabled: boolean; lowBatteryVoltage: number;
  lowTankEnabled: boolean; lowTankPercent: number;
  lowFlowEnabled: boolean; lowFlowLitres: number;
  highFlowEnabled: boolean; highFlowLitres: number;
  stuckValveEnabled: boolean;
  cooldownMinutes: number;
}

async function fetchRules(): Promise<AlertRules> {
  const res = await fetch(`${BASE}/api/ewater/alert-rules`);
  return res.json();
}

async function saveRules(rules: AlertRules): Promise<void> {
  await fetch(`${BASE}/api/ewater/alert-rules`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rules),
  });
}

export default function Notifications() {
  const { state: pushState, enablePush, disablePush } = usePushNotifications();
  const [rules, setRules] = useState<AlertRules | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    fetchRules().then(setRules).catch(() => {});
  }, []);

  const updateRule = <K extends keyof AlertRules>(key: K, value: AlertRules[K]) => {
    setRules((r) => r ? { ...r, [key]: value } : r);
    setSaved(false);
  };

  const handleSave = async () => {
    if (!rules) return;
    setSaving(true);
    await saveRules(rules).catch(() => {});
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleTestAlert = async () => {
    setTestResult("checking…");
    try {
      const res = await fetch(`${BASE}/api/ewater/check-alerts`, { method: "POST" });
      const data = await res.json();
      setTestResult(`Checked ${data.checked} assets, sent ${data.notified} notification${data.notified !== 1 ? "s" : ""}`);
    } catch {
      setTestResult("Failed to run check");
    }
    setTimeout(() => setTestResult(null), 5000);
  };

  const pushLabel: Record<typeof pushState, string> = {
    loading: "Checking…",
    unsupported: "Not supported on this browser",
    denied: "Blocked — allow in browser settings",
    unsubscribed: "Enable push notifications",
    subscribed: "Push notifications enabled",
  };

  const pushIcon = pushState === "subscribed" ? Bell : BellOff;
  const PushIcon = pushIcon;

  return (
    <Layout title="Alerts & Notifications">
      <div className="space-y-4">

        {/* Push toggle */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <PushIcon className="w-4 h-4" />
              Mobile Notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Receive push notifications on this device when monitored assets trigger an alert.
              {pushState === "subscribed" && " You're currently subscribed."}
              {pushState === "unsubscribed" && " Alerts only fire while the app is open until you enable push."}
            </p>
            {pushState === "unsupported" ? (
              <div className="flex items-center gap-2 text-xs text-destructive">
                <AlertCircle className="w-3.5 h-3.5" />
                Push notifications require Chrome or Safari 16.4+ installed as a PWA.
              </div>
            ) : pushState === "denied" ? (
              <div className="flex items-center gap-2 text-xs text-destructive">
                <AlertCircle className="w-3.5 h-3.5" />
                Permission blocked. Open browser settings to allow notifications for this site.
              </div>
            ) : (
              <Button
                size="sm"
                variant={pushState === "subscribed" ? "outline" : "default"}
                className="w-full"
                disabled={pushState === "loading"}
                onClick={pushState === "subscribed" ? disablePush : enablePush}
              >
                {pushState === "loading" ? (
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                ) : pushState === "subscribed" ? (
                  <BellOff className="w-4 h-4 mr-2" />
                ) : (
                  <Bell className="w-4 h-4 mr-2" />
                )}
                {pushLabel[pushState]}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Alert rules */}
        {rules ? (
          <>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pl-1">Alert Rules</p>
              <p className="text-xs text-muted-foreground">Applied to all starred assets</p>
            </div>

            {/* Offline */}
            <AlertRuleCard
              icon={<Wifi className="w-4 h-4" />}
              title="Offline / No Comms"
              description="Alert when an asset hasn't reported in."
              enabled={rules.offlineEnabled}
              onToggle={(v) => updateRule("offlineEnabled", v)}
            >
              <SliderRow
                label="No comms for more than"
                value={rules.offlineHours}
                min={2} max={168} step={2}
                unit="h"
                onChange={(v) => updateRule("offlineHours", v)}
              />
            </AlertRuleCard>

            {/* Low battery */}
            <AlertRuleCard
              icon={<Battery className="w-4 h-4" />}
              title="Low Battery"
              description="Alert when battery voltage drops below threshold."
              enabled={rules.lowBatteryEnabled}
              onToggle={(v) => updateRule("lowBatteryEnabled", v)}
            >
              <SliderRow
                label="Battery below"
                value={rules.lowBatteryVoltage}
                min={2.5} max={4.5} step={0.1}
                unit="V"
                onChange={(v) => updateRule("lowBatteryVoltage", v)}
              />
            </AlertRuleCard>

            {/* Low tank */}
            <AlertRuleCard
              icon={<Droplets className="w-4 h-4" />}
              title="Low Tank Level"
              description="Alert when water tank height falls below threshold."
              enabled={rules.lowTankEnabled}
              onToggle={(v) => updateRule("lowTankEnabled", v)}
            >
              <SliderRow
                label="Tank below"
                value={rules.lowTankPercent}
                min={5} max={50} step={5}
                unit="%"
                onChange={(v) => updateRule("lowTankPercent", v)}
              />
            </AlertRuleCard>

            {/* Low daily flow */}
            <AlertRuleCard
              icon={<Droplets className="w-4 h-4 rotate-180" />}
              title="Low Daily Flow"
              description="Alert when daily water dispensed is unexpectedly low."
              enabled={rules.lowFlowEnabled}
              onToggle={(v) => updateRule("lowFlowEnabled", v)}
            >
              <SliderRow
                label="Less than"
                value={rules.lowFlowLitres}
                min={1} max={100} step={1}
                unit="L/day"
                onChange={(v) => updateRule("lowFlowLitres", v)}
              />
            </AlertRuleCard>

            {/* High flow anomaly */}
            <AlertRuleCard
              icon={<TrendingUp className="w-4 h-4" />}
              title="High Flow Anomaly"
              description="Alert when daily flow is unusually high — possible leak or tampering."
              enabled={rules.highFlowEnabled}
              onToggle={(v) => updateRule("highFlowEnabled", v)}
            >
              <SliderRow
                label="More than"
                value={rules.highFlowLitres}
                min={100} max={2000} step={50}
                unit="L/day"
                onChange={(v) => updateRule("highFlowLitres", v)}
              />
            </AlertRuleCard>

            {/* Stuck valve */}
            <AlertRuleCard
              icon={<Lock className="w-4 h-4" />}
              title="Possible Stuck Valve"
              description="Alert when zero tap events and zero flow are recorded today."
              enabled={rules.stuckValveEnabled}
              onToggle={(v) => updateRule("stuckValveEnabled", v)}
            />

            {/* Cooldown */}
            <Card>
              <CardContent className="pt-4">
                <SliderRow
                  label="Notification cooldown"
                  value={rules.cooldownMinutes}
                  min={15} max={480} step={15}
                  unit="min"
                  onChange={(v) => updateRule("cooldownMinutes", v)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Minimum gap between repeat alerts for the same asset and issue.
                </p>
              </CardContent>
            </Card>

            {/* Save + test */}
            <div className="flex gap-2">
              <Button className="flex-1" onClick={handleSave} disabled={saving}>
                {saving ? (
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                ) : saved ? (
                  <CheckCircle2 className="w-4 h-4 mr-2 text-emerald-500" />
                ) : null}
                {saved ? "Saved" : "Save Rules"}
              </Button>
              <Button variant="outline" onClick={handleTestAlert} title="Run alert check now">
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
            {testResult && (
              <p className="text-xs text-center text-muted-foreground">{testResult}</p>
            )}
          </>
        ) : (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

function AlertRuleCard({
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
    <Card className={cn(!enabled && "opacity-60")}>
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-primary shrink-0">{icon}</span>
            <div>
              <p className="text-sm font-medium leading-tight">{title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
            </div>
          </div>
          <Switch checked={enabled} onCheckedChange={onToggle} className="shrink-0" />
        </div>
        {enabled && children}
      </CardContent>
    </Card>
  );
}

function SliderRow({
  label, value, min, max, step, unit, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number; unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
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
