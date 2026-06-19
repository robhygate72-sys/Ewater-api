import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  decodeEwc25,
  decodeEwcReply,
  decodeCommandApiPayload,
  EWC25_EVENT_NAMES,
  eventCategory,
  type Ewc25Decoded,
  type EwcReplyDecoded,
  type EwcReplyData,
  type CommandApiDecoded,
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

// ─── eSENSE VSEN helpers ──────────────────────────────────────────────────────

// VSEN0 = 51 (4mA zero depth), VSEN5 = 254 (20mA full depth)
// With known range: show depth in metres. Without: show % of sensor full-scale.
function vsenDisplay(adc: number, rangeMetres?: number | null): string {
  if (adc === 0)  return `ADC ${adc} — sensor off / not connected`;
  if (adc < 51)   return `ADC ${adc} — below 4mA`;
  const pct = ((adc - 51) / 203) * 100;
  if (rangeMetres != null && rangeMetres > 0) {
    const depth = (pct / 100) * rangeMetres;
    return `${depth.toFixed(3)} m (ADC ${adc}, ${pct.toFixed(1)}% of ${rangeMetres} m range)`;
  }
  return `ADC ${adc} — ${pct.toFixed(1)}% of sensor range`;
}

function vwatDesc(adc: number): string {
  if (adc === 0) return "0 (OK / pressure present)";
  return `ADC ${adc} — no pressure / sensor active`;
}

function ESenseFields({ d, rangeMetres }: { d: Ewc25Decoded; rangeMetres?: number | null }) {
  // uid bytes 0-5 (3×2 hex chars) = VSEN1, VSEN2, VSEN3; bytes 6-7 = RS
  const vsen1 = parseInt(d.uid.slice(0, 2), 16);
  const vsen2 = parseInt(d.uid.slice(2, 4), 16);
  const vsen3 = parseInt(d.uid.slice(4, 6), 16);

  return (
    <>
      <Field label="Battery" value={`${d.batteryVolts.toFixed(2)} V`} />
      <Divider />
      <Field label="VSEN1 (tank depth)" value={vsenDisplay(vsen1, rangeMetres)} />
      <Field label="VSEN2" value={vsenDisplay(vsen2, rangeMetres)} />
      <Field label="VSEN3" value={vsenDisplay(vsen3, rangeMetres)} />
      <Field label="VWAT" value={vwatDesc(d.rs)} dim={d.rs === 0} />
      {(d.flowTicks > 0 || d.flowTimeSecs > 0) && (
        <>
          <Divider />
          <Field label="Hall-effect ticks" value={d.flowTicks.toLocaleString()} mono />
          <Field label="Flow time" value={`${d.flowTimeSecs} s`} />
        </>
      )}
      <Field label="Usage counter" value={d.usageCounter} mono />
    </>
  );
}

// ─── EWC2.5 datalog section renderers ─────────────────────────────────────────

function StandardFields({ d }: { d: Ewc25Decoded }) {
  const creditUsed = d.creditUsedMits;
  const dispensed = d.endCreditMits === 0xFFFFFFFF;

  return (
    <>
      <Field label="Battery" value={`${d.batteryVolts.toFixed(2)} V`} />
      <Field label="Tag UID" value={d.uid} mono />
      {d.event !== 0x02 && d.event !== 0x07 && (
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
            <Field label="Credit used" value={`${mitsToCredits(creditUsed)} credits`} />
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
      <Field label="Start credit" value={`${mitsToCredits(d.startCreditMits)} credits`} />
      <Field label="End credit" value={`${mitsToCredits(d.endCreditMits)} credits`} />
      <Divider />
      <Field label="Flow ticks" value={d.flowTicks.toLocaleString()} mono />
      <Field label="Litres dispensed" value={`~${d.litres.toFixed(2)} L`} />
      <Field label="Flow time" value={`${d.flowTimeSecs} s`} />
      {d.unmeteredFlowTicks !== undefined && (
        <Field label="Unmetered ticks (valve close)" value={d.unmeteredFlowTicks.toLocaleString()} mono />
      )}
    </>
  );
}

function TamperFields({ d }: { d: Ewc25Decoded }) {
  return (
    <>
      <Field label="Battery" value={`${d.batteryVolts.toFixed(2)} V`} />
      <Divider />
      <Field label="Tamper 1 (solar board)" value={d.tamper?.tamp1Open ? "OPEN ⚠" : "Closed"} dim={!d.tamper?.tamp1Open} />
      <Field label="Tamper 2 (bottom case)" value={d.tamper?.tamp2Open ? "OPEN ⚠" : "Closed"} dim={!d.tamper?.tamp2Open} />
    </>
  );
}

function PressureFields({ d }: { d: Ewc25Decoded }) {
  return (
    <>
      <Field label="Battery" value={`${d.batteryVolts.toFixed(2)} V`} />
      <Divider />
      <Field label="Pressure status" value={d.pressureOk ? "OK (pressure detected)" : "NO PRESSURE"} dim={d.pressureOk} />
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

// ─── EWC2.5 datalog packet (0x44) ─────────────────────────────────────────────

export function Ewc25PacketView({ hexPayload, isEsense = false, sensorRangeMetres }: { hexPayload: string; isEsense?: boolean; sensorRangeMetres?: number | null }) {
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

  // For eSENSE: events that use the UID field as VSEN data (everything except 0x18 tamper, 0x16 startup, 0x19 health-state)
  const esenseDataEvent = isEsense && ![0x18, 0x16, 0x19].includes(d.event);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded border", catStyle)}>
          {d.eventName}
        </span>
        {isEsense && (
          <span className="text-[10px] px-1 rounded bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20">
            eSENSE
          </span>
        )}
        <span className="text-[10px] font-mono text-muted-foreground">{d.deviceTimeStr}</span>
        <span className="ml-auto text-[10px] font-mono text-muted-foreground/50">EWC {d.ewcIdHex}</span>
        {!d.xorValid && <span className="text-[10px] text-red-500 font-semibold">XOR ERR</span>}
      </div>

      <div className="bg-muted/30 rounded px-2.5 py-1.5 space-y-0">
        {esenseDataEvent && <ESenseFields d={d} rangeMetres={sensorRangeMetres} />}
        {!esenseDataEvent && d.event === 0x01 && <NoCreditFields d={d} />}
        {!esenseDataEvent && d.event === 0x18 && <TamperFields d={d} />}
        {!esenseDataEvent && d.event === 0x13 && <PressureFields d={d} />}
        {d.event === 0x16 && <StartUpFields d={d} />}
        {d.event === 0x19 && <HealthStateFields d={d} />}
        {!esenseDataEvent && ![0x01, 0x18, 0x13, 0x16, 0x19].includes(d.event) && <StandardFields d={d} />}
        <Divider />
        <Field label="FCF (ticks/credit)" value={d.fcf} mono dim />
        <Field label="Log pointer" value={d.datalogPointer} mono dim />
      </div>

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

// ─── EWC reply data fields ─────────────────────────────────────────────────────

function ReplyDataFields({ data }: { data: EwcReplyData }) {
  switch (data.kind) {
    case "get-status":
      return (
        <>
          <Field label="Device time" value={data.deviceTimeStr} mono />
          <Field label="Tag UID" value={data.uid === "00000000" ? "No tag" : data.uid} mono dim={data.uid === "00000000"} />
          <Field label="Battery" value={`${data.batteryVolts.toFixed(2)} V`} />
          <Field label="Pressure" value={data.pressureOk ? "OK" : "NO PRESSURE"} dim={data.pressureOk} />
          <Divider />
          <Field label="Valve" value={data.valveOn ? "ON" : "Off"} dim={!data.valveOn} />
          <Field label="RFID" value={data.rfidDisabled ? "Disabled (host mode)" : "Enabled"} dim={!data.rfidDisabled} />
          <Field label="Low battery" value={data.lowBattery ? "Yes ⚠" : "No"} dim={!data.lowBattery} />
          <Field label="Tamper 1" value={data.tamp1 ? "Open ⚠" : "Closed"} dim={!data.tamp1} />
          <Field label="Tamper 2" value={data.tamp2 ? "Open ⚠" : "Closed"} dim={!data.tamp2} />
          {data.samplePeriodMs > 0 && (
            <>
              <Divider />
              <Field label="Flow sample count" value={data.flowCount} mono />
              <Field label="Sample period" value={`${data.samplePeriodMs} ms`} dim />
            </>
          )}
        </>
      );

    case "read-log": {
      const dl = data.datalog;
      if (!dl.valid) {
        return (
          <>
            <Field label="Log #" value={data.logNumber} mono />
            <Field label="Datalog" value={`Decode error: ${dl.reason}`} dim />
          </>
        );
      }
      const catStyle = categoryStyle(dl.category);
      return (
        <>
          <Field label="Log #" value={data.logNumber} mono />
          <div className="flex items-center gap-1.5 flex-wrap py-0.5">
            <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded border", catStyle)}>
              {dl.eventName}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">{dl.deviceTimeStr}</span>
          </div>
          <Divider />
          {dl.event === 0x01 && <NoCreditFields d={dl} />}
          {dl.event === 0x18 && <TamperFields d={dl} />}
          {dl.event === 0x13 && <PressureFields d={dl} />}
          {dl.event === 0x16 && <StartUpFields d={dl} />}
          {dl.event === 0x19 && <HealthStateFields d={dl} />}
          {![0x01, 0x18, 0x13, 0x16, 0x19].includes(dl.event) && <StandardFields d={dl} />}
        </>
      );
    }

    case "valve-on":
      return (
        <Field
          label="Start credit loaded"
          value={`${mitsToCredits(data.creditMits)} credits (${data.creditMits.toLocaleString()} MITs)`}
        />
      );

    case "valve-off":
    case "top-up":
      return (
        <Field
          label={data.kind === "top-up" ? "Accumulated credit" : "Remaining credit"}
          value={`${mitsToCredits(data.creditMits)} credits (${data.creditMits.toLocaleString()} MITs)`}
        />
      );

    case "eeprom-read":
      return (
        <>
          <Field label="EEPROM address" value={`0x${data.addr.toString(16).padStart(2, "0").toUpperCase()}`} mono />
          <Field label="Value" value={`0x${data.value.toString(16).padStart(2, "0").toUpperCase()} (${data.value})`} mono />
        </>
      );

    case "eeprom-word-read":
      return (
        <>
          <Field label="EEPROM address" value={`0x${data.addr.toString(16).padStart(2, "0").toUpperCase()}`} mono />
          <Field label="Value (word)" value={`0x${data.value.toString(16).padStart(4, "0").toUpperCase()} (${data.value})`} mono />
        </>
      );

    case "tick-accumulator":
      return <Field label="Tick accumulator" value={data.hex} mono />;

    case "generic":
      return <Field label="Data" value={data.rawHex} mono dim />;
  }
}

// ─── EWC reply packet view (0x80 / 0x88) ──────────────────────────────────────

export function EwcReplyView({ hexPayload }: { hexPayload: string }) {
  const [showRaw, setShowRaw] = useState(false);
  const result = decodeEwcReply(hexPayload);

  if (!result.valid) {
    return (
      <p className="text-[11px] font-mono text-muted-foreground break-all leading-relaxed">
        {hexPayload}
      </p>
    );
  }

  const r: EwcReplyDecoded = result;
  const badgeStyle = r.ok
    ? "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20"
    : "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded border", badgeStyle)}>
          {r.ok ? "← Reply" : "← Error"}
        </span>
        <span className="text-[10px] text-muted-foreground">{r.cmdName}</span>
        {!r.xorValid && <span className="text-[10px] text-red-500 font-semibold">XOR ERR</span>}
      </div>

      <div className="bg-muted/30 rounded px-2.5 py-1.5 space-y-0">
        <ReplyDataFields data={r.data} />
      </div>

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

// ─── CommandApi_1 packet view ──────────────────────────────────────────────────

export function CommandApiPacketView({ base64Payload }: { base64Payload: string }) {
  const [showRaw, setShowRaw] = useState(false);
  const decoded: CommandApiDecoded | null = decodeCommandApiPayload(base64Payload);

  if (!decoded) {
    return (
      <p className="text-[11px] font-mono text-muted-foreground break-all leading-relaxed">
        {base64Payload}
      </p>
    );
  }

  const label = decoded.cmdName
    ? (decoded.logNumber !== undefined ? `${decoded.cmdName} #${decoded.logNumber}` : decoded.cmdName)
    : "Unknown command";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
          → Command
        </span>
        <span className="text-[10px] text-muted-foreground">{label}</span>
        {decoded.retry && (
          <span className="text-[10px] px-1 rounded bg-muted text-muted-foreground border border-border">retry</span>
        )}
        {decoded.priority && decoded.priority !== "Normal" && (
          <span className="text-[10px] text-muted-foreground/60">{decoded.priority}</span>
        )}
      </div>

      <div className="bg-muted/30 rounded px-2.5 py-1.5 space-y-0">
        {decoded.outgoingPipeline && (
          <Field label="Pipeline" value={decoded.outgoingPipeline} mono dim />
        )}
        {decoded.priority && (
          <Field label="Priority" value={decoded.priority} dim />
        )}
      </div>

      <button
        className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
        onClick={() => setShowRaw((v) => !v)}
      >
        {showRaw ? "Hide inner hex ▲" : "Inner hex ▼"}
      </button>
      {showRaw && (
        <p className="text-[10px] font-mono break-all leading-relaxed text-muted-foreground bg-muted/20 rounded px-2 py-1.5">
          {decoded.rawInnerHex}
        </p>
      )}
    </div>
  );
}

export { EWC25_EVENT_NAMES, eventCategory };
