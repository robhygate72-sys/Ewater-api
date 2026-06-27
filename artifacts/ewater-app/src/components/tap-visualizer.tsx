import { motion, AnimatePresence } from "framer-motion";
import {
  Droplets, CreditCard, OctagonX, Ban, AlertTriangle, ShieldAlert,
  BatteryLow, HeartPulse, Power, Radio, Waves, Gauge, Wifi,
} from "lucide-react";
import tapImg from "@assets/Screenshot_20260627_203314_WhatsApp_1782585219660.jpg";
import { cn } from "@/lib/utils";
import type { TapAnimKind, TapTone } from "@/lib/tap-animation";

export interface ActiveTapAnim {
  kind: TapAnimKind;
  label: string;
  tone: TapTone;
  nonce: number;
}

// Spout tip + meter/NFC anchor points as a fraction of the image box.
const SPOUT = { x: 50, y: 72 };
const METER = { y: 42 };
const NFC = { y: 30 };

const TONE_HEX: Record<TapTone, string> = {
  water: "56, 189, 248", // sky-400
  good: "16, 185, 129",  // emerald-500
  warn: "245, 158, 11",  // amber-500
  error: "239, 68, 68",  // red-500
  info: "59, 130, 246",  // blue-500
};

const TONE_TEXT: Record<TapTone, string> = {
  water: "text-sky-600 bg-sky-500/10 border-sky-500/30",
  good: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30",
  warn: "text-amber-600 bg-amber-500/10 border-amber-500/30",
  error: "text-red-600 bg-red-500/10 border-red-500/30",
  info: "text-blue-600 bg-blue-500/10 border-blue-500/30",
};

function KindIcon({ kind, className }: { kind: TapAnimKind; className?: string }) {
  switch (kind) {
    case "dispense": return <Droplets className={className} />;
    case "tag-removed": return <CreditCard className={className} />;
    case "dispense-limit": return <OctagonX className={className} />;
    case "no-credit":
    case "valve-off": return <Ban className={className} />;
    case "error": return <AlertTriangle className={className} />;
    case "tamper": return <ShieldAlert className={className} />;
    case "no-flow": return <Droplets className={className} />;
    case "low-battery": return <BatteryLow className={className} />;
    case "health": return <HeartPulse className={className} />;
    case "startup": return <Power className={className} />;
    case "prox": return <Wifi className={className} />;
    case "pressure": return <Gauge className={className} />;
    case "command": return <Radio className={className} />;
    case "gadwall":
    case "beam": return <Waves className={className} />;
    default: return <Radio className={className} />;
  }
}

export function TapVisualizer({ active }: { active: ActiveTapAnim | null }) {
  const kind = active?.kind ?? "idle";
  const tone = active?.tone ?? "info";
  const rgb = TONE_HEX[tone];

  const pouring = kind === "dispense";
  const dripping = kind === "no-flow";
  const cutoff = kind === "tag-removed";
  const limit = kind === "dispense-limit";
  const shaking = kind === "error" || kind === "tamper";
  const healthy = kind === "health";
  const signalling =
    kind === "command" || kind === "gadwall" || kind === "beam" ||
    kind === "prox" || kind === "startup" || kind === "pressure";

  // How full the bucket should be for this state.
  const bucketFill = limit ? 0.92 : pouring ? 0.6 : cutoff ? 0.32 : dripping ? 0.12 : 0;

  return (
    <div className="relative mx-auto aspect-[633/1024] max-h-[380px] w-auto overflow-hidden rounded-xl border bg-muted/20">
      {/* Tap photo with shake on fault events */}
      <motion.img
        src={tapImg}
        alt="eWater tap"
        className="absolute inset-0 h-full w-full object-cover select-none"
        draggable={false}
        key={`img-${shaking ? active?.nonce : "still"}`}
        animate={shaking ? { x: [0, -5, 5, -4, 4, -2, 2, 0] } : { x: 0 }}
        transition={shaking ? { duration: 0.5 } : { duration: 0.2 }}
      />

      {/* Status glow over the meter display */}
      <motion.div
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl"
        style={{
          top: `${METER.y}%`,
          width: "55%",
          height: "12%",
          background: `radial-gradient(closest-side, rgba(${rgb},0.55), transparent)`,
        }}
        animate={
          healthy
            ? { opacity: [0.2, 0.9, 0.2], scale: [0.9, 1.1, 0.9] }
            : kind === "idle"
              ? { opacity: 0.12, scale: 1 }
              : { opacity: [0.1, 0.8, 0.35], scale: [0.95, 1.05, 1] }
        }
        transition={
          healthy
            ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" }
            : { duration: 1.2, ease: "easeOut" }
        }
        key={`glow-${active?.nonce ?? "idle"}`}
      />

      {/* Signal rings emanating from the NFC zone */}
      <AnimatePresence>
        {signalling && active && (
          <>
            {[0, 1, 2].map((i) => (
              <motion.div
                key={`ring-${active.nonce}-${i}`}
                className="pointer-events-none absolute left-1/2 rounded-full border-2"
                style={{
                  top: `${NFC.y}%`,
                  borderColor: `rgba(${rgb},0.7)`,
                  width: "18%",
                  aspectRatio: "1",
                  translateX: "-50%",
                  translateY: "-50%",
                }}
                initial={{ scale: 0.3, opacity: 0.8 }}
                animate={{ scale: 2.6, opacity: 0 }}
                transition={{ duration: 1.6, delay: i * 0.35, ease: "easeOut" }}
              />
            ))}
          </>
        )}
      </AnimatePresence>

      {/* Water stream from the spout */}
      <AnimatePresence>
        {(pouring || dripping || cutoff) && active && (
          <motion.div
            key={`stream-${active.nonce}`}
            className="pointer-events-none absolute -translate-x-1/2 origin-top rounded-full"
            style={{
              left: `${SPOUT.x}%`,
              top: `${SPOUT.y}%`,
              width: dripping ? 3 : 5,
              background: `linear-gradient(to bottom, rgba(${TONE_HEX.water},0.9), rgba(${TONE_HEX.water},0.35))`,
            }}
            initial={{ height: 0, opacity: 0 }}
            animate={
              dripping
                ? { height: ["0%", "3%", "0%"], opacity: [0, 1, 0] }
                : cutoff
                  ? { height: ["0%", "8%", "8%", "0%"], opacity: [0, 1, 1, 0] }
                  : { height: "8%", opacity: 1 }
            }
            exit={{ height: 0, opacity: 0 }}
            transition={
              dripping
                ? { duration: 1.4, repeat: 2, ease: "easeInOut" }
                : cutoff
                  ? { duration: 1.6, times: [0, 0.2, 0.7, 0.85], ease: "easeOut" }
                  : { duration: 0.4, ease: "easeOut" }
            }
          />
        )}
      </AnimatePresence>

      {/* Bucket that fills with water, sitting under the spout */}
      <AnimatePresence>
        {bucketFill > 0 && active && (
          <motion.svg
            key={`bucket-${active.nonce}`}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 drop-shadow-md"
            style={{ top: "76%", width: "30%", height: "20%" }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          >
            <defs>
              <linearGradient id="tapWater" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={`rgba(${TONE_HEX.water},0.75)`} />
                <stop offset="100%" stopColor={`rgba(${TONE_HEX.water},0.95)`} />
              </linearGradient>
              <clipPath id="tapBucketClip">
                <path d="M20,18 L80,18 L72,92 L28,92 Z" />
              </clipPath>
            </defs>
            {/* water fill (rises from the bottom of the bucket) */}
            <motion.rect
              x="18"
              width="64"
              clipPath="url(#tapBucketClip)"
              fill="url(#tapWater)"
              initial={{ y: 92, height: 0 }}
              animate={{ y: 92 - bucketFill * 74, height: bucketFill * 74 }}
              transition={{ duration: pouring ? 2.4 : 1, ease: "easeInOut" }}
            />
            {/* bucket body + rim outline */}
            <path
              d="M20,18 L80,18 L72,92 L28,92 Z"
              fill="rgba(255,255,255,0.18)"
              stroke="rgba(15,23,42,0.55)"
              strokeWidth="3"
              strokeLinejoin="round"
            />
            <ellipse
              cx="50"
              cy="18"
              rx="30"
              ry="6"
              fill="rgba(255,255,255,0.35)"
              stroke="rgba(15,23,42,0.55)"
              strokeWidth="3"
            />
          </motion.svg>
        )}
      </AnimatePresence>

      {/* No-pour cross for no-credit / valve-off */}
      <AnimatePresence>
        {(kind === "no-credit" || kind === "valve-off") && active && (
          <motion.div
            key={`nopour-${active.nonce}`}
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ top: `${SPOUT.y + 6}%` }}
            initial={{ scale: 0, opacity: 0, rotate: -20 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 18 }}
          >
            <Ban className="h-8 w-8 text-red-500" strokeWidth={2.5} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Event label chip */}
      <AnimatePresence mode="wait">
        {active && active.kind !== "idle" && (
          <motion.div
            key={`label-${active.nonce}`}
            className={cn(
              "absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-sm backdrop-blur",
              TONE_TEXT[tone],
            )}
            initial={{ y: -12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -12, opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <KindIcon kind={kind} className="h-3.5 w-3.5" />
            {active.label}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Idle hint */}
      {(!active || active.kind === "idle") && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border bg-background/70 px-2.5 py-1 text-[10px] text-muted-foreground backdrop-blur">
          Listening for live events…
        </div>
      )}
    </div>
  );
}
