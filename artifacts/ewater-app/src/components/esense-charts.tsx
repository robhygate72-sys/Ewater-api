import { useState } from "react";
import {
  useGetESenseCharts,
  getGetESenseChartsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import {
  Activity,
  Droplets,
  Zap,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertCircle,
} from "lucide-react";

const RANGE_OPTIONS = [
  { label: "1 day", value: 1 },
  { label: "3 days", value: 3 },
  { label: "7 days", value: 7 },
  { label: "1 month", value: 30 },
  { label: "2 months", value: 60 },
  { label: "6 months", value: 180 },
];

function formatAxisTime(isoStr: string, days: number): string {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr.slice(0, 10);
  if (days <= 3) {
    return d.toLocaleString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return d.toLocaleString("en-GB", { month: "short", day: "numeric" });
}

function formatAxisDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleString("en-GB", { month: "short", day: "numeric" });
}

function formatTooltipTime(isoStr: string): string {
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleString("en-GB", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function ChartSection({
  title,
  icon,
  children,
  isEmpty,
  emptyMessage,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  isEmpty?: boolean;
  emptyMessage?: string;
}) {
  return (
    <Card className="shadow-sm border">
      <CardHeader className="py-3 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-2 py-3">
        {isEmpty ? (
          <div className="flex items-center justify-center gap-2 h-20 text-xs text-muted-foreground">
            <AlertCircle className="w-3.5 h-3.5 opacity-50" />
            {emptyMessage ?? "No data available"}
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function TrendIcon({ trend }: { trend: string | null | undefined }) {
  if (!trend) return null;
  const t = trend.toLowerCase();
  if (t.includes("fall") || t.includes("declin")) return <TrendingDown className="w-4 h-4 text-amber-500" />;
  if (t.includes("ris") || t.includes("charg")) return <TrendingUp className="w-4 h-4 text-emerald-500" />;
  return <Minus className="w-4 h-4 text-muted-foreground" />;
}

export function ESenseCharts({ assetId }: { assetId: string }) {
  const [days, setDays] = useState(3);

  const { data, isLoading } = useGetESenseCharts(
    assetId,
    { days },
    {
      query: {
        queryKey: [...getGetESenseChartsQueryKey(assetId, { days }), days],
        staleTime: 0,
        refetchOnMount: "always",
      },
    },
  );

  const tickColor = "hsl(var(--muted-foreground))";
  const gridColor = "hsl(var(--border))";

  const hasChlorine =
    data?.tankHeight.some((p) => p.chlorineTank != null && p.chlorineTank > 0) ?? false;

  const tankTicks = data?.tankHeight
    .filter((_, i, arr) => {
      if (arr.length <= 12) return true;
      const step = Math.ceil(arr.length / 8);
      return i % step === 0;
    })
    .map((p) => p.time) ?? [];

  const inflowTicks = data?.dailyInflow
    .filter((_, i, arr) => {
      if (arr.length <= 12) return true;
      const step = Math.ceil(arr.length / 8);
      return i % step === 0;
    })
    .map((p) => p.date) ?? [];

  return (
    <div className="space-y-3">
      {/* Header + range selector */}
      <div className="flex items-center justify-between px-0.5">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-muted-foreground" />
          <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            eSense Charts
          </h3>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className={cn(
            "text-xs rounded-md border border-input bg-background px-2 py-1",
            "text-foreground focus:outline-none focus:ring-1 focus:ring-ring",
          )}
        >
          {RANGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Tank Height Chart */}
      {isLoading ? (
        <Skeleton className="h-52 w-full rounded-xl" />
      ) : (
        <ChartSection
          title="Tank Height"
          icon={<Droplets className="w-3.5 h-3.5" />}
          isEmpty={!data?.tankHeight.length}
          emptyMessage="No tank height data for this period"
        >
          <ResponsiveContainer width="100%" height={200}>
            <LineChart
              data={data?.tankHeight}
              margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis
                dataKey="time"
                ticks={tankTicks}
                tickFormatter={(v) => formatAxisTime(v, days)}
                tick={{ fontSize: 9, fill: tickColor }}
                interval="preserveStartEnd"
              />
              <YAxis
                unit="m"
                tick={{ fontSize: 9, fill: tickColor }}
                width={48}
                tickFormatter={(v) => Number(v).toFixed(2)}
              />
              <Tooltip
                labelFormatter={(v) => formatTooltipTime(String(v))}
                formatter={(value: unknown, name: string) => [
                  value != null ? `${Number(value).toFixed(3)} m` : "—",
                  name,
                ]}
                contentStyle={{
                  fontSize: 11,
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 6,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line
                type="monotone"
                dataKey="waterTank"
                stroke="#4D9DE0"
                name="Water Tank (vsen1)"
                dot={false}
                strokeWidth={1.5}
                connectNulls
              />
              {hasChlorine && (
                <Line
                  type="monotone"
                  dataKey="chlorineTank"
                  stroke="#3BB273"
                  name="Chlorine Tank (vsen2)"
                  dot={false}
                  strokeWidth={1.5}
                  connectNulls
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </ChartSection>
      )}

      {/* Daily Inflow Histogram */}
      {isLoading ? (
        <Skeleton className="h-52 w-full rounded-xl" />
      ) : (
        <ChartSection
          title="Daily Water Inflow"
          icon={<Droplets className="w-3.5 h-3.5" />}
          isEmpty={!data?.dailyInflow.length}
          emptyMessage="No inflow data for this period"
        >
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={data?.dailyInflow}
              margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis
                dataKey="date"
                ticks={inflowTicks}
                tickFormatter={formatAxisDate}
                tick={{ fontSize: 9, fill: tickColor }}
                interval="preserveStartEnd"
              />
              <YAxis
                unit="L"
                tick={{ fontSize: 9, fill: tickColor }}
                width={52}
                tickFormatter={(v) => {
                  const n = Number(v);
                  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));
                }}
              />
              <Tooltip
                labelFormatter={formatAxisDate}
                formatter={(value: unknown) => [
                  value != null ? `${Number(value).toLocaleString()} L` : "—",
                  "Inflow",
                ]}
                contentStyle={{
                  fontSize: 11,
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 6,
                }}
              />
              <Bar dataKey="litres" fill="#4D9DE0" name="Litres" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartSection>
      )}

      {/* Voltage */}
      {isLoading ? (
        <Skeleton className="h-36 w-full rounded-xl" />
      ) : (
        <ChartSection
          title="Battery Voltage"
          icon={<Zap className="w-3.5 h-3.5" />}
          isEmpty={!data?.voltageStatus && !data?.voltageHistory.length}
          emptyMessage="Voltage data unavailable"
        >
          {data?.voltageStatus && (
            <div className="px-2">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-3xl font-bold font-mono">
                  {data.voltageStatus.current != null
                    ? `${data.voltageStatus.current}V`
                    : "—"}
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">
                    {data.voltageStatus.trend ?? ""}
                  </span>
                  <TrendIcon trend={data.voltageStatus.trend} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 bg-muted/40 rounded-lg px-3 py-2 text-center">
                <div>
                  <span className="text-[10px] text-muted-foreground block mb-0.5">
                    Today High
                  </span>
                  <span className="text-xs font-mono font-medium text-emerald-600 dark:text-emerald-400">
                    {data.voltageStatus.todayHigh != null
                      ? `${data.voltageStatus.todayHigh}V`
                      : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground block mb-0.5">
                    Today Avg
                  </span>
                  <span className="text-xs font-mono font-medium">
                    {data.voltageStatus.todayAverage != null
                      ? `${data.voltageStatus.todayAverage}V`
                      : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground block mb-0.5">
                    Today Low
                  </span>
                  <span className="text-xs font-mono font-medium text-amber-600 dark:text-amber-400">
                    {data.voltageStatus.todayLow != null
                      ? `${data.voltageStatus.todayLow}V`
                      : "—"}
                  </span>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground text-center mt-2 px-1">
                Historical voltage time-series not available via API — showing today's snapshot
              </p>
            </div>
          )}
        </ChartSection>
      )}
    </div>
  );
}
