import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Droplet, BarChart2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface DisbursementDay {
  date: string;
  readingCount: number;
  estimateTotalLitres: number;
  totalSeconds: number;
  totalTicks: number;
  totalCredits: number | null;
  longFlowLitres: number;
  longFlowSeconds: number;
}

interface DisbursementsResult {
  requestedStart: string;
  requestedEnd: string;
  aggregationWindow: string;
  days: DisbursementDay[];
  totalLitres: number;
  totalReadings: number;
}

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function secsToDisplay(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export function DisbursementsPanel({
  url,
  days = 30,
}: {
  url: string;
  days?: number;
}) {
  const [data, setData] = useState<DisbursementsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    const fullUrl = `${url}${url.includes("?") ? "&" : "?"}days=${days}`;
    fetch(fullUrl)
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then((d: DisbursementsResult) => setData(d))
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [url, days]);

  if (loading) {
    return (
      <div className="p-4 space-y-2">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-5 w-3/5" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="px-4 py-6 text-center text-xs text-muted-foreground">
        Could not load disbursement data
      </div>
    );
  }

  if (data.days.length === 0) {
    return (
      <div className="px-4 py-6 text-center">
        <Droplet className="w-5 h-5 mx-auto mb-2 text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground">No disbursements in the last {days} days</p>
      </div>
    );
  }

  const sortedDays = [...data.days].reverse();

  return (
    <div>
      <div className="flex items-center gap-6 px-4 py-2 border-b border-border/40 bg-muted/20">
        <div className="flex items-center gap-1.5">
          <Droplet className="w-3.5 h-3.5 text-blue-500/70" />
          <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
            {data.totalLitres.toFixed(1)} L
          </span>
          <span className="text-xs text-muted-foreground">total</span>
        </div>
        <div className="flex items-center gap-1.5">
          <BarChart2 className="w-3.5 h-3.5 text-muted-foreground/60" />
          <span className="text-xs text-muted-foreground">
            {data.totalReadings} {data.totalReadings === 1 ? "dispense" : "dispenses"}
          </span>
        </div>
        <div className="text-xs text-muted-foreground ml-auto">
          {sortedDays.length} {sortedDays.length === 1 ? "day" : "days"} active
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/40 bg-muted/10">
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Date</th>
              <th className="px-4 py-2 text-right font-medium text-muted-foreground">Dispenses</th>
              <th className="px-4 py-2 text-right font-medium text-muted-foreground">Litres</th>
              <th className="px-4 py-2 text-right font-medium text-muted-foreground">Duration</th>
              <th className="px-4 py-2 text-right font-medium text-muted-foreground">Credits</th>
            </tr>
          </thead>
          <tbody>
            {sortedDays.map((d, i) => (
              <tr key={i} className="border-b border-border/30 last:border-0 hover:bg-muted/10">
                <td className="px-4 py-2 font-mono text-muted-foreground whitespace-nowrap">
                  {formatDateShort(d.date)}
                </td>
                <td className="px-4 py-2 text-right font-mono">{d.readingCount}</td>
                <td className="px-4 py-2 text-right font-mono">
                  <span className="text-blue-600 dark:text-blue-400">
                    {d.estimateTotalLitres.toFixed(2)}
                  </span>
                </td>
                <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                  {secsToDisplay(d.totalSeconds)}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {d.totalCredits != null ? (
                    <span
                      className={cn(
                        d.totalCredits > 0
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground/40",
                      )}
                    >
                      {d.totalCredits > 0 ? d.totalCredits.toFixed(3) : "0"}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/30 text-[10px]">no credit</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
