import { useGetAssetMeterReading, getGetAssetMeterReadingQueryKey } from "@workspace/api-client-react";
import { Gauge } from "lucide-react";
import { formatDateTime } from "@/lib/date";

interface MeterReadingPanelProps {
  assetId: string;
}

function DigitChar({ ch }: { ch: string }) {
  const isSep = ch === "," || ch === ".";
  if (isSep) {
    return (
      <span className="text-blue-400/60 text-xl font-mono leading-none select-none px-0.5">
        {ch}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center justify-center w-8 h-10 rounded bg-[#0b1826] border border-[#1e3a5c] text-blue-100 text-xl font-mono font-bold leading-none select-none shadow-inner"
      style={{ textShadow: "0 0 10px rgba(96,165,250,0.6)" }}
    >
      {ch}
    </span>
  );
}

export function MeterReadingPanel({ assetId }: MeterReadingPanelProps) {
  const { data, isLoading } = useGetAssetMeterReading(assetId, {
    query: { queryKey: getGetAssetMeterReadingQueryKey(assetId), staleTime: 5 * 60 * 1000 },
  });

  const litresStr =
    data?.found && data.litres != null
      ? data.litres.toLocaleString(undefined, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })
      : null;

  return (
    <div className="rounded-xl border bg-[#060f1a] border-[#1a3a5c] p-4 shadow-inner">
      <div className="flex items-center gap-2 mb-3">
        <Gauge className="w-3.5 h-3.5 text-blue-400" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-400/70">
          Water Meter Reading
        </span>
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        {isLoading ? (
          <span className="text-sm text-blue-300/50 font-mono animate-pulse">
            Reading meter…
          </span>
        ) : !data?.found || litresStr == null ? (
          <span className="text-sm text-blue-300/30 font-mono">No reading available</span>
        ) : (
          <>
            {litresStr.split("").map((ch, i) => (
              <DigitChar key={i} ch={ch} />
            ))}
            <span className="ml-2 text-xs text-blue-300/60 font-medium self-end pb-1">L</span>
          </>
        )}
      </div>

      {data?.found && data.timestamp && (
        <p className="mt-2 text-[10px] text-blue-300/40 font-mono">
          as of {formatDateTime(data.timestamp)}
        </p>
      )}
      {data?.found && data.ticks != null && data.lcf != null && (
        <p className="mt-0.5 text-[10px] text-blue-300/30 font-mono">
          {data.ticks.toLocaleString()} ticks · LCF {data.lcf}
        </p>
      )}
    </div>
  );
}
