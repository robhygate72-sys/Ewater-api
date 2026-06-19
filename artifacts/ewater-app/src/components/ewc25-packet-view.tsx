import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  decodeEwc25,
  EWC25_EVENT_NAMES,
  eventCategory,
  type Ewc25Decoded,
  type EventCategory,
} from "@/lib/ewc25";

// ─── helpers ──────────────────────────────────────────────────────────────────

function mitsToCredits(mits: number): string {
  return (mits / 1000).toFixed(3);
}

function categoryStyle(cat: EventCategory): string {
  switch (cat) {
    case "dispense": return "bg-primary/10 text-primary border-primary/20";
    case "error":    return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
    case "warning":  return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
    case "status":   return "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20";
    case "startup":  return "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20";
  }
}

// ─── field row ────────────────────────────────────────────────────────────────

function Field({ label, value, mono = false, dim = false }: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  dim?: boolean;
}) {
  return (
    <div className="flex justify-between items-baseline gap-3 py-0.5">
      <span className="text-[10px] text-muted-foreground shrink-0">{label}</span>
      <span className={cn(
        "text-[11px] text-right",
        mono && "font-mono",
        dim && "text-muted-foreground",
      )}>
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-border/40 my-1" />;
}

// ─── section renderers ────────────────────────────────────────────────────────

function StandardFields({ d }: { d: Ewc25Decoded }) {
  const creditUsed = d.creditUsedMits;
  const dispensed = d.endCreditMits === 0xFFFFFFFF; // credit not written back

  return (
    <>
      <Field label="Battery" value={`${d.batteryVolts.toFixed(2)} V`} />
      <Field label="Tag UID" value={d.uid} mono />
      {d.event !== 0x02 && d.event !== 0x07 && ( // skip credit/flow for format events
        <>
          <Divider />
          <Field
            label="Start credit"
            value={`${mitsToCredits(d.startCreditMits)} credits (${d.startCreditMits.toLocaleString()} MITs)`}
          />
          {dispensed ? (
            <Field label="End credit" value="Not written back" dim />
          ) : (
            <Field
              label="End credit"
              value={`${mitsToCredits(d.endCreditMits)} credits (${d.endCreditMits.toLocaleString()} MITs)`}
            />
          )}
          {creditUsed > 0 && !dispensed && (
            <Field
              label="Credit used"
              value={`${mitsToCredits(creditUsed)} credits`}
            />
          )}
          <Divider />
          <Field label="Flow ticks" value={d.flowTicks.toLocaleString()} mono />
          <Field label="Litres dispensed" value={`~${d.litres.toFixed(2)} L`} />
          <Field label="Flow time" value={`${d.flowTimeSecs} s`} />
        </>
      )}
      {d.event !== 0x01 && (
        <Field label="Usage counter" value={d.usageCounter} mono />
      )}
    </>
  );
}

function NoCreditFields({ d }: { d: Ewc25Decoded }) {
  return (
    <>
      <Field label="Battery" value={`${d.batteryVolts.toFixed(2)} V`} />
      <Field label="Tag UID" value={d.uid} mono />
      <Divider />
      <Field
        label="Start credit"
        value={`${mitsToCredits(d.startCreditMits)} credits`}
      />
      <Field
        label="End credit"
        value={`${mitsToCredits(d.endCreditMits)} credits`}
      />
      <Divider />
      <Field label="Flow ticks" value={d.flowTicks.toLocaleString()} mono />
      <Field label="Litres dispensed" value={`~${d.litres.toFixed(2)} L`} />
      <Field label="Flow time" value={`${d.flowTimeSecs} s`} />
      {d.unmeteredFlowTicks !== undefined && (
        <Field
          label="Unmetered ticks (valve close)"
          value={d.unmeteredFlowTicks.toLocaleString()}
          mono
        />
      )}
    </>
  );
}

function TamperFields({ d }: { d: Ewc25Decoded }) {
  return (
    <>
      <Field label="Battery" value={`${d.batteryVolts.toFixed(2)} V`} />
      <Divider />
      <Field
        label="Tamper 1 (solar board)"
        value={d.tamper?.tamp1Open ? "OPEN ⚠" : "Closed"}
        dim={!d.tamper?.tamp1Open}
      />
      <Field
        label="Tamper 2 (bottom case)"
        value={d.tamper?.tamp2Open ? "OPEN ⚠" : "Closed"}
        dim={!d.tamper?.tamp2Open}
      />
    </>
  );
}

function PressureFields({ d }: { d: Ewc25Decoded }) {
  return (
    <>
      <Field label="Battery" value={`${d.batteryVolts.toFixed(2)} V`} />
      <Divider />
      <Field
        label="Pressure status"
        value={d.pressureOk ? "OK (pressure detected)" : "NO PRESSURE"}
        dim={d.pressureOk}
      />
      <Field label="Vwater ADC raw" value={`0x${d.rs.toString(16).padStart(2, "0").toUpperCase()}`} mono />
    </>
  );
}

function StartUpFields({ d }: { d: Ewc25Decoded }) {
  return (
    <>
      <Field label="Battery" value={`${d.batteryVolts.toFixed(2)} V`} />
      <Divider />
      <Field label="Power-up count" value={d.startUp?.powerUpCount ?? "—"} mono />
      <Field label="Firmware date" value={d.startUp?.firmwareDateStr ?? "—"} mono />
    </>
  );
}

function HealthStateFields({ d }: { d: Ewc25Decoded }) {
  const hs = d.healthState;
  if (!hs) return null;
  const vbat = Math.round((hs.vbatAdcRaw / 256) * 15 * 100) / 100;
  const f = hs.flags;
  return (
    <>
      <Field label="Battery" value={`${vbat.toFixed(2)} V (ADC 0x${hs.vbatAdcRaw.toString(16).toUpperCase()})`} />
      <Field label="Pressure" value={hs.vwatAdcRaw === 0 ? "OK" : `No pressure (ADC ${hs.vwatAdcRaw})`} dim={hs.vwatAdcRaw === 0} />
      <Divider />
      <Field label="Valve" value={f.valveOn ? "ON" : "Off"} dim={!f.valveOn} />
      <Field label="RFID" value={f.rfidDisabled ? "Disabled (host mode)" : "Enabled"} dim={!f.rfidDisabled} />
      <Field label="GSM" value={f.gsmNotLocked ? "Not locked" : "Locked"} dim={!f.gsmNotLocked} />
      <Field label="Low battery flag" value={f.lowBattery ? "Yes ⚠" : "No"} dim={!f.lowBattery} />
      <Field label="Tamper 1" value={f.tamp1 ? "Open ⚠" : "Closed"} dim={!f.tamp1} />
      <Field label="Tamper 2" value={f.tamp2 ? "Open ⚠" : "Closed"} dim={!f.tamp2} />
      <Field label="Prox flag" value={f.proxFlag ? "Yes" : "No"} dim={!f.proxFlag} />
      <Field label="No-flow lockout" value={f.lockFlag ? "Yes" : "No"} dim={!f.lockFlag} />
      <Divider />
      <Field label="Tick accumulator" value={hs.tickAccumulatorHex} mono />
    </>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export function Ewc25PacketView({ hexPayload }: { hexPayload: string }) {
  const [showRaw, setShowRaw] = useState(false);
  const result = decodeEwc25(hexPayload);

  if (!result.valid) {
    return (
      <p className="text-[11px] font-mono text-muted-foreground break-all leading-relaxed">
        {hexPayload}
      </p>
    );
  }

  const d = result;
  const catStyle = categoryStyle(d.category);

  return (
    <div className="space-y-1.5">
      {/* Event badge + device timestamp */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={cn(
          "text-[10px] font-semibold px-1.5 py-0.5 rounded border",
          catStyle,
        )}>
          {d.eventName}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground">
          {d.deviceTimeStr}
        </span>
        <span className="ml-auto text-[10px] font-mono text-muted-foreground/50">
          EWC {d.ewcIdHex}
        </span>
        {!d.xorValid && (
          <span className="text-[10px] text-red-500 font-semibold">XOR ERR</span>
        )}
      </div>

      {/* Decoded fields */}
      <div className="bg-muted/30 rounded px-2.5 py-1.5 space-y-0">
        {d.event === 0x01 && <NoCreditFields d={d} />}
        {d.event === 0x18 && <TamperFields d={d} />}
        {d.event === 0x13 && <PressureFields d={d} />}
        {d.event === 0x16 && <StartUpFields d={d} />}
        {d.event === 0x19 && <HealthStateFields d={d} />}
        {![0x01, 0x18, 0x13, 0x16, 0x19].includes(d.event) && (
          <StandardFields d={d} />
        )}
        <Divider />
        <Field label="FCF (ticks/credit)" value={d.fcf} mono dim />
        <Field label="Log pointer" value={d.datalogPointer} mono dim />
      </div>

      {/* Raw hex toggle */}
      <button
        className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
        onClick={() => setShowRaw((v) => !v)}
      >
        {showRaw ? "Hide raw hex ▲" : "Raw hex ▼"}
      </button>
      {showRaw && (
        <p className="text-[10px] font-mono break-all leading-relaxed text-muted-foreground bg-muted/20 rounded px-2 py-1.5">
          {hexPayload}
        </p>
      )}
    </div>
  );
}

// Export event names for potential future use
export { EWC25_EVENT_NAMES, eventCategory };
