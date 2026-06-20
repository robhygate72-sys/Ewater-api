import { useState } from "react";
import {
  useGetAssetMeterReading,
  getGetAssetMeterReadingQueryKey,
  useResetAssetMeter,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Gauge, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import { formatDateTime } from "@/lib/date";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface MeterReadingPanelProps {
  assetId: string;
}

function DigitChar({ ch }: { ch: string }) {
  const isSep = ch === "," || ch === ".";
  if (isSep) {
    return (
      <span className="text-zinc-400 text-2xl font-mono leading-none select-none px-0.5 self-end pb-0.5">
        {ch}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center w-9 h-12 rounded border border-zinc-200 bg-white text-zinc-900 text-2xl font-mono font-bold leading-none select-none shadow-[inset_0_1px_3px_rgba(0,0,0,0.08)]">
      {ch}
    </span>
  );
}

export function MeterReadingPanel({ assetId }: MeterReadingPanelProps) {
  const queryClient = useQueryClient();
  const queryKey = getGetAssetMeterReadingQueryKey(assetId);

  const { data, isLoading } = useGetAssetMeterReading(assetId, {
    query: { queryKey, staleTime: 5 * 60 * 1000 },
  });

  const { mutate: resetMeter, isPending: isResetting } = useResetAssetMeter({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey });
      },
    },
  });

  const [showInput, setShowInput] = useState(false);
  const [inputLitres, setInputLitres] = useState("");
  const [resetResult, setResetResult] = useState<{ success: boolean; message: string } | null>(null);

  const lcf = data?.lcf ?? null;

  const litresStr =
    data?.found && data.litres != null
      ? data.litres.toLocaleString(undefined, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })
      : null;

  function handleSetMeter() {
    const litres = parseFloat(inputLitres);
    if (isNaN(litres) || litres < 0) return;
    if (!lcf) return;

    setResetResult(null);
    resetMeter(
      { assetId, data: { litres, lcf } },
      {
        onSuccess: (result) => {
          if (result.success) {
            setResetResult({ success: true, message: `Set to ${litres.toLocaleString()} L (${result.ticks.toLocaleString()} ticks)` });
            setShowInput(false);
            setInputLitres("");
          } else {
            setResetResult({ success: false, message: result.error ?? "Command failed" });
          }
        },
        onError: (err) => {
          setResetResult({ success: false, message: err instanceof Error ? err.message : "Request failed" });
        },
      }
    );
  }

  return (
    <div className="rounded-xl border bg-white border-zinc-200 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Gauge className="w-3.5 h-3.5 text-zinc-500" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Water Meter Reading
          </span>
        </div>
        {!showInput && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs px-2"
            onClick={() => { setShowInput(true); setResetResult(null); }}
            disabled={!lcf}
          >
            Set meter value
          </Button>
        )}
      </div>

      {/* Digit display */}
      <div className="flex items-center gap-1 flex-wrap min-h-[3rem]">
        {isLoading ? (
          <span className="text-sm text-zinc-400 font-mono animate-pulse">Reading meter…</span>
        ) : !data?.found || litresStr == null ? (
          <span className="text-sm text-zinc-400 font-mono">No reading available</span>
        ) : (
          <>
            {litresStr.split("").map((ch, i) => (
              <DigitChar key={i} ch={ch} />
            ))}
            <span className="ml-2 text-sm text-zinc-500 font-medium self-end pb-1">L</span>
          </>
        )}
      </div>

      {/* Timestamp / raw values */}
      {data?.found && data.timestamp && (
        <p className="mt-2 text-[10px] text-zinc-400 font-mono">
          as of {formatDateTime(data.timestamp)}
        </p>
      )}
      {data?.found && data.ticks != null && data.lcf != null && (
        <p className="mt-0.5 text-[10px] text-zinc-400 font-mono">
          {data.ticks.toLocaleString()} ticks · LCF {data.lcf}
        </p>
      )}

      {/* Set meter input */}
      {showInput && (
        <div className="mt-3 pt-3 border-t border-zinc-100 space-y-2">
          <p className="text-xs text-zinc-500">
            Enter the new meter reading in litres
            {lcf ? <span className="ml-1 text-zinc-400">(LCF {lcf} → {Math.round(parseFloat(inputLitres || "0") * lcf).toLocaleString()} ticks)</span> : null}
          </p>
          <div className="flex gap-2">
            <Input
              type="number"
              min="0"
              step="0.1"
              placeholder="e.g. 1250.0"
              value={inputLitres}
              onChange={(e) => setInputLitres(e.target.value)}
              className="h-8 text-sm font-mono"
              onKeyDown={(e) => e.key === "Enter" && handleSetMeter()}
            />
            <Button
              size="sm"
              className="h-8 shrink-0"
              onClick={handleSetMeter}
              disabled={isResetting || !inputLitres || !lcf}
            >
              {isResetting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : "Confirm"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 shrink-0"
              onClick={() => { setShowInput(false); setInputLitres(""); setResetResult(null); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Result feedback */}
      {resetResult && (
        <div className={`mt-2 flex items-center gap-2 text-xs rounded-lg px-3 py-2 ${
          resetResult.success
            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
            : "bg-red-50 text-red-700 border border-red-200"
        }`}>
          {resetResult.success
            ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
          <span>{resetResult.message}</span>
        </div>
      )}
    </div>
  );
}
