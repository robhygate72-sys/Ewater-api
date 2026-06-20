import { cn } from "@/lib/utils";

interface WaterMeterProps {
  litres: number | null;
  loading?: boolean;
  found?: boolean;
  className?: string;
}

function formatLitres(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 10_000)    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

// Odometer-style digit roller
function DigitRoller({ digits }: { digits: string }) {
  return (
    <div className="flex items-center gap-[2px]">
      {digits.split("").map((ch, i) => (
        <div
          key={i}
          className={cn(
            "w-[22px] h-[30px] rounded-[3px] flex items-center justify-center font-mono text-base font-bold leading-none select-none",
            ch === "." || ch === ","
              ? "w-[8px] bg-transparent text-blue-300 text-lg pb-1"
              : "bg-[#0b1e35] border border-[#1e4060] text-blue-100 shadow-inner",
          )}
          style={ch !== "." && ch !== "," ? {
            textShadow: "0 0 8px rgba(96,165,250,0.7)",
            boxShadow: "inset 0 2px 4px rgba(0,0,0,0.5), inset 0 -1px 2px rgba(96,165,250,0.1)",
          } : undefined}
        >
          {ch}
        </div>
      ))}
    </div>
  );
}

// Polar coordinate helper
function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const s = polar(cx, cy, r, startDeg);
  const e = polar(cx, cy, r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

export function WaterMeter({ litres, loading, found, className }: WaterMeterProps) {
  // Gauge sweep: -135° to +135° (270° total)
  const START = -135;
  const END   =  135;
  const SWEEP = END - START;
  const CX = 80, CY = 80, R = 60;

  // Determine needle angle
  let fraction = 0;
  if (litres != null && litres > 0) {
    // Dynamic scale: round to next order of magnitude
    const mag = Math.pow(10, Math.ceil(Math.log10(litres + 1)));
    fraction = Math.min(litres / mag, 1);
  }
  const needleDeg = START + fraction * SWEEP;
  const needlePt  = polar(CX, CY, 44, needleDeg);

  // Tick marks (9 major ticks = 0, 1/8 … 8/8)
  const ticks = Array.from({ length: 9 }, (_, i) => {
    const deg = START + (i / 8) * SWEEP;
    const outer = polar(CX, CY, 58, deg);
    const inner = polar(CX, CY, 50, deg);
    return { outer, inner, deg, i };
  });

  const filledPath = litres != null && litres > 0
    ? arcPath(CX, CY, R, START, needleDeg)
    : null;

  const displayStr = litres != null
    ? litres.toLocaleString(undefined, { maximumFractionDigits: 1 })
    : "—";

  const digits = litres != null ? displayStr : null;

  return (
    <div className={cn("flex flex-col items-center", className)}>
      {/* SVG dial */}
      <svg width="160" height="130" viewBox="0 0 160 130" className="overflow-visible">
        {/* Outer bezel */}
        <circle cx={CX} cy={CY} r={74} fill="#0a1628" stroke="#1a3a5c" strokeWidth="2" />
        {/* Background arc track */}
        <path
          d={arcPath(CX, CY, R, START, END)}
          fill="none" stroke="#1a3a5c" strokeWidth="8" strokeLinecap="round"
        />
        {/* Filled arc */}
        {filledPath && (
          <path
            d={filledPath}
            fill="none" stroke="#3b82f6" strokeWidth="8" strokeLinecap="round"
            style={{ filter: "drop-shadow(0 0 4px rgba(59,130,246,0.6))" }}
          />
        )}
        {/* Tick marks */}
        {ticks.map(({ outer, inner, i }) => (
          <line
            key={i}
            x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
            stroke={i === 0 ? "#64748b" : "#1e4060"}
            strokeWidth={i % 4 === 0 ? 2 : 1}
          />
        ))}
        {/* Needle */}
        {litres != null && (
          <>
            <line
              x1={CX} y1={CY}
              x2={needlePt.x} y2={needlePt.y}
              stroke="#f87171" strokeWidth="2" strokeLinecap="round"
              style={{ filter: "drop-shadow(0 0 3px rgba(248,113,113,0.8))" }}
            />
            <circle cx={CX} cy={CY} r={4} fill="#f87171" />
            <circle cx={CX} cy={CY} r={2} fill="#fff" />
          </>
        )}
        {/* Center reading */}
        {loading ? (
          <text x={CX} y={CY + 4} textAnchor="middle" fill="#94a3b8" fontSize="11" fontFamily="monospace">
            …
          </text>
        ) : !found ? (
          <text x={CX} y={CY + 4} textAnchor="middle" fill="#475569" fontSize="10" fontFamily="monospace">
            no data
          </text>
        ) : (
          <>
            <text x={CX} y={CY - 4} textAnchor="middle" fill="#93c5fd" fontSize="13" fontFamily="monospace" fontWeight="bold"
              style={{ textShadow: "0 0 6px rgba(147,197,253,0.5)" }}>
              {digits != null ? formatLitres(litres!) : "—"}
            </text>
            <text x={CX} y={CY + 11} textAnchor="middle" fill="#60a5fa" fontSize="8.5" fontFamily="sans-serif" letterSpacing="1">
              LITRES
            </text>
          </>
        )}
        {/* Labels: 0 and max */}
        {litres != null && litres > 0 && (
          <>
            {(() => {
              const mag = Math.pow(10, Math.ceil(Math.log10(litres + 1)));
              const zeroP = polar(CX, CY, 67, START);
              const maxP  = polar(CX, CY, 67, END);
              return (
                <>
                  <text x={zeroP.x - 2} y={zeroP.y + 3} textAnchor="end" fill="#334155" fontSize="7" fontFamily="monospace">0</text>
                  <text x={maxP.x + 2} y={maxP.y + 3} textAnchor="start" fill="#334155" fontSize="7" fontFamily="monospace">
                    {mag >= 1000 ? `${mag/1000}k` : mag}
                  </text>
                </>
              );
            })()}
          </>
        )}
        {/* "WATER METER" label at bottom */}
        <text x={CX} y={120} textAnchor="middle" fill="#1e3a5c" fontSize="7.5" fontFamily="sans-serif" letterSpacing="1.5" fontWeight="500">
          WATER METER
        </text>
      </svg>

      {/* Odometer display */}
      {digits != null && (
        <div className="mt-[-8px] flex flex-col items-center gap-1">
          <div className="bg-[#061120] rounded-lg px-3 py-2 border border-[#1a3a5c] shadow-inner"
            style={{ boxShadow: "0 0 12px rgba(59,130,246,0.15), inset 0 2px 4px rgba(0,0,0,0.6)" }}>
            <DigitRoller digits={displayStr} />
          </div>
          <span className="text-[9px] text-slate-500 tracking-wider uppercase mt-0.5">Litres</span>
        </div>
      )}
    </div>
  );
}
