import { useState } from "react";
import { useGetAssetEwc, getGetAssetEwcQueryKey } from "@workspace/api-client-react";
import { Settings, Droplet, Zap, Radio, Battery, Clock, Lock, Cpu, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface SettingDetail {
  label: string;
  display: React.ReactNode;
  rawValue: string | number | null | undefined;
  description: string;
}

function Row({
  label,
  value,
  mono = false,
  rawValue,
  description,
  onTap,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  rawValue?: string | number | null;
  description: string;
  onTap: (detail: SettingDetail) => void;
}) {
  if (value == null) return null;
  return (
    <button
      className="w-full flex justify-between items-center py-2 border-b border-border/40 last:border-0 gap-4 text-left active:bg-muted/50 transition-colors"
      onClick={() => onTap({ label, display: value, rawValue: rawValue ?? null, description })}
    >
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <div className="flex items-center gap-1 min-w-0">
        <span className={`text-xs font-medium text-right truncate ${mono ? "font-mono" : ""}`}>{value}</span>
        <ChevronRight className="w-3 h-3 text-muted-foreground/50 shrink-0" />
      </div>
    </button>
  );
}

function SubSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="flex items-center gap-1.5 mb-1 pb-1 border-b border-border/20">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</span>
      </div>
      {children}
    </div>
  );
}

function adcToVolts(adc: number | null | undefined): string | null {
  if (adc == null) return null;
  return `${((adc / 256) * 15).toFixed(2)} V (ADC ${adc})`;
}

function toHex32(n: number | null | undefined, bytes = 4): string | null {
  if (n == null) return null;
  return "0x" + (n >>> 0).toString(16).padStart(bytes * 2, "0").toUpperCase();
}

function toHex48(n: number | null | undefined): string | null {
  if (n == null) return null;
  const hex = n.toString(16).padStart(12, "0").toUpperCase();
  return "0x" + hex.match(/.{2}/g)!.join(" ");
}

function onOffHex(n: number | null | undefined): string | null {
  if (n == null) return null;
  const h = toHex32(n, 1)!;
  if (n === 0xFF) return `${h} (enabled)`;
  if (n === 0x00) return `${h} (disabled)`;
  return h;
}

function pollTime(hiByteVal: number | null | undefined): string | null {
  if (hiByteVal == null) return null;
  const secs = hiByteVal * 256;
  const mins = Math.round(secs / 60);
  return `${hiByteVal} × 256 s (≈ ${mins} min)`;
}

function dispenseTime(hiByteVal: number | null | undefined): string | null {
  if (hiByteVal == null) return null;
  const secs = hiByteVal * 256;
  const mins = Math.round(secs / 60);
  return `${hiByteVal} × 256 s (≈ ${mins} min)`;
}

function dispenseFlow(hiByteVal: number | null | undefined, lcf: number | null | undefined): string | null {
  if (hiByteVal == null) return null;
  const ticks = hiByteVal * 65536;
  const litres = lcf != null && lcf > 0 ? Math.round(ticks / lcf) : null;
  return `${hiByteVal} × 65536 ticks${litres != null ? ` (≈ ${litres.toLocaleString()} L)` : ""}`;
}

function rawStr(v: string | number | null | undefined): string {
  if (v == null) return "—";
  return String(v);
}

interface EwcSettingsPanelProps {
  assetId: string;
}

export function EwcSettingsPanel({ assetId }: EwcSettingsPanelProps) {
  const { data, isLoading, isError } = useGetAssetEwc(assetId, {
    query: { queryKey: getGetAssetEwcQueryKey(assetId) },
  });

  const [detail, setDetail] = useState<SettingDetail | null>(null);

  const tap = (d: SettingDetail) => setDetail(d);

  return (
    <>
      <Card className="rounded-2xl shadow-sm border-border/60">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Settings className="w-3.5 h-3.5 text-muted-foreground" />
            EWC Settings
            {data?.settingsDate && (
              <span className="ml-auto text-[10px] font-normal text-muted-foreground font-mono">
                as of {data.settingsDate.slice(0, 19).replace("T", " ")}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {isLoading && (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          )}
          {isError && (
            <p className="text-xs text-destructive">Failed to load EWC settings.</p>
          )}
          {data && (
            <>
              {/* Calibration */}
              <SubSection title="Calibration" icon={<Droplet className="w-3 h-3" />}>
                <Row label="FCF — ticks/credit" value={data.ewcFcf} rawValue={data.ewcFcf} mono onTap={tap}
                  description="FCF (FlowConversion): flow-meter tick divisor per credit. Credit deducted = ticks ÷ FCF. EEPROM bytes 0x19–0x1A."
                />
                <Row label="LCF — ticks/litre" value={data.ewcLcf} rawValue={data.ewcLcf} mono onTap={tap}
                  description="LCF (LitresConversion): flow-meter ticks per litre. Used to convert tick count to litres. EEPROM bytes 0x30–0x31 (default 360)."
                />
                <Row label="FX — currency conversion" value={data.ewcFx?.toLocaleString()} rawValue={data.ewcFx} mono onTap={tap}
                  description="FX (CurrencyConversion): price per credit in units of 1/1,000,000 of local currency. EEPROM bytes 0x2C–0x2F."
                />
                {data.priceOfWater != null && (
                  <Row label="Price of water (derived)" value={`${data.priceOfWater.toFixed(6)} /L`} rawValue={data.priceOfWater} mono onTap={tap}
                    description="Derived value — not stored in EEPROM. Calculated as: FX × LCF ÷ (FCF × 1,000,000) = price per litre in local currency."
                  />
                )}
                {data.ewcPreload != null && (
                  <Row label="Preload credit" value={data.ewcPreload} rawValue={data.ewcPreload} mono onTap={tap}
                    description="Preload: credit pre-loaded onto tap for host-controlled (Valve ON) dispensing."
                  />
                )}
              </SubSection>

              {/* Valve & Flow */}
              <SubSection title="Valve & Flow" icon={<Zap className="w-3 h-3" />}>
                <Row label="Valve drive time" mono onTap={tap} rawValue={data.valveDriveTime}
                  value={data.valveDriveTime != null ? `${data.valveDriveTime} s${data.valveDriveTime === 0 ? " (30 ms pulse)" : ""}` : null}
                  description="ValveDriveTime: how long the solenoid valve is held driven open/closed (seconds). EEPROM byte 0x1F (default 6 s). A value of 0 selects a 30 ms pulse suitable for latching solenoid valves."
                />
                <Row label="Dispense time limit" mono onTap={tap} rawValue={data.dispenseTimeLimitMins}
                  value={dispenseTime(data.dispenseTimeLimitMins)}
                  description="DispenseTimeLimit: HI-byte of a 16-bit seconds value (actual threshold = N × 256 s). When exceeded during Valve-ON, a Dispense-Limit event is generated and the valve briefly cycles OFF/ON. EEPROM byte 0x2A (default 7 → ≈ 30 min)."
                />
                <Row label="Dispense flow limit" mono onTap={tap} rawValue={data.dispenseFlowLimitLpm}
                  value={dispenseFlow(data.dispenseFlowLimitLpm, data.ewcLcf)}
                  description="DispenseFlowLimit: HI-byte of a 24-bit flow-tick count limit (actual = N × 65536 ticks). When exceeded during Valve-ON, a Dispense-Limit event is generated and the valve briefly cycles. Convert to litres using LCF. EEPROM byte 0x2B (default 1 → ≈ 182 L at LCF 360)."
                />
                <Row label="Pre-load value" mono onTap={tap} rawValue={data.flowPreloadCharge}
                  value={data.flowPreloadCharge != null ? `${data.flowPreloadCharge} ticks` : null}
                  description="PRE-LOAD-VALUE: number of extra flow-meter ticks added to the running total when the PRE-LOAD-PERIOD threshold is reached. Accounts for un-metered water at the start of dispensing (e.g. pipe fill, valve travel). EEPROM bytes 0x17–0x18 (default 360 = 1 L at LCF 360)."
                />
                <Row label="Pre-load period" mono onTap={tap} rawValue={data.flowPreloadThreshold}
                  value={data.flowPreloadThreshold != null
                    ? (data.flowPreloadThreshold === 0 ? "0 ticks (add at dispense start)" : `${data.flowPreloadThreshold} ticks`)
                    : null}
                  description="PRE-LOAD-PERIOD: accumulated flow-tick count at which PRE-LOAD-VALUE ticks are added to the dispense total. 0 = add immediately at the start of dispensing. EEPROM bytes 0x26–0x27 (default 0)."
                />
              </SubSection>

              {/* No-flow detection */}
              <SubSection title="No-Flow Detection" icon={<Radio className="w-3 h-3" />}>
                <Row label="Cycle count" mono onTap={tap} rawValue={data.noFlowCycleCount}
                  value={data.noFlowCycleCount != null ? `${data.noFlowCycleCount} s` : null}
                  description="NoFlowCycleCount: time period in seconds over which the flow pulse count is measured. If the count falls below the Min Pulse Count within this window, the NO_FLOW alarm triggers. EEPROM byte 0x1C (default 14 s)."
                />
                <Row label="Min pulse count" mono onTap={tap} rawValue={data.noFlowPulseCount}
                  value={data.noFlowPulseCount != null ? `${data.noFlowPulseCount} ticks/cycle` : null}
                  description="NoFlowPulseCount: minimum flow-meter tick count expected within the cycle period. If actual count is less than this threshold, NO_FLOW alarm triggers. EEPROM bytes 0x1D–0x1E (default 360 = 1 L at LCF 360)."
                />
                <Row label="Lockout timeout" mono onTap={tap} rawValue={data.noFlowLockoutMins}
                  value={data.noFlowLockoutMins != null ? `${data.noFlowLockoutMins} s` : null}
                  description="NoFlowLockoutTimeout: valve lock-out duration in seconds after a NO_FLOW alarm triggers. Tap is locked until timeout expires (or tag is removed). EEPROM byte 0x20 (default 30 s)."
                />
                <Row label="Error control" mono onTap={tap} rawValue={data.noFlowErrorControl}
                  value={onOffHex(data.noFlowErrorControl)}
                  description="NoFlowErrorControl: 0xFF = no-flow detection fully enabled, 0x00 = disabled (useful for in-house valve/meter mode where no-flow errors would be spurious). EEPROM byte 0x25."
                />
              </SubSection>

              {/* Battery thresholds */}
              <SubSection title="Battery Thresholds" icon={<Battery className="w-3 h-3" />}>
                <Row label="Low battery warning" mono onTap={tap} rawValue={data.lowBatteryWarningAdc}
                  value={adcToVolts(data.lowBatteryWarningAdc)}
                  description="LowBatteryWarning: ADC threshold (voltage = ADC ÷ 256 × 15 V) below which the low-battery alarm triggers and water dispensing stops. Red+Blue LED flashes every 8 s. EEPROM byte 0x28 (default 203 ≈ 11.9 V)."
                />
                <Row label="High battery value" mono onTap={tap} rawValue={data.highBatteryValueAdc}
                  value={adcToVolts(data.highBatteryValueAdc)}
                  description="HighBatteryValue: ADC threshold (voltage = ADC ÷ 256 × 15 V) above which normal operation resumes after a low-battery condition. EEPROM byte 0x29 (default 212 ≈ 12.4 V)."
                />
              </SubSection>

              {/* Reporting & polling */}
              <SubSection title="Reporting & Polling" icon={<Clock className="w-3 h-3" />}>
                <Row label="Health state report period" mono onTap={tap} rawValue={data.healthStateReportPeriod}
                  value={data.healthStateReportPeriod != null
                    ? (data.healthStateReportPeriod === 0 ? "0 (disabled)" : `${data.healthStateReportPeriod} min`)
                    : null}
                  description="HealthStateReportPeriod: interval in minutes between automatic HEALTH_STATE datalog packets (event code 0x19). Range 1–255 min; 0 = disabled. Note: HEALTH_STATE packets are transmitted but NOT stored in internal EEPROM log memory. EEPROM byte 0x1B."
                />
                <Row label="1st extended polling" mono onTap={tap} rawValue={data.firstExtendedPolling}
                  value={pollTime(data.firstExtendedPolling)}
                  description="Tag Polling Period 1: HI-byte of the first extended sleep interval (actual = N × 256 s). After 1 hour of inactivity the EWC increases its sleep period to this value. EEPROM byte 0x21 (default 0x0E → 3584 s ≈ 1 h)."
                />
                <Row label="2nd extended polling" mono onTap={tap} rawValue={data.secondExtendedPolling}
                  value={pollTime(data.secondExtendedPolling)}
                  description="Tag Polling Period 2: HI-byte of the second extended sleep interval (actual = N × 256 s). After 2 hours of inactivity the EWC increases its sleep period further to this value. EEPROM byte 0x22 (default 0x1C → 7168 s ≈ 2 h)."
                />
                <Row label="SMARTD display" mono onTap={tap} rawValue={data.smartDisplayControl}
                  value={onOffHex(data.smartDisplayControl)}
                  description="SmartDisplayControl: 0xFF = SMARTD consumer display messages (COM2) enabled; 0x00 = disabled. Controls output of 'S' messages to the Display-Lite OLED module if fitted. EEPROM byte 0x23."
                />
                <Row label="Proximity detection" mono onTap={tap} rawValue={data.proximityDetection}
                  value={onOffHex(data.proximityDetection)}
                  description="ProximityDetection (Magnetic Prox): 0xFF = magnetic proximity (reed switch / magnet) detection enabled — PROX event generated and Blue LED flashes 3× when magnet presented without tag; 0x00 = disabled. EEPROM byte 0x24."
                />
              </SubSection>

              {/* RFID / Security */}
              <SubSection title="RFID / Security" icon={<Lock className="w-3 h-3" />}>
                <Row label="MIFARE block address" mono onTap={tap} rawValue={data.mifareBlockAddress}
                  value={data.mifareBlockAddress}
                  description="MiFareBlockAddress: block number on the MIFARE 1k card where EWC credit data is stored (0–255). EEPROM byte 0x02 (default 10 = block 0x0A in Sector 3)."
                />
                <Row label="Key number/type" mono onTap={tap} rawValue={data.ewcAccessKey}
                  value={data.ewcAccessKey}
                  description="EwcAccessKey: key number/type byte used for MIFARE block access. Bit 7 = key type (0 = KeyA, 1 = KeyB); bits 4:0 = key code number (0–31). EEPROM byte 0x03 (default 5 = KeyA, code 5)."
                />
                <Row label="Encryption control" mono onTap={tap} rawValue={data.encryptionControl}
                  value={onOffHex(data.encryptionControl)}
                  description="EncryptionControl: 0xFF = dynamic 32-bit software encryption of card data enabled; 0x00 = disabled (plain data). EEPROM byte 0x04."
                />
                <Row label="Encryption seed" mono onTap={tap} rawValue={data.encryptionSeed}
                  value={data.encryptionSeed != null ? toHex32(data.encryptionSeed) : null}
                  description="EncryptionSeed (Seed1): 32-bit seed for the dynamic card encryption/decryption algorithm. Combined with the card UID to scramble card data. EEPROM bytes 0x05–0x08 (default 0x01030907)."
                />
                <Row label="Key A" mono onTap={tap} rawValue={data.keyA}
                  value={toHex48(data.keyA)}
                  description="KeyA: 6-byte MIFARE CRYPTO1 authentication key A used to unlock Sector 3 (Block 11) for read/write operations. EEPROM bytes 0x09–0x0E (default 0xEF F2 6D 53 42 8C)."
                />
                <Row label="Auth code" mono onTap={tap} rawValue={data.ewcAuthCode}
                  value={data.ewcAuthCode != null ? toHex32(data.ewcAuthCode) : null}
                  description="EwcAuthCode: 4-byte authentication code stored in both the EWC EEPROM (bytes 0x0F–0x12) and on card block data (bytes 0–3 of Block 9). Used to verify a card is a valid eWater card before any credit operation. Default 0x8F 67 CE B9."
                />
                <Row label="SuperTap encrypt mask" mono onTap={tap} rawValue={data.supertapEncryptionMask}
                  value={data.supertapEncryptionMask != null ? toHex32(data.supertapEncryptionMask) : null}
                  description="SupertapEncryptionMask: 32-bit pseudo-UID seed (stored as a 'fake' card UID) used to decrypt encrypted SuperTap top-up UID and credit values received from the host system. EEPROM bytes 0x13–0x16 (default 0xE9 FD 1A B7)."
                />
              </SubSection>

              {/* Device */}
              <SubSection title="Device" icon={<Cpu className="w-3 h-3" />}>
                <Row label="EWC device ID" mono onTap={tap} rawValue={data.ewcDeviceId}
                  value={data.ewcDeviceId != null ? toHex32(data.ewcDeviceId) : null}
                  description="EwcId: 4-byte unique hardware identifier of this EWC board. Used to authenticate the REQUEST TO PROGRAM command (preventing accidental reprogramming of the wrong unit). EEPROM bytes 0x32–0x35. Not cleared by Factory Reset."
                />
                <Row label="Power cycle count" mono onTap={tap} rawValue={data.powerCount}
                  value={data.powerCount}
                  description="PowerCount: cumulative power-on/reset count. Increments on each power-up or reset event. Reported in the START_UP datalog packet (event code 0x16). EEPROM byte 0x36. Not cleared by Factory Reset."
                />
              </SubSection>
            </>
          )}
        </CardContent>
      </Card>

      {/* Detail sheet */}
      <Sheet open={detail !== null} onOpenChange={(open) => { if (!open) setDetail(null); }}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[80vh] overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-border/40 mb-4">
            <SheetTitle className="text-base">{detail?.label}</SheetTitle>
          </SheetHeader>

          {detail && (
            <div className="space-y-4 pb-safe">
              {/* Formatted value */}
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Value</p>
                <p className="text-sm font-mono font-medium">{detail.display}</p>
              </div>

              {/* Raw value */}
              {detail.rawValue != null && String(detail.rawValue) !== String(detail.display) && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Raw</p>
                  <p className="text-sm font-mono text-muted-foreground">{rawStr(detail.rawValue)}</p>
                </div>
              )}

              {/* Description */}
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Description</p>
                <p className="text-sm text-foreground leading-relaxed">{detail.description}</p>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
