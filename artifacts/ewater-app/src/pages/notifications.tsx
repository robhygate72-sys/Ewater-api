import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { Bell, BellOff, RefreshCw, AlertCircle, Star } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function Notifications() {
  const { state: pushState, enablePush, disablePush } = usePushNotifications();
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const handleTestAlert = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${BASE}/api/ewater/check-alerts`, { method: "POST" });
      const data = await res.json();
      setTestResult(`Checked ${data.checked} assets, sent ${data.notified} notification${data.notified !== 1 ? "s" : ""}`);
    } catch {
      setTestResult("Failed to run check");
    }
    setTesting(false);
    setTimeout(() => setTestResult(null), 6000);
  };

  const PushIcon = pushState === "subscribed" ? Bell : BellOff;

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

        {/* Manual check */}
        <div className="space-y-2">
          <Button
            variant="outline"
            className="w-full"
            onClick={handleTestAlert}
            disabled={testing}
          >
            {testing ? (
              <RefreshCw className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Run alert check now
          </Button>
          {testResult && (
            <p className="text-xs text-center text-muted-foreground">{testResult}</p>
          )}
        </div>

      </div>
    </Layout>
  );
}
