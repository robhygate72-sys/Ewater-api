import { useState } from "react";
import { useGetAssetPackets } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronDown, ChevronRight, Radio, RefreshCw, AlertTriangle,
  Droplet, Battery, Signal, Lock, Unlock, ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/date";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Packet = {
  id: string;
  timeReceived: string;
  pipeline: string;
  protocol: string;
  assetId?: string | null;
  imei?: string | null;
  serial?: string | null;
  valid?: boolean | null;
  messageType?: string | null;
  messageFunction?: string | null;
  meterReading?: number | null;
  prepayLitres?: number | null;
  supplyVoltage?: number | null;
  batteryState?: string | null;
  valveStatus?: string | null;
  signalPower?: string | null;
  signalSnr?: string | null;
  errorCode?: number | null;
  magneticAttack?: boolean | null;
  description?: string | null;
};

function stripParen(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function ValveChip({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const s = stripParen(status) ?? status;
  const isOpen = s.toLowerCase().includes("open");
  const isClosed = s.toLowerCase().includes("close");
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border",
      isOpen ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
             : isClosed ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
             : "bg-muted text-muted-foreground border-border",
    )}>
      {isOpen ? <Unlock className="w-2.5 h-2.5" /> : isClosed ? <Lock className="w-2.5 h-2.5" /> : null}
      {s}
    </span>
  );
}

function msgFnLabel(fn: string | null | undefined): string | null {
  if (!fn) return null;
  const s = stripParen(fn);
  return s ?? fn;
}

function PacketRow({ pkt }: { pkt: Packet }) {
  const [open, setOpen] = useState(false);
  const isValid = pkt.valid !== false;
  const hasTamper = pkt.magneticAttack === true;
  const fnLabel = msgFnLabel(pkt.messageFunction);

  return (
    <div className={cn(
      "border-b border-border/40 last:border-0",
      !isValid && "opacity-60",
    )}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left py-2.5 px-0 flex items-start gap-2 hover:bg-muted/30 rounded transition-colors"
      >
        <span className="mt-0.5 shrink-0 text-muted-foreground/50">
          {open
            ? <ChevronDown className="w-3.5 h-3.5" />
            : <ChevronRight className="w-3.5 h-3.5" />}
        </span>

        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            {fnLabel && (
              <span className="text-xs font-medium">{fnLabel}</span>
            )}
            {!isValid && (
              <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4">invalid</Badge>
            )}
            {hasTamper && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-red-500">
                <ShieldAlert className="w-3 h-3" />tamper
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-muted-foreground font-mono">
              {formatDateTime(pkt.timeReceived)}
            </span>
            <span className="text-[10px] text-muted-foreground/50">·</span>
            <span className="text-[10px] text-muted-foreground">{pkt.protocol}</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap pt-0.5">
            {pkt.meterReading != null && (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <Droplet className="w-2.5 h-2.5" />
                <span className="font-mono">{pkt.meterReading.toLocaleString()} L</span>
              </span>
            )}
            {pkt.prepayLitres != null && (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="opacity-50">prepay</span>
                <span className="font-mono">{pkt.prepayLitres} L</span>
              </span>
            )}
            {pkt.supplyVoltage != null && (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <Battery className="w-2.5 h-2.5" />
                <span className="font-mono">{pkt.supplyVoltage.toFixed(2)} V</span>
              </span>
            )}
            {pkt.signalPower != null && (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <Signal className="w-2.5 h-2.5" />
                <span className="font-mono">{pkt.signalPower}</span>
              </span>
            )}
            <ValveChip status={pkt.valveStatus} />
          </div>
        </div>
      </button>

      {open && (
        <div className="pb-3 pl-6 pr-1">
          {pkt.description ? (
            <pre className="text-[10px] font-mono leading-relaxed whitespace-pre-wrap text-muted-foreground bg-muted/40 rounded-lg p-3 overflow-x-auto">
              {pkt.description}
            </pre>
          ) : (
            <p className="text-[11px] text-muted-foreground/60 italic py-1">
              No decoded description available
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const HOUR_OPTIONS = [6, 12, 24, 48, 72] as const;

export function RawPacketsPanel({ assetId }: { assetId: string }) {
  const [hours, setHours] = useState<number>(24);

  const { data: packets, isLoading, isError, refetch, isFetching } =
    useGetAssetPackets(assetId, { hours }, {
      query: {
        enabled: !!assetId,
        queryKey: [`${BASE}/api/ewater/assets/${assetId}/packets`, hours],
      },
    });

  return (
    <Card className="shadow-sm border">
      <CardHeader className="py-3 px-4 border-b border-border/50">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Radio className="w-3.5 h-3.5" />
            Raw Packets
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-border overflow-hidden">
              {HOUR_OPTIONS.map((h) => (
                <button
                  key={h}
                  onClick={() => setHours(h)}
                  className={cn(
                    "px-2 py-0.5 text-[10px] font-medium transition-colors",
                    hours === h
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  {h}h
                </button>
              ))}
            </div>
            <Button
              variant="ghost" size="icon"
              className="h-6 w-6"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={cn("w-3 h-3", isFetching && "animate-spin")} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 py-0">
        {isLoading ? (
          <div className="py-3 space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : isError ? (
          <div className="py-6 flex flex-col items-center gap-2 text-center">
            <AlertTriangle className="w-5 h-5 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">Failed to load packet logs</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : !packets || packets.length === 0 ? (
          <div className="py-6 flex flex-col items-center gap-2 text-center">
            <Radio className="w-5 h-5 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No packets received in the last {hours}h</p>
          </div>
        ) : (
          <div>
            <p className="text-[10px] text-muted-foreground/60 py-2">
              {packets.length} packet{packets.length !== 1 ? "s" : ""} — tap to see decoded breakdown
            </p>
            {packets.map((pkt) => (
              <PacketRow key={pkt.id} pkt={pkt as Packet} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
