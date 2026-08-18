import { useState } from "react";
import {
  useGetHouseholdMeterHistory,
  getGetHouseholdMeterHistoryQueryKey,
  type GetHouseholdMeterHistoryPeriod,
} from "@workspace/api-client-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTimeAgo } from "@/lib/date";
import { SectionCard } from "./shared";

const PERIODS: GetHouseholdMeterHistoryPeriod[] = ["24h", "7d", "30d"];

export function UsageCharts({ assetId }: { assetId: string }) {
  const [period, setPeriod] = useState<GetHouseholdMeterHistoryPeriod>("7d");

  const params = { period };
  const query = useGetHouseholdMeterHistory(assetId, params, {
    query: {
      queryKey: getGetHouseholdMeterHistoryQueryKey(assetId, params),
      // Historical data changes slowly — low polling frequency.
      staleTime: 5 * 60_000,
      refetchInterval: 10 * 60_000,
    },
  });

  const data = query.data;
  const chartData = (data?.buckets ?? []).map((b) => ({
    label:
      period === "24h"
        ? new Date(b.bucketStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : new Date(b.bucketStart).toLocaleDateString([], { month: "short", day: "numeric" }),
    litres: b.consumptionLitres,
    discontinuity: b.discontinuity,
    readings: b.readingCount,
  }));

  const hasAnyData = chartData.some((d) => d.litres != null);

  return (
    <SectionCard
      title="Consumption history"
      actions={
        <div className="flex items-center gap-1.5">
          {PERIODS.map((p) => (
            <button
              key={p}
              data-testid={`button-history-period-${p}`}
              onClick={() => setPeriod(p)}
              className={cn(
                "text-[10px] px-2 py-0.5 rounded-md border transition-colors",
                period === p ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:bg-muted",
              )}
            >
              {p}
            </button>
          ))}
          <button
            data-testid="button-refresh-history"
            onClick={() => void query.refetch()}
            className="p-1 rounded-md hover:bg-muted transition-colors"
            title="Refresh history"
          >
            <RefreshCw className={cn("w-3 h-3 text-muted-foreground", query.isFetching && "animate-spin")} />
          </button>
        </div>
      }
    >
      {query.isLoading ? (
        <Skeleton className="h-44 w-full rounded-lg" />
      ) : query.isError ? (
        <p className="text-xs text-destructive py-6 text-center">Failed to load consumption history</p>
      ) : !hasAnyData ? (
        <p className="text-xs text-muted-foreground py-6 text-center italic">
          No consumption data derivable for this period (insufficient meter readings)
        </p>
      ) : (
        <>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" tickLine={false} />
                <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(v) => [typeof v === "number" ? `${v.toLocaleString()} L` : "No data", "Consumption"]}
                  labelStyle={{ fontSize: 11 }}
                  contentStyle={{ fontSize: 11, borderRadius: 8 }}
                />
                <Bar dataKey="litres" radius={[3, 3, 0, 0]}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.discontinuity ? "hsl(var(--destructive))" : "hsl(var(--chart-1))"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground flex-wrap gap-1">
            <span data-testid="text-history-total">
              Total: {data?.totalConsumptionLitres != null ? `${data.totalConsumptionLitres.toLocaleString()} L` : "not derivable"}
              {data && data.discontinuityCount > 0 && (
                <span className="text-destructive ml-2">
                  ⚠ {data.discontinuityCount} counter reset{data.discontinuityCount !== 1 ? "s" : ""} (red bars)
                </span>
              )}
            </span>
            {data?.fetchedAt && <span>Fetched {formatTimeAgo(data.fetchedAt)}</span>}
          </div>
        </>
      )}
    </SectionCard>
  );
}
