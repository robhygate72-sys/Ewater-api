import { Layout } from "@/components/layout";
import { useListAssets } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Battery, Signal, Zap, AlertTriangle, Droplet } from "lucide-react";
import { formatTimeAgo } from "@/lib/date";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export default function Assets() {
  const { data: assets, isLoading } = useListAssets();

  return (
    <Layout title="Infrastructure Assets">
      <div className="space-y-4">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))
        ) : assets?.length ? (
          assets.map(asset => (
            <Link key={asset.id} href={`/assets/${asset.id}`}>
              <Card className="border shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden">
                <div className="flex h-full">
                  <div className={cn(
                    "w-1.5 shrink-0", 
                    asset.isOnline ? "bg-emerald-500" : "bg-zinc-500"
                  )} />
                  <CardContent className="p-4 flex-1 flex flex-col justify-between">
                    <div className="flex justify-between items-start mb-2">
                      <div className="overflow-hidden pr-2">
                        <h3 className="font-semibold text-base truncate">{asset.name}</h3>
                        <p className="text-xs text-muted-foreground truncate">{asset.location || 'Unknown location'}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <Badge variant={asset.isOnline ? "default" : "secondary"} className={cn(
                          "text-[10px] px-1.5 py-0 h-4 font-medium uppercase tracking-wider",
                          asset.isOnline ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 shadow-none border-0" : ""
                        )}>
                          {asset.isOnline ? 'Online' : 'Offline'}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {formatTimeAgo(asset.lastSeen)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 mt-auto pt-2 border-t border-border/50">
                      <div className="flex gap-2">
                        {(asset.hasPowerFault || asset.hasFlowFault) ? (
                          <>
                            {asset.hasPowerFault && (
                              <div className="flex items-center text-amber-500 gap-1">
                                <Zap className="w-3.5 h-3.5" />
                                <span className="text-[10px] font-medium">Power</span>
                              </div>
                            )}
                            {asset.hasFlowFault && (
                              <div className="flex items-center text-rose-500 gap-1">
                                <Droplet className="w-3.5 h-3.5" />
                                <span className="text-[10px] font-medium">Flow</span>
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/50"></span>
                            No faults
                          </span>
                        )}
                      </div>
                      
                      <div className="ml-auto flex items-center gap-3 text-muted-foreground">
                        {asset.batteryVoltage != null && (
                          <div className="flex items-center gap-1" title="Battery Voltage">
                            <Battery className="w-3.5 h-3.5" />
                            <span className="text-[10px] font-mono">{asset.batteryVoltage}V</span>
                          </div>
                        )}
                        {asset.signalStrength != null && (
                          <div className="flex items-center gap-1" title="Signal Strength">
                            <Signal className="w-3.5 h-3.5" />
                            <span className="text-[10px] font-mono">{asset.signalStrength}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </div>
              </Card>
            </Link>
          ))
        ) : (
          <div className="text-center p-8 bg-card border border-dashed rounded-xl">
            <Droplet className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-50" />
            <p className="text-sm text-muted-foreground">No assets found</p>
          </div>
        )}
      </div>
    </Layout>
  );
}
