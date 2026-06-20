import { useState } from "react";
import { useFavourites } from "@/contexts/FavouritesContext";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Star, ChevronRight, Battery, Droplet, ShieldAlert, Zap, TrendingDown, CircleDollarSign, ClipboardCopy, Check, Map as MapIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { FavouriteButton } from "@/components/FavouriteButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useListAssets, useGetAssetEwc, getGetAssetEwcQueryKey } from "@workspace/api-client-react";
import { formatTimeAgo } from "@/lib/date";
import { useState as useStateRef, useEffect, useRef } from "react";
import { WatchlistMap } from "@/components/watchlist-map";

function hasFlag(flags: string | null | undefined, flag: string) {
  if (!flags) return false;
  return flags.toLowerCase().split(",").some((f) => f.trim().toLowerCase().includes(flag.toLowerCase()));
}

function AssetEwcBadge({ assetId }: { assetId: string }) {
  const [isVisible, setIsVisible] = useStateRef(false);
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

  const [mapOpen, setMapOpen] = useState(false);
  const [copySheetOpen, setCopySheetOpen] = useState(false);
  const [sourceId, setSourceId] = useState<string>("");
  const [targetIds, setTargetIds] = useState<Set<string>>(new Set());
  const [isCopying, setIsCopying] = useState(false);
  const [copyDone, setCopyDone] = useState(false);

  const assetMap = new Map((allAssets ?? []).map((a) => [a.id, a]));
  const isLoading = isLoadingFavs || isLoadingAssets;

  function openCopySheet() {
    setSourceId(favourites[0]?.assetId ?? "");
    setTargetIds(new Set());
    setCopyDone(false);
    setCopySheetOpen(true);
  }

  function toggleTarget(assetId: string) {
    setTargetIds((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }

  function selectAllTargets() {
    setTargetIds(new Set(favourites.filter((f) => f.assetId !== sourceId).map((f) => f.assetId)));
  }

  async function handleCopy() {
    if (!sourceId || targetIds.size === 0) return;
    setIsCopying(true);
    try {
      const res = await fetch("/api/ewater/alert-rules/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromAssetId: sourceId, toAssetIds: [...targetIds] }),
      });
      if (!res.ok) throw new Error("Copy failed");
      setCopyDone(true);
      setTimeout(() => setCopySheetOpen(false), 1200);
    } catch {
      // keep sheet open on error
    } finally {
      setIsCopying(false);
    }
  }

  const sourceName = favourites.find((f) => f.assetId === sourceId)?.assetName ?? sourceId;
  const validTargets = favourites.filter((f) => f.assetId !== sourceId);

  return (
    <Layout
      title="Watchlist"
      headerActions={
        <div className="flex items-center gap-1">
          {favourites.length > 0 && (
            <button
              onClick={() => setMapOpen(true)}
              className="p-2 rounded-full hover:bg-primary-foreground/10 transition-colors text-primary-foreground"
              title="Map view"
            >
              <MapIcon className="w-5 h-5" />
            </button>
          )}
          {favourites.length >= 2 && (
            <button
              onClick={openCopySheet}
              className="p-2 rounded-full hover:bg-primary-foreground/10 transition-colors text-primary-foreground"
              title="Copy alert settings to multiple assets"
            >
              <ClipboardCopy className="w-5 h-5" />
            </button>
          )}
        </div>
      }
    >
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

      {/* Map sheet */}
      <Sheet open={mapOpen} onOpenChange={setMapOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl h-[85dvh] flex flex-col p-0">
          <SheetHeader className="px-4 pt-4 pb-2 shrink-0">
            <SheetTitle className="flex items-center gap-2">
              <MapIcon className="w-4 h-4 text-primary" />
              Watchlist Map
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 px-4 pb-4 min-h-0">
            {mapOpen && (
              <WatchlistMap
                className="w-full h-full"
                assets={favourites.map((fav) => {
                  const asset = assetMap.get(fav.assetId);
                  return {
                    id: fav.assetId,
                    name: fav.assetName,
                    location: asset?.location,
                    isOnline: asset?.isOnline,
                    waterSystemName: asset?.waterSystemName,
                    rawData: (asset as any)?.rawData,
                  };
                })}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Copy alert settings sheet */}
      <Sheet open={copySheetOpen} onOpenChange={setCopySheetOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[85dvh] flex flex-col">
          <SheetHeader className="pb-2">
            <SheetTitle className="flex items-center gap-2">
              <ClipboardCopy className="w-4 h-4 text-primary" />
              Copy Alert Settings
            </SheetTitle>
            <p className="text-xs text-muted-foreground text-left">
              Apply one asset's alert rules to other watchlist assets.
            </p>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto space-y-4 py-2">
            {/* Source picker */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Copy FROM</p>
              <div className="space-y-1.5">
                {favourites.map((fav) => (
                  <button
                    key={fav.assetId}
                    onClick={() => {
                      setSourceId(fav.assetId);
                      setTargetIds((prev) => {
                        const next = new Set(prev);
                        next.delete(fav.assetId);
                        return next;
                      });
                    }}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors",
                      sourceId === fav.assetId
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-foreground/20 bg-card",
                    )}
                  >
                    <div className={cn(
                      "w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center",
                      sourceId === fav.assetId ? "border-primary bg-primary" : "border-muted-foreground/40",
                    )}>
                      {sourceId === fav.assetId && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    <span className="text-sm font-medium truncate">{fav.assetName}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Target picker */}
            {sourceId && validTargets.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Apply TO</p>
                  {targetIds.size < validTargets.length ? (
                    <button onClick={selectAllTargets} className="text-xs font-medium text-primary">
                      Select all {validTargets.length}
                    </button>
                  ) : (
                    <button onClick={() => setTargetIds(new Set())} className="text-xs font-medium text-muted-foreground">
                      Deselect all
                    </button>
                  )}
                </div>
                <div className="space-y-1.5">
                  {validTargets.map((fav) => {
                    const checked = targetIds.has(fav.assetId);
                    return (
                      <button
                        key={fav.assetId}
                        onClick={() => toggleTarget(fav.assetId)}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors",
                          checked
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-foreground/20 bg-card",
                        )}
                      >
                        <div className={cn(
                          "w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center",
                          checked ? "border-primary bg-primary" : "border-muted-foreground/40",
                        )}>
                          {checked && <Check className="w-2.5 h-2.5 text-white" />}
                        </div>
                        <span className="text-sm truncate">{fav.assetName}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {sourceId && validTargets.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                Add more assets to your watchlist to copy alerts between them.
              </p>
            )}
          </div>

          <div className="pt-3 border-t shrink-0">
            {copyDone ? (
              <div className="flex items-center justify-center gap-2 py-3 text-emerald-600 font-medium text-sm">
                <Check className="w-4 h-4" />
                Copied to {targetIds.size} asset{targetIds.size !== 1 ? "s" : ""}
              </div>
            ) : (
              <Button
                className="w-full"
                disabled={!sourceId || targetIds.size === 0 || isCopying}
                onClick={handleCopy}
              >
                {isCopying
                  ? "Copying…"
                  : targetIds.size > 0
                    ? `Copy settings from "${sourceName}" to ${targetIds.size} asset${targetIds.size !== 1 ? "s" : ""}`
                    : "Select assets to apply to"}
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </Layout>
  );
}
