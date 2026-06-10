import { Layout } from "@/components/layout";
import { useGetDashboard, useGetCredentialsStatus } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert as AlertUI, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Activity, AlertTriangle, CheckCircle2, Droplet, Settings, XCircle } from "lucide-react";
import { formatTimeAgo } from "@/lib/date";
import { Badge } from "@/components/ui/badge";

export default function Dashboard() {
  const { data: credentials, isLoading: isLoadingCredentials } = useGetCredentialsStatus();
  const { data: dashboard, isLoading: isLoadingDashboard } = useGetDashboard({
    query: {
      enabled: credentials?.isConfigured,
      refetchInterval: 30000 // Refetch every 30s
    }
  });

  if (isLoadingCredentials) {
    return (
      <Layout title="Dashboard">
        <div className="space-y-4">
          <Skeleton className="h-32 w-full rounded-xl" />
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        </div>
      </Layout>
    );
  }

  if (credentials && !credentials.isConfigured) {
    return (
      <Layout title="Dashboard">
        <Card className="border-destructive bg-destructive/5 shadow-sm mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              Not Configured
            </CardTitle>
            <CardDescription className="text-foreground">
              Please configure your eWater API credentials to start monitoring infrastructure.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link 
              href="/settings" 
              className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-10 px-4 py-2 w-full"
            >
              <Settings className="w-4 h-4 mr-2" />
              Go to Settings
            </Link>
          </CardContent>
        </Card>
      </Layout>
    );
  }

  return (
    <Layout title="Dashboard">
      <div className="space-y-6">
        {/* System Overview */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold tracking-tight text-muted-foreground uppercase">System Overview</h2>
            {dashboard?.lastUpdated && (
              <span className="text-xs text-muted-foreground">Updated {formatTimeAgo(dashboard.lastUpdated)}</span>
            )}
          </div>
          
          {isLoadingDashboard ? (
            <Skeleton className="h-28 w-full rounded-xl" />
          ) : dashboard ? (
            <div className="grid grid-cols-2 gap-3">
              <Card className="bg-primary text-primary-foreground border-none shadow-md">
                <CardContent className="p-4 flex flex-col items-center justify-center text-center h-full">
                  <Droplet className="w-6 h-6 mb-2 opacity-80" />
                  <div className="text-3xl font-bold">{dashboard.totalAssets}</div>
                  <div className="text-xs font-medium opacity-90">Total Assets</div>
                </CardContent>
              </Card>

              <div className="grid grid-rows-2 gap-3">
                <Card className="bg-emerald-500 text-white border-none shadow-sm">
                  <CardContent className="p-3 flex items-center justify-between h-full">
                    <div className="flex flex-col">
                      <span className="text-2xl font-bold leading-none">{dashboard.onlineCount}</span>
                      <span className="text-[10px] font-medium uppercase tracking-wider opacity-90">Online</span>
                    </div>
                    <CheckCircle2 className="w-6 h-6 opacity-70" />
                  </CardContent>
                </Card>
                <Card className="bg-zinc-800 text-white border-none shadow-sm">
                  <CardContent className="p-3 flex items-center justify-between h-full">
                    <div className="flex flex-col">
                      <span className="text-2xl font-bold leading-none">{dashboard.offlineCount}</span>
                      <span className="text-[10px] font-medium uppercase tracking-wider opacity-90">Offline</span>
                    </div>
                    <XCircle className="w-6 h-6 opacity-70" />
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : (
             <AlertUI variant="destructive">
               <AlertTriangle className="h-4 w-4" />
               <AlertTitle>Error</AlertTitle>
               <AlertDescription>Failed to load dashboard data.</AlertDescription>
             </AlertUI>
          )}
        </section>

        {/* Faults */}
        <section>
          <h2 className="text-sm font-semibold tracking-tight text-muted-foreground uppercase mb-3">Active Faults</h2>
          {isLoadingDashboard ? (
            <div className="flex gap-3">
              <Skeleton className="h-20 flex-1 rounded-xl" />
              <Skeleton className="h-20 flex-1 rounded-xl" />
            </div>
          ) : dashboard ? (
            <div className="grid grid-cols-2 gap-3">
              <Card className={cn("border shadow-sm", dashboard.powerFaultCount && dashboard.powerFaultCount > 0 ? "border-amber-500 bg-amber-500/10" : "bg-card")}>
                <CardContent className="p-4 flex flex-col items-center text-center">
                  <div className={cn("text-2xl font-bold", dashboard.powerFaultCount && dashboard.powerFaultCount > 0 ? "text-amber-600 dark:text-amber-500" : "text-foreground")}>
                    {dashboard.powerFaultCount || 0}
                  </div>
                  <div className="text-xs font-medium text-muted-foreground mt-1">Power Faults</div>
                </CardContent>
              </Card>
              <Card className={cn("border shadow-sm", dashboard.flowFaultCount && dashboard.flowFaultCount > 0 ? "border-rose-500 bg-rose-500/10" : "bg-card")}>
                <CardContent className="p-4 flex flex-col items-center text-center">
                  <div className={cn("text-2xl font-bold", dashboard.flowFaultCount && dashboard.flowFaultCount > 0 ? "text-rose-600 dark:text-rose-500" : "text-foreground")}>
                    {dashboard.flowFaultCount || 0}
                  </div>
                  <div className="text-xs font-medium text-muted-foreground mt-1">Flow Faults</div>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </section>

        {/* Recent Alerts */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold tracking-tight text-muted-foreground uppercase">Recent Alerts</h2>
            {dashboard?.recentAlerts && dashboard.recentAlerts.length > 0 && (
              <Badge variant="secondary" className="font-mono">{dashboard.recentAlerts.length}</Badge>
            )}
          </div>
          
          <div className="space-y-3">
            {isLoadingDashboard ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-xl" />
              ))
            ) : dashboard?.recentAlerts && dashboard.recentAlerts.length > 0 ? (
              dashboard.recentAlerts.map(alert => (
                <Link key={alert.id} href={`/assets/${alert.assetId}`}>
                  <Card className="border shadow-sm hover:bg-muted/50 transition-colors cursor-pointer mb-3 last:mb-0">
                    <CardContent className="p-3">
                      <div className="flex justify-between items-start mb-1.5">
                        <div className="flex items-center gap-2">
                          <Activity className={cn("w-4 h-4", alert.severity === 'high' ? 'text-destructive' : 'text-amber-500')} />
                          <span className="font-medium text-sm truncate max-w-[200px]">{alert.assetName || alert.assetId}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">{formatTimeAgo(alert.timestamp)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{alert.message}</p>
                    </CardContent>
                  </Card>
                </Link>
              ))
            ) : (
              <div className="text-center p-8 bg-card border border-dashed rounded-xl">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-50" />
                <p className="text-sm text-muted-foreground">No recent alerts</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </Layout>
  );
}

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
