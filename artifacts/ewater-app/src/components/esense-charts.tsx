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
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import { Activity, Droplets, AlertCircle, TrendingUp, TrendingDown, Minus, Gauge } from "lucide-react";

interface LeakageRate {
  date: string;
  ratePerHour: number | null;
}

function computeLeakageRates(
  tankData: { ts: number; waterTank?: number | null }[],
): LeakageRate[] {
  const byNight = new Map<string, { ts: number; waterTank: number }[]>();

  for (const p of tankData) {
    if (p.waterTank == null) continue;
    const d = new Date(p.ts);
    const h = d.getHours();
    if (h >= 6) continue;
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!byNight.has(dateKey)) byNight.set(dateKey, []);
    byNight.get(dateKey)!.push({ ts: p.ts, waterTank: p.waterTank });
  }

  return [...byNight.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, points]) => {
      if (points.length < 2) return { date, ratePerHour: null };
      points.sort((a, b) => a.ts - b.ts);
      const first = points[0]!;
      const last = points[points.length - 1]!;
      const hoursDiff = (last.ts - first.ts) / 3600000;
      if (hoursDiff < 0.5) return { date, ratePerHour: null };
      const dropCm = (first.waterTank - last.waterTank) * 100;
      return { date, ratePerHour: dropCm / hoursDiff };
    });
}

function LeakageAnalysis({ tankData }: { tankData: { ts: number; waterTank?: number | null }[] }) {
  const all = computeLeakageRates(tankData);
  const rates = all.slice(-3);

  if (rates.length === 0) return null;

  function TrendIcon({ curr, prev }: { curr: number | null; prev: number | null }) {
    if (curr == null || prev == null) return <Minus className="w-3 h-3 text-muted-foreground" />;
    const delta = curr - prev;
    if (delta > 0.2) return <TrendingUp className="w-3 h-3 text-red-500" />;
    if (delta < -0.2) return <TrendingDown className="w-3 h-3 text-green-500" />;
    return <Minus className="w-3 h-3 text-muted-foreground" />;
  }

  return (
    <div className="mt-3 border-t border-border/50 pt-3 px-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Overnight Leakage (midnight–6 am)
      </p>
      <div className="space-y-1">
        {rates.map((r, i) => {
          const prev = rates[i - 1] ?? null;
          const isLatest = i === rates.length - 1;
          return (
            <div key={r.date} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground font-mono">
                {new Date(r.date + "T00:00:00").toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                })}
              </span>
              <div className="flex items-center gap-1.5">
                {r.ratePerHour != null ? (
                  <span
                    className={
                      isLatest
                        ? "font-mono font-semibold text-foreground"
                        : "font-mono text-muted-foreground"
                    }
                  >
                    {r.ratePerHour > 0
                      ? `↓ ${r.ratePerHour.toFixed(2)} cm/hr`
                      : r.ratePerHour < -0.05
                        ? `↑ ${Math.abs(r.ratePerHour).toFixed(2)} cm/hr (fill)`
                        : "≈ 0 cm/hr"}
                  </span>
                ) : (
                  <span className="font-mono text-muted-foreground">— no data</span>
                )}
                {isLatest && <TrendIcon curr={r.ratePerHour} prev={prev?.ratePerHour ?? null} />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

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

export function ESenseCharts({ assetId, isEsense = false }: { assetId: string; isEsense?: boolean }) {
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
  const tankRefLines = days < 30 ? getHourRefTimes(tankStartTs, tankEndTs) : [];

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

      {/* Tank Height Chart — eSense only */}
      {isEsense && (
        isLoading ? (
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
            <LeakageAnalysis tankData={tankData} />
          </ChartSection>
        )
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

      {/* Flow Rate */}
      {isLoading ? (
        <Skeleton className="h-52 w-full rounded-xl" />
      ) : (
        <FlowRateChart
          data={data?.flowRateHistory ?? []}
          days={days}
          tickColor={tickColor}
          gridColor={gridColor}
        />
      )}

    </div>
  );
}

// ─── Flow Rate Chart ───────────────────────────────────────────────────────────

interface FlowRatePoint {
  time: string;
  flowRate: number;
  ticks: number;
  flowTimeSec: number;
}

function FlowRateChart({
  data,
  days,
  tickColor,
  gridColor,
}: {
  data: FlowRatePoint[];
  days: number;
  tickColor: string;
  gridColor: string;
}) {
  if (data.length === 0) {
    return (
      <ChartSection
        title="Flow Rate"
        icon={<Gauge className="w-3.5 h-3.5" />}
        isEmpty
        emptyMessage="No DATALOG packets with FT > 10 s in this period"
      >
        {null}
      </ChartSection>
    );
  }

  // Convert to scatter-friendly format with numeric x (timestamp)
  const scatterData = data.map((p) => ({
    x: new Date(p.time).getTime(),
    y: p.flowRate,
    ticks: p.ticks,
    flowTimeSec: p.flowTimeSec,
  }));

  const allRates = data.map((p) => p.flowRate);
  const maxRate = Math.max(...allRates);
  const avgRate = allRates.reduce((a, b) => a + b, 0) / allRates.length;

  const xMin = scatterData[0]!.x;
  const xMax = scatterData[scatterData.length - 1]!.x;

  return (
    <ChartSection
      title="Flow Rate"
      icon={<Gauge className="w-3.5 h-3.5" />}
    >
      {/* Summary stats */}
      <div className="flex gap-4 px-2 mb-2">
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground">Events</p>
          <p className="text-xs font-semibold">{data.length}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground">Avg rate</p>
          <p className="text-xs font-semibold">{avgRate.toFixed(2)} L/min</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground">Peak rate</p>
          <p className="text-xs font-semibold text-blue-500">{maxRate.toFixed(2)} L/min</p>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={190}>
        <ScatterChart margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis
            dataKey="x"
            type="number"
            scale="time"
            domain={[xMin, xMax]}
            tickFormatter={(v) => formatAxisTs(v as number, days)}
            tick={{ fontSize: 9, fill: tickColor }}
            name="Time"
          />
          <YAxis
            dataKey="y"
            type="number"
            unit=" L/m"
            tick={{ fontSize: 9, fill: tickColor }}
            width={56}
            tickFormatter={(v) => Number(v).toFixed(2)}
            domain={[0, "auto"]}
            name="Flow rate"
          />
          <ZAxis range={[28, 28]} />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]!.payload as typeof scatterData[number];
              return (
                <div
                  style={{
                    fontSize: 11,
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    padding: "6px 10px",
                  }}
                >
                  <p className="font-medium">{formatTooltipTs(d.x)}</p>
                  <p>{d.y.toFixed(3)} L/min</p>
                  <p className="text-muted-foreground">{d.ticks} ticks · {d.flowTimeSec} s</p>
                </div>
              );
            }}
          />
          <Scatter
            data={scatterData}
            fill="#4D9DE0"
            opacity={0.75}
            name="Flow rate"
          />
        </ScatterChart>
      </ResponsiveContainer>

      <p className="text-[10px] text-muted-foreground px-2 pt-1">
        flow_rate = 60 × FCC / LCF · all DATALOG event types · filtered to FT &gt; 10 s
      </p>
    </ChartSection>
  );
}
