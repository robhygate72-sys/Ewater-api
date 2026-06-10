import { Layout } from "@/components/layout";
import { useGetAsset, getGetAssetQueryKey, useFetchAssetTelemetry, getFetchAssetTelemetryQueryKey } from "@workspace/api-client-react";
import { useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/date";
import { MapPin, Battery, Signal, Zap, Droplet, Activity, Info, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export default function AssetDetail() {
  const [, params] = useRoute("/assets/:id");
  const id = params?.id || "";

  const { data: asset, isLoading: isLoadingAsset } = useGetAsset(id, {
    query: {
      enabled: !!id,
      queryKey: getGetAssetQueryKey(id)
    }
  });

  const { data: telemetry, isLoading: isLoadingTelemetry } = useFetchAssetTelemetry(id, {
    query: {
      enabled: !!id,
      queryKey: getFetchAssetTelemetryQueryKey(id)
    }
  });

  if (isLoadingAsset) {
    return (
      <Layout title="Asset Detail" showBack backTo="/assets">
        <div className="space-y-4">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </Layout>
    );
  }

  if (!asset) {
    return (
      <Layout title="Asset Not Found" showBack backTo="/assets">
        <div className="text-center p-8 bg-card border border-dashed rounded-xl">
          <AlertTriangle className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-50" />
          <p className="text-sm text-muted-foreground">Asset could not be loaded</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={asset.name} showBack backTo="/assets">
      <div className="space-y-6">
        {/* Device Info */}
        <Card className="border-none shadow-md overflow-hidden relative">
          <div className={cn(
            "absolute top-0 left-0 w-full h-1", 
            asset.isOnline ? "bg-emerald-500" : "bg-zinc-500"
          )} />
          <CardContent className="p-5 pt-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-foreground">{asset.name}</h2>
                <div className="flex items-center text-sm text-muted-foreground mt-1 gap-1.5">
                  <MapPin className="w-3.5 h-3.5" />
                  {asset.location || 'Unknown Location'}
                </div>
              </div>
              <Badge variant={asset.isOnline ? "default" : "secondary"} className={cn(
                "text-xs px-2 py-0.5 font-medium uppercase tracking-wider",
                asset.isOnline ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shadow-none border-0" : ""
              )}>
                {asset.isOnline ? 'Online' : 'Offline'}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-4 bg-muted/50 p-3 rounded-lg text-sm">
              <div>
                <span className="text-xs text-muted-foreground block mb-0.5">Type</span>
                <span className="font-medium">{asset.type || 'N/A'}</span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block mb-0.5">Last Seen</span>
                <span className="font-medium font-mono text-xs">{formatDateTime(asset.lastSeen)}</span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block mb-0.5 flex items-center gap-1">
                  <Battery className="w-3 h-3" /> Battery
                </span>
                <span className="font-medium font-mono">{asset.batteryVoltage != null ? `${asset.batteryVoltage}V` : 'N/A'}</span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block mb-0.5 flex items-center gap-1">
                  <Signal className="w-3 h-3" /> Signal
                </span>
                <span className="font-medium font-mono">{asset.signalStrength != null ? asset.signalStrength : 'N/A'}</span>
              </div>
            </div>

            {/* Faults */}
            {(asset.hasPowerFault || asset.hasFlowFault) && (
              <div className="mt-4 flex gap-2 flex-wrap">
                {asset.hasPowerFault && (
                  <div className="flex items-center gap-1.5 bg-amber-500/10 text-amber-600 dark:text-amber-500 px-2.5 py-1 rounded text-xs font-medium border border-amber-500/20">
                    <Zap className="w-3.5 h-3.5" /> Power Fault
                  </div>
                )}
                {asset.hasFlowFault && (
                  <div className="flex items-center gap-1.5 bg-rose-500/10 text-rose-600 dark:text-rose-500 px-2.5 py-1 rounded text-xs font-medium border border-rose-500/20">
                    <Droplet className="w-3.5 h-3.5" /> Flow Fault
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Telemetry Log */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold tracking-tight text-muted-foreground uppercase">Telemetry Log</h3>
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
                telemetry.map(entry => (
                  <div key={entry.id} className="p-4 text-sm hover:bg-muted/30 transition-colors">
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-mono text-xs text-muted-foreground">{formatDateTime(entry.timestamp)}</span>
                      {entry.pipeline && (
                        <Badge variant="outline" className="text-[10px] h-4 py-0 px-1.5 font-mono bg-background">
                          {entry.pipeline}
                        </Badge>
                      )}
                    </div>
                    <div className="bg-muted p-2 rounded text-xs font-mono break-all whitespace-pre-wrap max-h-32 overflow-y-auto">
                      {entry.payload || 'No payload data'}
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-8 text-center text-muted-foreground flex flex-col items-center">
                  <Info className="w-8 h-8 opacity-50 mb-2" />
                  <span className="text-sm">No telemetry data available</span>
                </div>
              )}
            </div>
          </Card>
        </section>
      </div>
    </Layout>
  );
}
