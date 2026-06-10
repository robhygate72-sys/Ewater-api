import { useState, useMemo } from "react";
import { Layout } from "@/components/layout";
import { useListAssets, useGetEntityHierarchy } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { Battery, Signal, AlertTriangle, Droplet, Search, ChevronRight, ShieldAlert, Zap, TrendingDown } from "lucide-react";
import { formatTimeAgo } from "@/lib/date";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

function hasFlag(flags: string | null | undefined, flag: string) {
  if (!flags) return false;
  return flags.toLowerCase().split(",").some((f) => f.trim().toLowerCase().includes(flag.toLowerCase()));
}

export default function Assets() {
  const { data: assets, isLoading: isLoadingAssets } = useListAssets();
  const { data: hierarchy } = useGetEntityHierarchy();

  const [search, setSearch] = useState("");
  const [selectedCountry, setSelectedCountry] = useState<number | null>(null);
  const [selectedWaterSystem, setSelectedWaterSystem] = useState<number | null>(null);

  const countries = hierarchy?.countries ?? [];
  const waterSystems = useMemo(
    () => countries.find((c) => c.id === selectedCountry)?.waterSystems ?? [],
    [countries, selectedCountry],
  );

  const filtered = useMemo(() => {
    if (!assets) return [];
    let list = assets;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          (a.waterSystemName ?? "").toLowerCase().includes(q) ||
          (a.countryName ?? "").toLowerCase().includes(q),
      );
    }
    if (selectedCountry != null) {
      list = list.filter((a) => a.countryName === countries.find((c) => c.id === selectedCountry)?.name);
    }
    if (selectedWaterSystem != null) {
      list = list.filter((a) => a.parentId === selectedWaterSystem);
    }
    return list;
  }, [assets, search, selectedCountry, selectedWaterSystem, countries]);

  function selectCountry(id: number | null) {
    setSelectedCountry(id);
    setSelectedWaterSystem(null);
  }

  const isLoading = isLoadingAssets;

  return (
    <Layout title="Assets">
      <div className="space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search assets, water systems..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>

        {/* Country filter */}
        {countries.length > 0 && (
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

        {/* Water system filter (shown when a country is selected) */}
        {selectedCountry != null && waterSystems.length > 0 && (
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

        {/* Count */}
        {!isLoading && assets && (
          <p className="text-xs text-muted-foreground pl-0.5">
            {filtered.length === assets.length
              ? `${assets.length} assets`
              : `${filtered.length} of ${assets.length} assets`}
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

            return (
              <Link key={asset.id} href={`/assets/${asset.id}`}>
                <Card className="border shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden active:scale-[0.99]">
                  <div className="flex h-full">
                    <div
                      className={cn(
                        "w-1.5 shrink-0",
                        tamper || lowBattery
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
                          <ChevronRight className="w-4 h-4 text-muted-foreground/40 mt-0.5" />
                        </div>
                      </div>

                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {/* Alert badges */}
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

                        {/* Status */}
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
                        </div>
                      </div>
                    </CardContent>
                  </div>
                </Card>
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
    </Layout>
  );
}
