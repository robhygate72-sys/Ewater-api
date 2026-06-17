import { useFavourites } from "@/contexts/FavouritesContext";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Star, ChevronRight, Battery, Droplet, ShieldAlert, Zap, TrendingDown, CircleDollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { FavouriteButton } from "@/components/FavouriteButton";
import { Badge } from "@/components/ui/badge";
import { useListAssets, useGetAssetEwc, getGetAssetEwcQueryKey } from "@workspace/api-client-react";
import { formatTimeAgo } from "@/lib/date";
import { useState, useEffect, useRef } from "react";

function hasFlag(flags: string | null | undefined, flag: string) {
  if (!flags) return false;
  return flags.toLowerCase().split(",").some((f) => f.trim().toLowerCase().includes(flag.toLowerCase()));
}

function AssetEwcBadge({ assetId }: { assetId: string }) {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry?.isIntersecting) { setIsVisible(true); observer.disconnect(); } },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { data } = useGetAssetEwc(assetId, {
    query: { enabled: isVisible, queryKey: getGetAssetEwcQueryKey(assetId) },
  });

  return (
    <div ref={ref}>
      {data && (data.priceOfWater != null || data.ewcFcf != null) && (
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {data.priceOfWater != null && (
            <span className="flex items-center gap-1 text-[10px] font-mono bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded">
              <CircleDollarSign className="w-2.5 h-2.5" />
              {data.priceOfWater.toFixed(4)}
            </span>
          )}
          {data.ewcFcf != null && (
            <span className="text-[10px] font-mono text-muted-foreground">FCF {data.ewcFcf}</span>
          )}
          {data.ewcLcf != null && (
            <span className="text-[10px] font-mono text-muted-foreground">LCF {data.ewcLcf}</span>
          )}
          {data.ewcPreload != null && (
            <span className="text-[10px] font-mono text-muted-foreground">Pre {data.ewcPreload}</span>
          )}
        </div>
      )}
    </div>
  );
}

export default function Watchlist() {
  const { favourites, isLoading: isLoadingFavs } = useFavourites();
  const { data: allAssets, isLoading: isLoadingAssets } = useListAssets();

  const assetMap = new Map((allAssets ?? []).map((a) => [a.id, a]));

  const isLoading = isLoadingFavs || isLoadingAssets;

  return (
    <Layout title="Watchlist">
      <div className="space-y-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))
        ) : favourites.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
              <Star className="w-8 h-8 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium text-foreground">No favourites yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Tap the ★ on any asset to add it here for monitoring.
              </p>
            </div>
            <Link href="/assets" className="text-sm text-primary underline underline-offset-2">
              Browse assets
            </Link>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground pl-0.5">
              {favourites.length} monitored asset{favourites.length !== 1 ? "s" : ""}
            </p>
            {favourites.map((fav) => {
              const asset = assetMap.get(fav.assetId);
              const flags = (asset as any)?.rawData?.healthFlags as string | undefined;
              const tamper     = hasFlag(flags, "tamper");
              const lowBattery = hasFlag(flags, "lowbattery") || hasFlag(flags, "low battery");

              return (
                <Link key={fav.assetId} href={`/assets/${fav.assetId}`}>
                  <Card className="border shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden active:scale-[0.99]">
                    <div className="flex h-full">
                      <div
                        className={cn(
                          "w-1.5 shrink-0",
                          tamper || lowBattery
                            ? "bg-amber-500"
                            : asset?.isOnline
                              ? "bg-emerald-500"
                              : "bg-zinc-400",
                        )}
                      />
                      <CardContent className="p-3 flex-1 min-w-0">
                        <div className="flex justify-between items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <h3 className="font-semibold text-sm truncate leading-tight">{fav.assetName}</h3>
                            {asset?.waterSystemName ? (
                              <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                                {asset.waterSystemName}
                                {asset.countryName ? ` · ${asset.countryName}` : ""}
                              </p>
                            ) : (
                              <p className="text-[11px] text-muted-foreground mt-0.5">Asset #{fav.assetId}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0">
                            <FavouriteButton assetId={fav.assetId} assetName={fav.assetName} />
                            <ChevronRight className="w-4 h-4 text-muted-foreground/40" />
                          </div>
                        </div>

                        <AssetEwcBadge assetId={fav.assetId} />

                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          {tamper && (
                            <span className="flex items-center gap-1 text-[10px] font-medium bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 px-1.5 py-0.5 rounded">
                              <ShieldAlert className="w-3 h-3" /> Tamper
                            </span>
                          )}
                          {lowBattery && (
                            <span className="flex items-center gap-1 text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded">
                              <TrendingDown className="w-3 h-3" /> Low Battery
                            </span>
                          )}
                          {asset?.hasPowerFault && !lowBattery && (
                            <span className="flex items-center gap-1 text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded">
                              <Zap className="w-3 h-3" /> Power
                            </span>
                          )}
                          {asset?.hasFlowFault && (
                            <span className="flex items-center gap-1 text-[10px] font-medium bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 px-1.5 py-0.5 rounded">
                              <Droplet className="w-3 h-3" /> Flow
                            </span>
                          )}

                          <div className="ml-auto flex items-center gap-2.5 text-muted-foreground">
                            {asset?.batteryVoltage != null && (
                              <div className="flex items-center gap-1">
                                <Battery className="w-3.5 h-3.5" />
                                <span className="text-[10px] font-mono">{asset.batteryVoltage}V</span>
                              </div>
                            )}
                            {asset?.lastSeen && (
                              <span className="text-[10px]">{formatTimeAgo(asset.lastSeen)}</span>
                            )}
                            {asset?.isOnline != null && (
                              <Badge
                                variant={asset.isOnline ? "default" : "secondary"}
                                className={cn(
                                  "text-[10px] px-1.5 py-0 h-4 font-medium uppercase tracking-wider shadow-none",
                                  asset.isOnline
                                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-0 hover:bg-emerald-500/20"
                                    : "",
                                )}
                              >
                                {asset.isOnline ? "Online" : "Offline"}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </>
        )}
      </div>
    </Layout>
  );
}
