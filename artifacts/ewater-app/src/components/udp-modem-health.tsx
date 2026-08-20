import type {
  AssetUdpHealth,
  UdpModemHealth,
  UdpCommunicationsSummaryStatus,
} from "@workspace/api-client-react";
import { Radio, Wifi, WifiOff, CircleHelp } from "lucide-react";
import { formatDateTime, formatTimeAgo } from "@/lib/date";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export function selectedUdpModem(data: AssetUdpHealth | undefined): UdpModemHealth | null {
  if (!data) return null;
  const selected = data.summary.selectedImei
    ? data.modems.find((modem) => modem.imei === data.summary.selectedImei)
    : null;
  return selected ?? data.modems.find((modem) => modem.fetchStatus === "success") ?? data.modems[0] ?? null;
}

export function udpStatusClass(status: UdpCommunicationsSummaryStatus): string {
  if (status === "online") {
    return "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25";
  }
  if (status === "offline") {
    return "text-destructive bg-destructive/10 border-destructive/25";
  }
  return "text-muted-foreground bg-muted/40 border-border";
}

function StatusIcon({ status }: { status: UdpCommunicationsSummaryStatus }) {
  if (status === "online") return <Wifi className="w-3.5 h-3.5" />;
  if (status === "offline") return <WifiOff className="w-3.5 h-3.5" />;
  return <CircleHelp className="w-3.5 h-3.5" />;
}

function Detail({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-1 border-b border-border/30 last:border-0">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={cn("text-[10px] text-right break-all", mono && "font-mono")}>
        {value ?? <span className="italic text-muted-foreground/60">Unknown</span>}
      </span>
    </div>
  );
}

export function UdpModemHealthPanel({
  data,
  loading,
  compact = false,
}: {
  data: AssetUdpHealth | undefined;
  loading?: boolean;
  compact?: boolean;
}) {
  if (loading) {
    return <Skeleton className={compact ? "h-16 w-full" : "h-28 w-full"} />;
  }

  const summary = data?.summary;
  const modems = data?.modems ?? [];
  const selected = selectedUdpModem(data);
  const status = summary?.status ?? "unknown";

  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-2" data-testid="panel-udp-modem-health">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5" /> UDP modem health
          </p>
          <p className="text-[9px] text-muted-foreground mt-0.5">
            eWater UDP fallback · checked {data?.fetchedAt ? formatTimeAgo(data.fetchedAt) : "now"}
          </p>
        </div>
        <span
          data-testid="status-udp-connectivity"
          className={cn(
            "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase",
            udpStatusClass(status),
          )}
        >
          <StatusIcon status={status} /> {status}
        </span>
      </div>

      <p className="text-[10px] text-muted-foreground">{summary?.reason ?? "UDP modem health is unavailable"}</p>

      {summary?.lastSyncAt && (
        <p className="text-[10px]">
          Freshest sync{" "}
          <span className="font-medium" title={formatDateTime(summary.lastSyncAt)}>
            {formatTimeAgo(summary.lastSyncAt)}
          </span>
          {summary.selectedImei ? <span className="text-muted-foreground"> · IMEI {summary.selectedImei}</span> : null}
        </p>
      )}

      {compact && selected && (
        <p className="text-[10px] text-muted-foreground font-mono break-all">
          IMEI {selected.imei}
          {selected.iccid ? ` · ICCID ${selected.iccid}` : ""}
          {selected.network ? ` · ${selected.network}` : ""}
          {selected.firmwareVersion ? ` · FW ${selected.firmwareVersion}` : ""}
          {selected.serverLedgerLag != null ? ` · Ledger lag ${selected.serverLedgerLag}` : ""}
        </p>
      )}

      {!compact && modems.length > 0 && (
        <div className="space-y-2 pt-1">
          {modems.map((modem) => (
            <div key={modem.imei} className="rounded-lg bg-muted/30 border border-border/40 px-2.5 py-1.5">
              <div className="flex justify-between gap-2 mb-1">
                <span className="font-mono text-[10px]">{modem.imei}</span>
                <span className="text-[9px] uppercase text-muted-foreground">{modem.fetchStatus.replaceAll("_", " ")}</span>
              </div>
              <Detail
                label="Last sync"
                value={modem.lastSyncAt ? `${formatTimeAgo(modem.lastSyncAt)} · ${formatDateTime(modem.lastSyncAt)}` : null}
              />
              <Detail label="Network" value={modem.network} />
              <Detail label="Modem / firmware" value={[modem.modemType, modem.firmwareVersion].filter(Boolean).join(" · ") || null} />
              <Detail label="ICCID" value={modem.iccid} mono />
              <Detail label="Endpoint" value={modem.endpoint} mono />
              <Detail label="Server ledger lag" value={modem.serverLedgerLag != null ? String(modem.serverLedgerLag) : null} mono />
              {modem.signal && <Detail label="Signal" value={modem.signal} mono />}
              {modem.error && <p className="text-[9px] text-muted-foreground italic pt-1">{modem.error}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}