import { useQuery } from "@tanstack/react-query";
import { decodeEwcReply, type EwcReplyData } from "@/lib/ewc25";
import { ShieldAlert, Activity, Battery, Gauge, Lock, DoorOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTimeAgo } from "@/lib/date";

type GetStatus = Extract<EwcReplyData, { kind: "get-status" }>;

interface LogEntry {
  id: string;
  timestamp: string;
  protocol: string | null;
  message: string | null;
}
interface LogPage {
  entries: LogEntry[];
  nextBefore: string | null;
  hasMore: boolean;
}

const MAX_PAGES = 4;

function base64ToHex(b64: string): string {
  const bin = atob(b64);
  let out = "";
  for (let i = 0; i < bin.length; i++) {
    out += bin.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return out;
}

// Walk back through recent EWC log pages and return the most recent GetStatus reply.
async function findLatestGetStatus(
  assetId: string,
): Promise<{ status: GetStatus; timestamp: string } | null> {
  let before = new Date().toISOString();
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ before, limit: "50" });
    const res = await fetch(
      `/api/ewater/assets/${encodeURIComponent(assetId)}/logs?${params}`,
    );
    if (!res.ok) throw new Error("Failed to fetch logs");
    const data: LogPage = await res.json();
    for (const e of data.entries) {
      if (!e.message) continue;
      if (!(e.protocol ?? "").toLowerCase().startsWith("ewc")) continue;
      let hex: string;
      try {
        hex = base64ToHex(e.message);
      } catch {
        continue;
      }
      const decoded = decodeEwcReply(hex);
      if (decoded.valid && decoded.data.kind === "get-status") {
        return { status: decoded.data, timestamp: e.timestamp };
      }
    }
    if (!data.hasMore || !data.nextBefore) break;
    before = data.nextBefore;
  }
  return null;
}

function StatusRow({
  icon,
  label,
  value,
  alert = false,
  dim = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  alert?: boolean;
  dim?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-border/40 last:border-0">
      <span className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
        <span className={cn("shrink-0", alert ? "text-red-500" : "text-muted-foreground/70")}>
          {icon}
        </span>
        {label}
      </span>
      <span
        className={cn(
          "text-xs text-right font-medium",
          alert
            ? "text-red-600 dark:text-red-400 font-semibold"
            : dim
              ? "text-muted-foreground"
              : "",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function DeviceStatusCard({ assetId }: { assetId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["asset-get-status", assetId],
    queryFn: () => findLatestGetStatus(assetId),
    enabled: !!assetId,
    staleTime: 60_000,
  });

  const Header = (
    <div className="flex items-center justify-between mb-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Activity className="w-3.5 h-3.5" />
        Device Status
      </h3>
      {data && (
        <span className="text-[10px] text-muted-foreground/70 font-mono">
          {formatTimeAgo(data.timestamp)}
        </span>
      )}
    </div>
  );

  if (isLoading) {
    return (
      <div className="bg-card border rounded-xl p-4">
        {Header}
        <p className="text-xs text-muted-foreground/70 py-2">Reading latest GetStatus…</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="bg-card border rounded-xl p-4">
        {Header}
        <p className="text-xs text-muted-foreground/70 py-2">
          No recent GetStatus reply found.
        </p>
      </div>
    );
  }

  const s = data.status;
  const noTag = s.uid === "00000000";
  const valveOpenAlert = noTag && s.flowCount !== 0;

  return (
    <div
      className={cn(
        "bg-card border rounded-xl p-4",
        valveOpenAlert && "border-red-500/40",
      )}
    >
      {Header}

      {valveOpenAlert && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/25 rounded-lg px-3 py-2 mb-2">
          <ShieldAlert className="w-4 h-4 text-red-500 shrink-0" />
          <p className="text-xs font-semibold text-red-600 dark:text-red-400">
            Valve open — flow with no tag present
          </p>
        </div>
      )}

      <StatusRow
        icon={<DoorOpen className="w-3.5 h-3.5" />}
        label="Tamper 1 (top box)"
        value={s.tamp1 ? "Open" : "Closed"}
        alert={s.tamp1}
        dim={!s.tamp1}
      />
      <StatusRow
        icon={<DoorOpen className="w-3.5 h-3.5" />}
        label="Tamper 2 (bottom box)"
        value={s.tamp2 ? "Open" : "Closed"}
        alert={s.tamp2}
        dim={!s.tamp2}
      />
      <StatusRow
        icon={<Battery className="w-3.5 h-3.5" />}
        label="Battery voltage"
        value={`${s.batteryVolts.toFixed(2)} V`}
      />
      <StatusRow
        icon={<Gauge className="w-3.5 h-3.5" />}
        label="Pressure"
        value={`${s.pressureOk ? "Yes" : "No"} (ADC ${s.pressureAdc})`}
        dim={!s.pressureOk}
      />
      <StatusRow
        icon={<Battery className="w-3.5 h-3.5" />}
        label="Low battery flagged"
        value={s.lowBattery ? "Yes" : "No"}
        alert={s.lowBattery}
        dim={!s.lowBattery}
      />
      <StatusRow
        icon={<Lock className="w-3.5 h-3.5" />}
        label="Valve open?"
        value={valveOpenAlert ? "Yes" : "No"}
        alert={valveOpenAlert}
        dim={!valveOpenAlert}
      />
    </div>
  );
}
