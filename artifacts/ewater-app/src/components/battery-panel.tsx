import { useState } from "react";
import {
  useGetESenseCharts,
  getGetESenseChartsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import {
  Battery,
  TrendingDown,
  TrendingUp,
  Minus,
  Info,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from "lucide-react";

// ─── types ────────────────────────────────────────────────────────────────────

type HealthScore = "good" | "fair" | "poor" | "critical" | "unknown";

interface BatteryHealth {
  score: HealthScore;
  label: string;
  slopePer30d: number | null;
  minV: number | null;
  maxV: number | null;
  avgV: number | null;
  dataPoints: number;
  spanDays: number;
}

interface TechBattery {
  batteryVoltage?: number | null;
  batteryTrend?: string | null;
  batteryTodayHigh?: number | null;
  batteryTodayLow?: number | null;
  lowBatteryEventCount?: number | null;
}

// ─── health computation ───────────────────────────────────────────────────────

function linearSlopePer30d(points: { ts: number; v: number }[]): number {
  const n = points.length;
  if (n < 2) return 0;
  const meanTs = points.reduce((s, p) => s + p.ts, 0) / n;
  const meanV = points.reduce((s, p) => s + p.v, 0) / n;
  const num = points.reduce((s, p) => s + (p.ts - meanTs) * (p.v - meanV), 0);
  const den = points.reduce((s, p) => s + (p.ts - meanTs) ** 2, 0);
  if (den === 0) return 0;
  const slopePerMs = num / den;
  return slopePerMs * 30 * 24 * 3600 * 1000;
}

function computeHealth(
  voltageHistory: { time: string; value: number }[],
): BatteryHealth {
  if (voltageHistory.length < 2) {
    return {
      score: "unknown", label: "Unknown",
      slopePer30d: null, minV: null, maxV: null, avgV: null,
      dataPoints: voltageHistory.length, spanDays: 0,
    };
  }

  const pts = voltageHistory.map((p) => ({
    ts: new Date(p.time).getTime(),
    v: p.value,
  }));

  const spanDays = (pts[pts.length - 1]!.ts - pts[0]!.ts) / 86400000;
  const voltages = pts.map((p) => p.v);
  const minV = Math.min(...voltages);
  const maxV = Math.max(...voltages);
  const avgV = voltages.reduce((s, v) => s + v, 0) / voltages.length;

  // Trend: use daily FLOOR voltages to strip solar charging peaks.
  // A raw linear regression on all readings will show a spurious negative slope
  // whenever morning charge peaks appear early in the window — daily minimums
  // reflect resting/nighttime state which is what actually degrades.
  let slopePer30d: number | null = null;
  if (spanDays >= 3) {
    const byDay = new Map<string, number>();
    for (const p of pts) {
      const day = new Date(p.ts).toISOString().slice(0, 10);
      const cur = byDay.get(day);
      byDay.set(day, cur == null ? p.v : Math.min(cur, p.v));
    }
    const floors = Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, v]) => ({ ts: new Date(day).getTime(), v }));
    if (floors.length >= 3) {
      slopePer30d = linearSlopePer30d(floors);
    }
  }

  // Voltage floor score — calibrated for LiFePO4 (12 V nominal).
  // LiFePO4 rest voltage at >80% SoC: ~13.0–13.4 V.
  // Lead-acid equivalent thresholds are similar at the low end.
  const levelScore: HealthScore =
    minV < 11.2 ? "critical" :
    minV < 12.0 ? "poor" :
    minV < 12.8 ? "fair" :
    "good";

  // Trend score — relaxed to tolerate solar-cycle noise.
  // Meaningful degradation for a properly-matched solar setup is > 0.5 V/30d.
  const trendScore: HealthScore =
    slopePer30d == null ? "good" :
    slopePer30d < -1.5 ? "critical" :
    slopePer30d < -0.5 ? "poor" :
    slopePer30d < -0.2 ? "fair" :
    "good";

  const ORDER: HealthScore[] = ["good", "fair", "poor", "critical"];
  const score = ORDER[Math.max(ORDER.indexOf(levelScore), ORDER.indexOf(trendScore))] ?? "good";
  const label = score === "good" ? "Good" : score === "fair" ? "Fair" : score === "poor" ? "Poor" : "Critical";

  return { score, label, slopePer30d, minV, maxV, avgV, dataPoints: pts.length, spanDays };
}

// ─── health badge ─────────────────────────────────────────────────────────────

function healthStyles(score: HealthScore) {
  switch (score) {
    case "good":     return { badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20", dot: "bg-emerald-500" };
    case "fair":     return { badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20", dot: "bg-amber-500" };
    case "poor":     return { badge: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20", dot: "bg-orange-500" };
    case "critical": return { badge: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20", dot: "bg-red-500" };
    default:         return { badge: "bg-muted/60 text-muted-foreground border-border", dot: "bg-muted-foreground/40" };
  }
}

function HealthBadge({ health, onClick }: { health: BatteryHealth; onClick: () => void }) {
  const styles = healthStyles(health.score);
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border transition-opacity hover:opacity-80",
        styles.badge,
      )}
      title="Battery health — click for details"
    >
      <span className={cn("w-1.5 h-1.5 rounded-full inline-block shrink-0", styles.dot)} />
      {health.label}
      <Info className="w-2.5 h-2.5 opacity-60 shrink-0" />
    </button>
  );
}

// ─── health dialog ────────────────────────────────────────────────────────────

function HealthDialog({
  open,
  onClose,
  health,
  tech,
}: {
  open: boolean;
  onClose: () => void;
  health: BatteryHealth;
  tech: TechBattery;
}) {
  const styles = healthStyles(health.score);

  const slopeDisplay = health.slopePer30d != null
    ? `${health.slopePer30d >= 0 ? "+" : ""}${health.slopePer30d.toFixed(2)} V / 30 days`
    : health.spanDays < 3 ? "need ≥ 3 days of data" : "insufficient data";

  const slopeDesc = health.slopePer30d == null
    ? "Trend requires at least 3 days of readings. Check back once more data is collected."
    : health.slopePer30d < -1.5 ? "Rapid decline — battery may be failing or consistently under-charged."
    : health.slopePer30d < -0.5 ? "Significant decline — investigate charging system or increased load."
    : health.slopePer30d < -0.2 ? "Mild decline — worth monitoring over the next few weeks."
    : health.slopePer30d < 0.05 ? "Stable — resting voltage floor is holding steady."
    : "Improving — resting voltage is rising (good solar charging or recovery).";

  const actionText: Record<HealthScore, string> = {
    good:     "No action required. Battery is maintaining healthy charge levels.",
    fair:     "Monitor over the coming weeks. If the floor voltage keeps dropping, check the solar panel and connections.",
    poor:     "Schedule a maintenance visit. The battery may be under-charged, overloaded, or showing early wear.",
    critical: "Urgent attention needed. The battery is critically low or declining rapidly — risk of permanent damage.",
    unknown:  "Collect more data — check back after the device has been operating for at least 3 days.",
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm mx-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Battery className="w-4 h-4" />
            Battery Health
          </DialogTitle>
        </DialogHeader>

        {/* Score */}
        <div className={cn("flex items-center gap-2 px-3 py-2.5 rounded-lg border", styles.badge)}>
          <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", styles.dot)} />
          <span className="font-semibold text-sm">{health.label}</span>
        </div>

        {/* Readings */}
        <div className="bg-muted/40 rounded-lg px-3 py-2.5 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Readings ({health.spanDays > 0 ? `${Math.round(health.spanDays)}d period, ${health.dataPoints} packets` : "current"})
          </p>
          {tech.batteryVoltage != null && (
            <Row label="Current" value={`${tech.batteryVoltage} V`} />
          )}
          {health.minV != null && <Row label="Period min" value={`${health.minV.toFixed(2)} V`} highlight="amber" />}
          {health.maxV != null && <Row label="Period max" value={`${health.maxV.toFixed(2)} V`} highlight="emerald" />}
          {health.avgV != null && <Row label="Period avg" value={`${health.avgV.toFixed(2)} V`} />}
          <Row label="Trend" value={slopeDisplay} />
          <p className="text-[10px] text-muted-foreground mt-1">{slopeDesc}</p>
          {tech.lowBatteryEventCount != null && tech.lowBatteryEventCount > 0 && (
            <Row label="Low battery events today" value={String(tech.lowBatteryEventCount)} highlight="amber" />
          )}
        </div>

        {/* How it's calculated */}
        <div className="space-y-2">
          <p className="text-xs font-medium">How is health calculated?</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Health combines two signals decoded directly from EWC2.5 DATALOG packets:
          </p>
          <ul className="text-xs text-muted-foreground space-y-1 ml-3">
            <li><span className="font-medium text-foreground">Voltage floor</span> — the lowest voltage in the period. For LiFePO4, a healthy resting voltage is ≥ 12.8 V (≈ 80–100% SoC).</li>
            <li><span className="font-medium text-foreground">Resting trend</span> — slope of the daily minimum voltage over time. Solar charging naturally spikes readings during the day, so only nighttime floor values are used to avoid false signals.</li>
          </ul>

          <div className="mt-2 space-y-1">
            {(["good", "fair", "poor", "critical"] as HealthScore[]).map((s) => {
              const st = healthStyles(s);
              const Icon = s === "good" ? CheckCircle2 : s === "fair" ? Minus : s === "poor" ? AlertTriangle : XCircle;
              return (
                <div key={s} className="flex items-start gap-2">
                  <Icon className={cn("w-3 h-3 mt-0.5 shrink-0", s === "good" ? "text-emerald-500" : s === "fair" ? "text-amber-500" : s === "poor" ? "text-orange-500" : "text-red-500")} />
                  <div>
                    <span className={cn("text-[10px] font-semibold border px-1 rounded", st.badge)}>{s.charAt(0).toUpperCase() + s.slice(1)}</span>
                    <span className="text-[10px] text-muted-foreground ml-1.5">
                      {s === "good" ? "Floor ≥ 12.8 V, trend ≥ −0.2 V/30d" :
                       s === "fair" ? "Floor ≥ 12.0 V, trend ≥ −0.5 V/30d" :
                       s === "poor" ? "Floor ≥ 11.2 V, trend ≥ −1.5 V/30d" :
                       "Floor < 11.2 V or trend < −1.5 V/30d"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Action */}
        <div className={cn("text-xs px-3 py-2 rounded-lg border", styles.badge)}>
          <span className="font-medium">Recommended action: </span>
          {actionText[health.score]}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: "amber" | "emerald" }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={cn(
        "text-xs font-mono font-medium",
        highlight === "amber" && "text-amber-600 dark:text-amber-400",
        highlight === "emerald" && "text-emerald-600 dark:text-emerald-400",
      )}>
        {value}
      </span>
    </div>
  );
}

// ─── axis / tooltip helpers ───────────────────────────────────────────────────

function fmtAxisTs(ts: number, days: number): string {
  const d = new Date(ts);
  if (days <= 3) {
    return d.toLocaleString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return d.toLocaleString("en-GB", { month: "short", day: "numeric" });
}

function fmtTooltip(ts: number): string {
  return new Date(ts).toLocaleString("en-GB", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function getMidnights(startTs: number, endTs: number): { ts: number; midnight: boolean }[] {
  const out: { ts: number; midnight: boolean }[] = [];
  const start = new Date(startTs);
  start.setHours(0, 0, 0, 0);
  for (let d = new Date(start); d.getTime() <= endTs; d.setDate(d.getDate() + 1)) {
    for (const h of [0, 6, 12, 18]) {
      const t = new Date(d);
      t.setHours(h, 0, 0, 0);
      const ts = t.getTime();
      if (ts >= startTs && ts <= endTs) out.push({ ts, midnight: h === 0 });
    }
  }
  return out;
}

const RANGE_OPTIONS = [
  { label: "1d", value: 1 },
  { label: "3d", value: 3 },
  { label: "7d", value: 7 },
  { label: "1mo", value: 30 },
  { label: "2mo", value: 60 },
  { label: "6mo", value: 180 },
];

// ─── main exported component ──────────────────────────────────────────────────

export function BatteryPanel({
  assetId,
  tech,
}: {
  assetId: string;
  tech: TechBattery;
}) {
  const [days, setDays] = useState(7);
  const [healthDialogOpen, setHealthDialogOpen] = useState(false);

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

  const voltagePoints = (data?.voltageHistory ?? []).map((p) => ({
    ts: new Date(p.time).getTime(),
    voltage: p.value,
  }));

  const health = computeHealth(data?.voltageHistory ?? []);

  const voltStartTs = voltagePoints[0]?.ts ?? Date.now() - days * 86400000;
  const voltEndTs = voltagePoints[voltagePoints.length - 1]?.ts ?? Date.now();
  const refLines = days < 30 ? getMidnights(voltStartTs, voltEndTs) : [];

  const voltXTicks = voltagePoints
    .filter((_, i, arr) => {
      if (arr.length <= 12) return true;
      const step = Math.ceil(arr.length / 8);
      return i % step === 0;
    })
    .map((p) => p.ts);

  const allV = voltagePoints.map((p) => p.voltage);
  const minV = allV.length ? Math.min(...allV) : null;
  const maxV = allV.length ? Math.max(...allV) : null;
  const domainMin = minV != null ? Math.floor(minV - 0.3) : 0;
  const domainMax = maxV != null ? Math.ceil(maxV + 0.3) : 20;

  const tickColor = "hsl(var(--muted-foreground))";
  const gridColor = "hsl(var(--border))";
  const refLineColor = "hsl(var(--muted-foreground) / 0.35)";
  const midnightLineColor = "#6366f1";

  const { batteryVoltage, batteryTrend, batteryTodayHigh, batteryTodayLow, lowBatteryEventCount } = tech;

  function TrendIconInline({ trend }: { trend: string | null | undefined }) {
    if (!trend) return null;
    const t = trend.toLowerCase();
    if (t.includes("fall") || t.includes("declin")) return <TrendingDown className="w-3.5 h-3.5 text-amber-500" />;
    if (t.includes("ris") || t.includes("charg")) return <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />;
    return <Minus className="w-3.5 h-3.5 text-muted-foreground" />;
  }

  return (
    <>
      <Card className="shadow-sm border">
        <CardHeader className="py-3 px-4 border-b border-border/50">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Battery className="w-3.5 h-3.5" />
            Battery
            <div className="flex-1" />
            {data != null && (
              <HealthBadge health={health} onClick={() => setHealthDialogOpen(true)} />
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 py-1">

          {/* Current voltage + trend */}
          <div className="py-3 flex items-center justify-between">
            <div>
              <span className="text-3xl font-bold font-mono">
                {batteryVoltage != null ? `${batteryVoltage}V` : "—"}
              </span>
              {batteryTrend && (
                <span className="ml-2 text-xs text-muted-foreground">{batteryTrend}</span>
              )}
            </div>
            {batteryTrend && <TrendIconInline trend={batteryTrend} />}
          </div>

          {/* Today high / low */}
          {(batteryTodayHigh != null || batteryTodayLow != null) && (
            <div className="flex gap-4 mb-2 bg-muted/40 rounded-lg px-3 py-2">
              <div>
                <span className="text-[10px] text-muted-foreground block">Today high</span>
                <span className="text-xs font-mono font-medium text-emerald-600 dark:text-emerald-400">
                  {batteryTodayHigh != null ? `${batteryTodayHigh}V` : "—"}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground block">Today low</span>
                <span className="text-xs font-mono font-medium text-amber-600 dark:text-amber-400">
                  {batteryTodayLow != null ? `${batteryTodayLow}V` : "—"}
                </span>
              </div>
              {lowBatteryEventCount != null && (
                <div>
                  <span className="text-[10px] text-muted-foreground block">Low events</span>
                  <span className="text-xs font-mono font-medium">{lowBatteryEventCount}</span>
                </div>
              )}
            </div>
          )}

          {/* Voltage chart */}
          <div className="mt-2 mb-3">
              {/* Range selector */}
              <div className="flex items-center gap-1 mb-2 flex-wrap">
                {RANGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setDays(opt.value)}
                    className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded border transition-colors",
                      days === opt.value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "text-muted-foreground border-border hover:border-foreground/30",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {isLoading ? (
                <Skeleton className="h-40 w-full rounded-lg" />
              ) : voltagePoints.length === 0 ? (
                <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">
                  No voltage data for this period
                </div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart
                      data={voltagePoints}
                      margin={{ top: 4, right: 8, left: -12, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                      <XAxis
                        dataKey="ts"
                        type="number"
                        scale="time"
                        domain={[voltStartTs, voltEndTs]}
                        ticks={voltXTicks}
                        tickFormatter={(v) => fmtAxisTs(v as number, days)}
                        tick={{ fontSize: 9, fill: tickColor }}
                      />
                      <YAxis
                        unit="V"
                        domain={[domainMin, domainMax]}
                        tick={{ fontSize: 9, fill: tickColor }}
                        width={44}
                        tickFormatter={(v) => Number(v).toFixed(1)}
                      />
                      <Tooltip
                        labelFormatter={(v) => fmtTooltip(v as number)}
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
                      {refLines.map(({ ts, midnight }) => (
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
                        dot={false}
                        strokeWidth={1.5}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>

                  {/* Period min / max stats */}
                  <div className="flex gap-4 mt-2 px-1">
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Period max</span>
                      <span className="text-xs font-mono font-medium text-emerald-600 dark:text-emerald-400">
                        {maxV != null ? `${maxV.toFixed(2)} V` : "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Period min</span>
                      <span className="text-xs font-mono font-medium text-amber-600 dark:text-amber-400">
                        {minV != null ? `${minV.toFixed(2)} V` : "—"}
                      </span>
                    </div>
                    {health.slopePer30d != null && (
                      <div>
                        <span className="text-[10px] text-muted-foreground block">Trend</span>
                        <span className={cn(
                          "text-xs font-mono font-medium",
                          health.slopePer30d < -0.25 ? "text-red-500" :
                          health.slopePer30d < -0.05 ? "text-amber-600 dark:text-amber-400" :
                          "text-emerald-600 dark:text-emerald-400",
                        )}>
                          {health.slopePer30d >= 0 ? "+" : ""}{health.slopePer30d.toFixed(2)} V/30d
                        </span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

        </CardContent>
      </Card>

      <HealthDialog
        open={healthDialogOpen}
        onClose={() => setHealthDialogOpen(false)}
        health={health}
        tech={tech}
      />
    </>
  );
}
