// Shared helpers + tiny presentational atoms for the HHC dashboard.
import type {
  ObservedField,
  ConnectivityEvaluationStatus,
  HealthEvaluationStatus,
} from "@workspace/api-client-react";
import { formatTimeAgo, formatDateTime } from "@/lib/date";
import { cn } from "@/lib/utils";

// ── Observed-field helpers ───────────────────────────────────────────────────

export type Section = Record<string, ObservedField | null | undefined>;

export function obs(section: Section | undefined, key: string): ObservedField | null {
  const f = section?.[key];
  return f ?? null;
}

export function obsNum(section: Section | undefined, key: string): number | null {
  const f = obs(section, key);
  return typeof f?.value === "number" ? f.value : null;
}

export function obsStr(section: Section | undefined, key: string): string | null {
  const f = obs(section, key);
  if (f == null) return null;
  if (typeof f.value === "boolean") return f.value ? "Yes" : "No";
  return String(f.value);
}

export function fmtVal(f: ObservedField | null, unit?: string, digits?: number): string {
  if (f == null) return "Not reported";
  let v: string;
  if (typeof f.value === "boolean") v = f.value ? "Yes" : "No";
  else if (typeof f.value === "number")
    v = digits != null ? f.value.toFixed(digits) : f.value.toLocaleString();
  else v = f.value;
  return unit && typeof f.value === "number" ? `${v} ${unit}` : v;
}

export function fmtSeconds(secs: number | null | undefined): string {
  if (secs == null) return "Not reported";
  if (secs % 3600 === 0) return `${secs / 3600} h`;
  if (secs % 60 === 0) return `${secs / 60} min`;
  return `${secs} s`;
}

// ── Status colors ────────────────────────────────────────────────────────────

export function connectivityColor(status: ConnectivityEvaluationStatus | undefined): string {
  switch (status) {
    case "healthy": return "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25";
    case "late": return "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/25";
    case "offline": return "text-destructive bg-destructive/10 border-destructive/25";
    default: return "text-muted-foreground bg-muted/40 border-border";
  }
}

export function healthColor(status: HealthEvaluationStatus | undefined): string {
  switch (status) {
    case "healthy": return "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25";
    case "warning": return "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/25";
    case "critical": return "text-destructive bg-destructive/10 border-destructive/25";
    default: return "text-muted-foreground bg-muted/40 border-border";
  }
}

// ── Atoms ────────────────────────────────────────────────────────────────────

export function StatusBadge({ label, className, testId }: { label: string; className?: string; testId?: string }) {
  return (
    <span
      data-testid={testId}
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap",
        className,
      )}
    >
      {label}
    </span>
  );
}

/** Value + "Observed X ago" freshness line, honest "Not reported" fallback. */
export function ObservedValue({ field, unit, digits, mono = false }: {
  field: ObservedField | null;
  unit?: string;
  digits?: number;
  mono?: boolean;
}) {
  if (field == null) {
    return <span className="text-xs text-muted-foreground italic">Not reported</span>;
  }
  return (
    <span className="inline-flex flex-col items-end">
      <span className={cn("text-xs font-medium", mono && "font-mono text-[11px] break-all")}>
        {fmtVal(field, unit, digits)}
      </span>
      <span className="text-[9px] text-muted-foreground" title={formatDateTime(field.observedAt)}>
        Observed {formatTimeAgo(field.observedAt)}
      </span>
    </span>
  );
}

export function InfoRow({ label, field, unit, digits, mono }: {
  label: string;
  field: ObservedField | null;
  unit?: string;
  digits?: number;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between items-start py-2 border-b border-border/30 last:border-0 gap-3">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <ObservedValue field={field} unit={unit} digits={digits} mono={mono} />
    </div>
  );
}

export function SectionCard({ title, children, actions }: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{title}</p>
        {actions}
      </div>
      {children}
    </div>
  );
}
