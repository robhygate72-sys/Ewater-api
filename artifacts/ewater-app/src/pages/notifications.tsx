import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { Bell, BellOff, RefreshCw, AlertCircle, Star, CheckCircle2, XCircle, Clock, ChevronDown, ChevronRight } from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type CheckEntry = {
  assetId: string;
  assetName: string;
  alertType: string;
  enabled: boolean;
  triggered: boolean;
  notified: boolean;
  detail: string;
};

type CheckRun = {
  runId: string;
  checkedAt: string;
  entries: CheckEntry[];
};

type CheckStatus = {
  lastCheckAt: string | null;
  nextCheckAt: string | null;
  intervalMs: number;
  secondsUntilNext: number | null;
};

function formatMMSS(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function alertTypeLabel(t: string): string {
  return { offline: "Offline", low_battery: "Low Battery", low_tank: "Low Tank", low_flow: "Low Flow", high_flow: "High Flow", stuck_valve: "Stuck Valve", fetch: "Data Fetch" }[t] ?? t;
}

function RunEntry({ run, open, onToggle }: { run: CheckRun; open: boolean; onToggle: () => void }) {
  const triggered = run.entries.filter(e => e.triggered);
  const notified = run.entries.filter(e => e.notified);
  const failed = run.entries.filter(e => e.detail.startsWith("FAIL") || e.detail.startsWith("SKIP"));

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium">{formatTime(run.checkedAt)}</p>
          <p className="text-[11px] text-muted-foreground">
            {run.entries.length} check{run.entries.length !== 1 ? "s" : ""}
            {triggered.length > 0
              ? <span className="text-amber-600 ml-1">· {triggered.length} triggered</span>
              : <span className="ml-1">· none triggered</span>}
            {notified.length > 0 && <span className="text-emerald-600 ml-1">· {notified.length} notified</span>}
          </p>
        </div>
        {triggered.length > 0 ? (
          <XCircle className="w-4 h-4 text-amber-500 shrink-0" />
        ) : failed.length > 0 ? (
          <AlertCircle className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
        )}
      </button>

      {open && (
        <div className="border-t border-border divide-y divide-border/60 bg-muted/20">
          {triggered.length === 0 ? (
            <p className="px-4 py-2.5 text-[11px] text-muted-foreground">
              No alerts triggered in this run.
            </p>
          ) : (
            triggered.map((e, i) => (
              <div key={i} className="px-4 py-2.5 flex items-start gap-3">
                <div className="mt-0.5 shrink-0">
                  <XCircle className="w-3.5 h-3.5 text-amber-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-foreground/80">
                    {e.assetName} — {alertTypeLabel(e.alertType)}
                    {e.notified && <span className="ml-1 text-emerald-600 font-normal">· push sent</span>}
                  </p>
                  <p className="text-[11px] font-mono mt-0.5 text-amber-600">
                    {e.detail}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function Notifications() {
  const { state: pushState, error: pushError, enablePush, disablePush } = usePushNotifications();
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testPushResult, setTestPushResult] = useState<string | null>(null);
  const [testingPush, setTestingPush] = useState(false);

  const [checkStatus, setCheckStatus] = useState<CheckStatus | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [checkLog, setCheckLog] = useState<CheckRun[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [openRunIds, setOpenRunIds] = useState<Set<string>>(new Set());
  const newestRunIdRef = useRef<string | null>(null);

  const toggleRun = useCallback((runId: string) => {
    setOpenRunIds(prev => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/ewater/alert-check-status`);
      if (res.ok) {
        const data: CheckStatus = await res.json();
        setCheckStatus(data);
        setCountdown(data.secondsUntilNext);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchLog = useCallback(async () => {
    setLogLoading(true);
    try {
      const res = await fetch(`${BASE}/api/ewater/alert-check-log?limit=10`);
      if (res.ok) setCheckLog(await res.json());
    } catch { /* ignore */ }
    setLogLoading(false);
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchLog();
    const statusInterval = setInterval(fetchStatus, 15000);
    const logInterval = setInterval(fetchLog, 30000);
    return () => { clearInterval(statusInterval); clearInterval(logInterval); };
  }, [fetchStatus, fetchLog]);

  // Keep the most recent run expanded; collapse older runs when a newer one arrives.
  useEffect(() => {
    const newest = checkLog[0]?.runId ?? null;
    if (newest && newest !== newestRunIdRef.current) {
      newestRunIdRef.current = newest;
      setOpenRunIds(new Set([newest]));
    }
  }, [checkLog]);

  // Live countdown tick
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) { fetchStatus(); fetchLog(); return; }
    const t = setTimeout(() => setCountdown(c => (c ?? 1) - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, fetchStatus, fetchLog]);

  const handleTestAlert = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${BASE}/api/ewater/check-alerts`, { method: "POST" });
      const data = await res.json();
      setTestResult(`Checked ${data.checked} assets, sent ${data.notified} notification${data.notified !== 1 ? "s" : ""}`);
      setTimeout(fetchLog, 1000);
    } catch {
      setTestResult("Failed to run check");
    }
    setTesting(false);
    setTimeout(() => setTestResult(null), 8000);
  };

  const handleTestPush = async () => {
    setTestingPush(true);
    setTestPushResult(null);
    try {
      const res = await fetch(`${BASE}/api/ewater/push/test`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setTestPushResult(`Error: ${data.error}`);
      } else {
        setTestPushResult(`Sent to ${data.sent} device${data.sent !== 1 ? "s" : ""} — check your notifications`);
      }
    } catch {
      setTestPushResult("Request failed");
    }
    setTestingPush(false);
    setTimeout(() => setTestPushResult(null), 8000);
  };

  const PushIcon = pushState === "subscribed" ? Bell : BellOff;
  const intervalSec = checkStatus ? Math.round(checkStatus.intervalMs / 1000) : 300;
  const progress = countdown !== null ? Math.round(((intervalSec - countdown) / intervalSec) * 100) : 0;

  return (
    <Layout title="Alerts & Notifications">
      <div className="space-y-4">

        {/* Push toggle */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <PushIcon className="w-4 h-4" />
              Mobile Push Notifications
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
              <>
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
                  {pushState === "loading" ? "Checking…"
                    : pushState === "subscribed" ? "Disable push notifications"
                    : "Enable push notifications"}
                </Button>
                {pushError && (
                  <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{pushError}</span>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Per-asset rules hint */}
        <Card className="border-dashed">
          <CardContent className="pt-4">
            <div className="flex gap-3 items-start">
              <Star className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Per-asset alert thresholds</p>
                <p className="text-xs text-muted-foreground">
                  Alert thresholds (battery, tank level, flow, offline timeout) are configured individually
                  on each asset's detail page. Open any starred asset to adjust its settings.
                </p>
                <Link href="/watchlist">
                  <Button variant="link" size="sm" className="px-0 h-auto text-xs mt-1">
                    View watchlist →
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Countdown timer */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Alert Monitor
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {checkStatus?.lastCheckAt
                  ? `Last check: ${formatTime(checkStatus.lastCheckAt)}`
                  : "No check run yet this session"}
              </span>
              {countdown !== null && (
                <span className="font-mono font-semibold tabular-nums">
                  {formatMMSS(countdown)}
                </span>
              )}
            </div>
            {countdown !== null && (
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-1000"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              {countdown !== null
                ? `Next automatic check in ${formatMMSS(countdown)} (every ${Math.round(intervalSec / 60)} min)`
                : `Checks run every ${Math.round(intervalSec / 60)} minutes. Restart the server to begin.`}
            </p>
          </CardContent>
        </Card>

        {/* Test push */}
        {pushState === "subscribed" && (
          <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full"
              onClick={handleTestPush}
              disabled={testingPush}
            >
              {testingPush ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Bell className="w-4 h-4 mr-2" />}
              Send test notification now
            </Button>
            {testPushResult && (
              <p className="text-xs text-center text-muted-foreground">{testPushResult}</p>
            )}
          </div>
        )}

        {/* Manual check */}
        <div className="space-y-2">
          <Button
            variant="outline"
            className="w-full"
            onClick={handleTestAlert}
            disabled={testing}
          >
            {testing ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Run alert check now
          </Button>
          {testResult && (
            <p className="text-xs text-center text-muted-foreground">{testResult}</p>
          )}
        </div>

        {/* Check log */}
        <div>
          <div className="flex items-center justify-between mb-2 px-0.5">
            <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Check Log</h3>
            <button onClick={fetchLog} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
              <RefreshCw className={cn("w-3 h-3", logLoading && "animate-spin")} /> Refresh
            </button>
          </div>
          {checkLog.length === 0 ? (
            <div className="text-center py-8 text-xs text-muted-foreground border border-dashed rounded-xl">
              {logLoading ? "Loading…" : "No check runs recorded yet. Tap \"Run alert check now\" to start."}
            </div>
          ) : (
            <div className="space-y-2">
              {checkLog.map(run => (
                <RunEntry
                  key={run.runId}
                  run={run}
                  open={openRunIds.has(run.runId)}
                  onToggle={() => toggleRun(run.runId)}
                />
              ))}
            </div>
          )}
        </div>

      </div>
    </Layout>
  );
}
