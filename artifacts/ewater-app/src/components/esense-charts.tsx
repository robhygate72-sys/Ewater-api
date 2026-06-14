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
import { Activity, Droplets, Zap, AlertCircle } from "lucide-react";

const RANGE_OPTIONS = [
  { label: "1 day", value: 1 },
  { label: "3 days", value: 3 },
  { label: "7 days", value: 7 },
  { label: "1 month", value: 30 },
  { label: "2 months", value: 60 },
  { label: "6 months", value: 180 },
];

function formatAxisTs(ts: number, days: number): string {
  const d = new Date(ts);
  if (days <= 3) {
    return d.toLocaleString("en-GB", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  return d.toLocaleString("en-GB", { month: "short", day: "numeric" });
}

function formatAxisDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleString("en-GB", { month: "short", day: "numeric" });
}

function formatTooltipTs(ts: number): string {
  return new Date(ts).toLocaleString("en-GB", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function getHourRefTimes(
  startTs: number,
  endTs: number,
): { ts: number; midnight: boolean }[] {
  const out: { ts: number; midnight: boolean }[] = [];
  const start = new Date(startTs);
  start.setHours(0, 0, 0, 0);
  for (
    let d = new Date(start);
    d.getTime() <= endTs;
    d.setDate(d.getDate() + 1)
  ) {
    for (const h of [0, 6, 12, 18]) {
      const t = new Date(d);
      t.setHours(h, 0, 0, 0);
      const ts = t.getTime();
      if (ts >= startTs && ts <= endTs) out.push({ ts, midnight: h === 0 });
    }
  }
  return out;
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
  const refLineColor = "hsl(var(--muted-foreground) / 0.35)";
  const midnightLineColor = "#6366f1";

  const hasChlorine =
    data?.tankHeight.some(
      (p) => p.chlorineTank != null && p.chlorineTank > 0,
    ) ?? false;

  const tankData = (data?.tankHeight ?? []).map((p) => ({
    ...p,
    ts: new Date(p.time).getTime(),
  }));

  const tankStartTs = tankData[0]?.ts ?? Date.now() - days * 86400000;
  const tankEndTs = tankData[tankData.length - 1]?.ts ?? Date.now();
  const tankRefLines = getHourRefTimes(tankStartTs, tankEndTs);

  const tankXTicks = tankData
    .filter((_, i, arr) => {
      if (arr.length <= 12) return true;
      const step = Math.ceil(arr.length / 8);
      return i % step === 0;
    })
    .map((p) => p.ts);

  const inflowTicks = (data?.dailyInflow ?? [])
    .filter((_, i, arr) => {
      if (arr.length <= 12) return true;
      const step = Math.ceil(arr.length / 8);
      return i % step === 0;
    })
    .map((p) => p.date);

  const vs = data?.voltageStatus;
  const nowTs = Date.now();
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const voltageLineData = vs
    ? [
        {
          ts: todayMidnight.getTime() + 6 * 3600000,
          voltage: vs.todayLow,
          label: "Day Low",
        },
        {
          ts: todayMidnight.getTime() + 12 * 3600000,
          voltage: vs.todayAverage,
          label: "Day Avg",
        },
        {
          ts: todayMidnight.getTime() + 14 * 3600000,
          voltage: vs.todayHigh,
          label: "Day High",
        },
        { ts: nowTs, voltage: vs.current, label: "Current" },
      ].sort((a, b) => a.ts - b.ts)
    : [];
  const voltageRefLines = getHourRefTimes(
    todayMidnight.getTime(),
    nowTs,
  );
  const voltageMin = vs
    ? Math.floor(Math.min(vs.todayLow ?? 99, vs.current ?? 99) - 0.5)
    : 0;
  const voltageMax = vs
    ? Math.ceil(Math.max(vs.todayHigh ?? 0, vs.current ?? 0) + 0.5)
    : 20;

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
          isEmpty={!tankData.length}
          emptyMessage="No tank height data for this period"
        >
          <ResponsiveContainer width="100%" height={200}>
            <LineChart
              data={tankData}
              margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={[tankStartTs, tankEndTs]}
                ticks={tankXTicks}
                tickFormatter={(v) => formatAxisTs(v as number, days)}
                tick={{ fontSize: 9, fill: tickColor }}
              />
              <YAxis
                unit="m"
                tick={{ fontSize: 9, fill: tickColor }}
                width={48}
                tickFormatter={(v) => Number(v).toFixed(2)}
              />
              <Tooltip
                labelFormatter={(v) => formatTooltipTs(v as number)}
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
              {tankRefLines.map(({ ts, midnight }) => (
                <ReferenceLine
                  key={ts}
                  x={ts}
                  stroke={midnight ? midnightLineColor : refLineColor}
                  strokeWidth={midnight ? 1.5 : 1}
                  strokeDasharray={midnight ? "4 3" : "2 3"}
                />
              ))}
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

      {/* Water Usage */}
      {isLoading ? (
        <Skeleton className="h-52 w-full rounded-xl" />
      ) : (
        <ChartSection
          title="Water Usage"
          icon={<Droplets className="w-3.5 h-3.5" />}
          isEmpty={!data?.dailyInflow.length}
          emptyMessage="No water usage data for this period"
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
                  return n >= 1000
                    ? `${(n / 1000).toFixed(1)}k`
                    : String(Math.round(n));
                }}
              />
              <Tooltip
                labelFormatter={formatAxisDate}
                formatter={(value: unknown) => [
                  value != null ? `${Number(value).toLocaleString()} L` : "—",
                  "Usage",
                ]}
                contentStyle={{
                  fontSize: 11,
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 6,
                }}
              />
              <Bar
                dataKey="litres"
                fill="#4D9DE0"
                name="Litres"
                radius={[2, 2, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartSection>
      )}

      {/* Battery Voltage Line Chart */}
      {isLoading ? (
        <Skeleton className="h-52 w-full rounded-xl" />
      ) : (
        <ChartSection
          title="Battery Voltage"
          icon={<Zap className="w-3.5 h-3.5" />}
          isEmpty={!vs}
          emptyMessage="Voltage data unavailable"
        >
          <ResponsiveContainer width="100%" height={200}>
            <LineChart
              data={voltageLineData}
              margin={{ top: 4, right: 8, left: -12, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={[
                  todayMidnight.getTime(),
                  todayMidnight.getTime() + 24 * 3600000,
                ]}
                ticks={[
                  todayMidnight.getTime(),
                  todayMidnight.getTime() + 6 * 3600000,
                  todayMidnight.getTime() + 12 * 3600000,
                  todayMidnight.getTime() + 18 * 3600000,
                  todayMidnight.getTime() + 24 * 3600000,
                ]}
                tickFormatter={(v) =>
                  new Date(v as number).toLocaleString("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })
                }
                tick={{ fontSize: 9, fill: tickColor }}
              />
              <YAxis
                unit="V"
                domain={[voltageMin, voltageMax]}
                tick={{ fontSize: 9, fill: tickColor }}
                width={44}
                tickFormatter={(v) => Number(v).toFixed(1)}
              />
              <Tooltip
                labelFormatter={(v) =>
                  new Date(v as number).toLocaleString("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })
                }
                formatter={(value: unknown) => [
                  value != null ? `${Number(value).toFixed(2)} V` : "—",
                  "Voltage",
                ]}
                contentStyle={{
                  fontSize: 11,
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 6,
                }}
              />
              {voltageRefLines.map(({ ts, midnight }) => (
                <ReferenceLine
                  key={ts}
                  x={ts}
                  stroke={midnight ? midnightLineColor : refLineColor}
                  strokeWidth={midnight ? 1.5 : 1}
                  strokeDasharray={midnight ? "4 3" : "2 3"}
                />
              ))}
              <Line
                type="monotone"
                dataKey="voltage"
                stroke="#F5A623"
                name="Voltage"
                dot={{ r: 4, fill: "#F5A623" }}
                strokeWidth={2}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-muted-foreground text-center mt-1 px-2">
            Today's low / avg / high / current — the eWater API does not expose per-day voltage history
          </p>
        </ChartSection>
      )}
    </div>
  );
}
