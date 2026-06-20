import { useState, useMemo, useEffect, useRef } from "react";
import { useLifecycleFilter, type LifecycleFilter } from "@/App";
import { Layout } from "@/components/layout";
import { useListAssets, useGetEntityHierarchy, useGetAssetEwc, getGetAssetEwcQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { Battery, Droplet, Search, ChevronRight, ShieldAlert, Zap, TrendingDown, Download, CircleDollarSign, CheckCircle2, Circle, Star, StarOff } from "lucide-react";
import { FavouriteButton } from "@/components/FavouriteButton";
import { useFavourites } from "@/contexts/FavouritesContext";
import { formatTimeAgo } from "@/lib/date";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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

function hasFlag(flags: string | null | undefined, flag: string) {
  if (!flags) return false;
  return flags.toLowerCase().split(",").some((f) => f.trim().toLowerCase().includes(flag.toLowerCase()));
}

const LIFECYCLE_OPTIONS: { value: LifecycleFilter; label: string }[] = [
  { value: "PreInstallation", label: "Pre-install" },
  { value: "Staged", label: "Staged" },
  { value: "Active", label: "Active" },
  { value: "Test", label: "Test" },
];

export default function Assets() {
  const { lifecycleFilter, setLifecycleFilter } = useLifecycleFilter();
  const { data: assets, isLoading: isLoadingAssets } = useListAssets();
  const { data: hierarchy } = useGetEntityHierarchy();
  const { isFavourite, bulkAdd, bulkRemove } = useFavourites();

  const [search, setSearch] = useState("");
  const [selectedCountry, setSelectedCountry] = useState<number | null>(null);
  const [selectedWaterSystem, setSelectedWaterSystem] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);

  const allHierarchyCountries = hierarchy?.countries ?? [];

  const countries = useMemo(() => {
    if (!assets) return allHierarchyCountries;
    const namesWithAssets = new Set(
      assets
        .filter((a) => (a.status ?? "Active") === lifecycleFilter)
        .map((a) => a.countryName)
        .filter(Boolean),
    );
    return allHierarchyCountries.filter((c) => namesWithAssets.has(c.name));
  }, [assets, allHierarchyCountries, lifecycleFilter]);

  const waterSystems = useMemo(
    () => allHierarchyCountries.find((c) => c.id === selectedCountry)?.waterSystems ?? [],
    [allHierarchyCountries, selectedCountry],
  );

  const filtered = useMemo(() => {
    if (!assets) return [];
    let list = assets.filter((a) => (a.status ?? "Active") === lifecycleFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          (a.waterSystemName ?? "").toLowerCase().includes(q) ||
          (a.countryName ?? "").toLowerCase().includes(q) ||
          a.id.toLowerCase().includes(q),
      );
    }
    if (selectedCountry != null) {
      list = list.filter((a) => a.countryName === countries.find((c) => c.id === selectedCountry)?.name);
    }
    if (selectedWaterSystem != null) {
      list = list.filter((a) => a.parentId === selectedWaterSystem);
    }
    return list;
  }, [assets, search, selectedCountry, selectedWaterSystem, countries, lifecycleFilter]);

  useEffect(() => {
    setSelectedCountry(null);
    setSelectedWaterSystem(null);
  }, [lifecycleFilter]);

  function selectCountry(id: number | null) {
    setSelectedCountry(id);
    setSelectedWaterSystem(null);
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  function toggleSelected(assetId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(filtered.map((a) => a.id)));
  }

  async function handleBulkAdd(assetList = filtered.filter((a) => selectedIds.has(a.id))) {
    if (assetList.length === 0) return;
    setBulkPending(true);
    try {
      await bulkAdd(assetList.map((a) => ({ assetId: a.id, assetName: a.name })));
    } finally {
      setBulkPending(false);
      exitSelectMode();
    }
  }

  async function handleBulkRemove(assetList = filtered.filter((a) => selectedIds.has(a.id))) {
    if (assetList.length === 0) return;
    setBulkPending(true);
    try {
      await bulkRemove(assetList.map((a) => a.id));
    } finally {
      setBulkPending(false);
      exitSelectMode();
    }
  }

  const isLoading = isLoadingAssets;
  const lifecycleTotal = assets?.filter((a) => (a.status ?? "Active") === lifecycleFilter).length ?? 0;

  const selectedWaterSystemName = selectedWaterSystem != null
    ? waterSystems.find((ws) => ws.id === selectedWaterSystem)?.name
    : null;

  const allSelectedOnWatchlist = filtered.every((a) => isFavourite(a.id));

  return (
    <Layout
      title={selectMode ? `${selectedIds.size} selected` : "Assets"}
      headerActions={
        <div className="flex items-center gap-1">
          {!selectMode && (
            <Link
              href="/export"
              className="p-2 rounded-full hover:bg-primary-foreground/10 transition-colors text-primary-foreground"
              title="Export FCF/LCF/FX CSV"
            >
              <Download className="w-5 h-5" />
            </Link>
          )}
          <button
            onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
            className="px-3 py-1 text-sm font-medium text-primary-foreground hover:bg-primary-foreground/10 rounded-lg transition-colors"
          >
            {selectMode ? "Cancel" : "Select"}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {/* Lifecycle Filter */}
        {!selectMode && (
          <div className="flex gap-2">
            {LIFECYCLE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setLifecycleFilter(opt.value)}
                className={cn(
                  "flex-1 py-1.5 text-xs font-semibold rounded-lg border transition-colors",
                  lifecycleFilter === opt.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-muted-foreground border-border hover:bg-muted",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {/* Search */}
        {!selectMode && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search assets, water systems..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>
        )}

        {/* Country filter */}
        {!selectMode && countries.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => selectCountry(null)}
              className={cn(
                "text-xs px-3 py-1 rounded-full border transition-colors",
                selectedCountry == null
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-foreground/30",
              )}
            >
              All countries
            </button>
            {countries.map((c) => (
              <button
                key={c.id}
                onClick={() => selectCountry(c.id)}
                className={cn(
                  "text-xs px-3 py-1 rounded-full border transition-colors",
                  selectedCountry === c.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-foreground/30",
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        {/* Water system filter */}
        {!selectMode && selectedCountry != null && waterSystems.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setSelectedWaterSystem(null)}
              className={cn(
                "text-xs px-3 py-1 rounded-full border transition-colors",
                selectedWaterSystem == null
                  ? "bg-secondary text-secondary-foreground border-secondary"
                  : "bg-background text-muted-foreground border-border hover:border-foreground/30",
              )}
            >
              All systems
            </button>
            {waterSystems.map((ws) => (
              <button
                key={ws.id}
                onClick={() => setSelectedWaterSystem(ws.id)}
                className={cn(
                  "text-xs px-3 py-1 rounded-full border transition-colors",
                  selectedWaterSystem === ws.id
                    ? "bg-secondary text-secondary-foreground border-secondary"
                    : "bg-background text-muted-foreground border-border hover:border-foreground/30",
                )}
              >
                {ws.name}
                <span className="ml-1 opacity-60">({ws.assetCount})</span>
              </button>
            ))}
          </div>
        )}

        {/* Water system group quick-action (non-select mode) */}
        {!selectMode && selectedWaterSystem != null && !isLoading && filtered.length > 0 && (
          <div className="flex items-center gap-2 bg-muted/60 border border-border rounded-lg px-3 py-2">
            <span className="text-xs text-muted-foreground flex-1 truncate">
              {selectedWaterSystemName ?? "Water system"} · {filtered.length} asset{filtered.length !== 1 ? "s" : ""}
            </span>
            {allSelectedOnWatchlist ? (
              <button
                onClick={() => handleBulkRemove(filtered)}
                className="flex items-center gap-1 text-xs font-medium text-destructive hover:opacity-80 shrink-0"
              >
                <StarOff className="w-3.5 h-3.5" />
                Remove all
              </button>
            ) : (
              <button
                onClick={() => handleBulkAdd(filtered)}
                className="flex items-center gap-1 text-xs font-medium text-primary hover:opacity-80 shrink-0"
              >
                <Star className="w-3.5 h-3.5" />
                Add all to watchlist
              </button>
            )}
          </div>
        )}

        {/* Select mode hint + select-all */}
        {selectMode && !isLoading && (
          <div className="flex items-center gap-2 px-0.5">
            <p className="text-xs text-muted-foreground flex-1">Tap cards to select</p>
            {selectedIds.size < filtered.length ? (
              <button onClick={selectAll} className="text-xs font-medium text-primary">
                Select all {filtered.length}
              </button>
            ) : (
              <button onClick={() => setSelectedIds(new Set())} className="text-xs font-medium text-muted-foreground">
                Deselect all
              </button>
            )}
          </div>
        )}

        {/* Count */}
        {!selectMode && !isLoading && assets && (
          <p className="text-xs text-muted-foreground pl-0.5">
            {filtered.length === lifecycleTotal
              ? `${lifecycleTotal} assets`
              : `${filtered.length} of ${lifecycleTotal} assets`}
          </p>
        )}

        {/* List */}
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))
        ) : filtered.length ? (
          filtered.map((asset) => {
            const flags = (asset as any).rawData?.healthFlags as string | undefined;
            const tamper = hasFlag(flags, "tamper");
            const lowBattery = hasFlag(flags, "lowbattery") || hasFlag(flags, "low battery");
            const isSelected = selectedIds.has(asset.id);

            const cardBody = (
              <Card
                className={cn(
                  "border shadow-sm transition-all overflow-hidden",
                  selectMode
                    ? "cursor-pointer active:scale-[0.99]"
                    : "hover:shadow-md cursor-pointer active:scale-[0.99]",
                  selectMode && isSelected && "ring-2 ring-primary border-primary",
                )}
              >
                <div className="flex h-full">
                  <div
                    className={cn(
                      "w-1.5 shrink-0",
                      selectMode && isSelected
                        ? "bg-primary"
                        : tamper || lowBattery
                          ? "bg-amber-500"
                          : asset.isOnline
                            ? "bg-emerald-500"
                            : "bg-zinc-400",
                    )}
                  />
                  <CardContent className="p-3 flex-1 min-w-0">
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-sm truncate leading-tight">{asset.name}</h3>
                        {asset.waterSystemName && (
                          <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                            {asset.waterSystemName}
                            {asset.countryName ? ` · ${asset.countryName}` : ""}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <div className="flex items-center gap-0.5">
                          {selectMode ? (
                            isSelected
                              ? <CheckCircle2 className="w-5 h-5 text-primary" />
                              : <Circle className="w-5 h-5 text-muted-foreground/40" />
                          ) : (
                            <>
                              <FavouriteButton assetId={asset.id} assetName={asset.name} />
                              <ChevronRight className="w-4 h-4 text-muted-foreground/40" />
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <AssetEwcBadge assetId={asset.id} />

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
                      {asset.hasPowerFault && !lowBattery && (
                        <span className="flex items-center gap-1 text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded">
                          <Zap className="w-3 h-3" /> Power
                        </span>
                      )}
                      {asset.hasFlowFault && (
                        <span className="flex items-center gap-1 text-[10px] font-medium bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 px-1.5 py-0.5 rounded">
                          <Droplet className="w-3 h-3" /> Flow
                        </span>
                      )}

                      <div className="ml-auto flex items-center gap-2.5 text-muted-foreground">
                        {asset.batteryVoltage != null && (
                          <div className="flex items-center gap-1">
                            <Battery className="w-3.5 h-3.5" />
                            <span className="text-[10px] font-mono">{asset.batteryVoltage}V</span>
                          </div>
                        )}
                        {asset.lastSeen && (
                          <span className="text-[10px]">{formatTimeAgo(asset.lastSeen)}</span>
                        )}
                        {asset.isOnline != null && (
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
            );

            return selectMode ? (
              <div key={asset.id} onClick={() => toggleSelected(asset.id)}>
                {cardBody}
              </div>
            ) : (
              <Link key={asset.id} href={`/assets/${asset.id}`}>
                {cardBody}
              </Link>
            );
          })
        ) : (
          <div className="text-center p-10 bg-card border border-dashed rounded-xl">
            <Droplet className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-50" />
            <p className="text-sm text-muted-foreground">No assets found</p>
          </div>
        )}
      </div>

      {/* Select mode bottom action bar */}
      {selectMode && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 w-full max-w-md z-50 px-4 pb-2">
          <div className="bg-card border rounded-xl shadow-xl p-3 flex items-center gap-2">
            <span className="text-sm text-muted-foreground flex-1">
              {selectedIds.size === 0
                ? "None selected"
                : `${selectedIds.size} asset${selectedIds.size !== 1 ? "s" : ""}`}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={selectedIds.size === 0 || bulkPending}
              onClick={() => handleBulkRemove()}
              className="text-destructive border-destructive/30 hover:bg-destructive/10 h-8"
            >
              <StarOff className="w-3.5 h-3.5 mr-1" />
              Remove
            </Button>
            <Button
              size="sm"
              disabled={selectedIds.size === 0 || bulkPending}
              onClick={() => handleBulkAdd()}
              className="h-8"
            >
              <Star className="w-3.5 h-3.5 mr-1" />
              Watchlist
            </Button>
          </div>
        </div>
      )}
    </Layout>
  );
}
