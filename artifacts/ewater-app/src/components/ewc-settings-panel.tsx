import { useGetAssetEwc, getGetAssetEwcQueryKey } from "@workspace/api-client-react";
import { Settings, Droplet, Zap, Radio, Battery, Clock, Lock, Cpu } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function Row({ label, value, mono = false, title }: { label: string; value: React.ReactNode; mono?: boolean; title?: string }) {
  if (value == null) return null;
  return (
    <div className="flex justify-between items-center py-2 border-b border-border/40 last:border-0 gap-4">
      <span className="text-xs text-muted-foreground shrink-0" title={title}>{label}</span>
      <span className={`text-xs font-medium text-right ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
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

interface EwcSettingsPanelProps {
  assetId: string;
}

export function EwcSettingsPanel({ assetId }: EwcSettingsPanelProps) {
  const { data, isLoading, isError } = useGetAssetEwc(assetId, {
    query: { queryKey: getGetAssetEwcQueryKey(assetId) },
  });

  return (
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
              <Row
                label="FCF — ticks/credit"
                value={data.ewcFcf}
                mono
                title="FCF (FlowConversion): flow-meter tick divisor per credit. Credit deducted = ticks ÷ FCF. EEPROM bytes 0x19–0x1A."
              />
              <Row
                label="LCF — ticks/litre"
                value={data.ewcLcf}
                mono
                title="LCF (LitresConversion): flow-meter ticks per litre. Used to convert tick count to litres. EEPROM bytes 0x30–0x31 (default 360)."
              />
              <Row
                label="FX — currency conversion"
                value={data.ewcFx?.toLocaleString()}
                mono
                title="FX (CurrencyConversion): price per credit in units of 1/1,000,000 of local currency. EEPROM bytes 0x2C–0x2F."
              />
              {data.priceOfWater != null && (
                <Row
                  label="Price of water (derived)"
                  value={`${data.priceOfWater.toFixed(6)} /L`}
                  mono
                  title="Derived: FX × LCF ÷ (FCF × 1,000,000) — price per litre in local currency."
                />
              )}
              <Row
                label="Preload credit"
                value={data.ewcPreload}
                mono
                title="Preload: credit pre-loaded onto tap for host-controlled dispensing."
              />
            </SubSection>

            {/* Valve & Flow */}
            <SubSection title="Valve & Flow" icon={<Zap className="w-3 h-3" />}>
              <Row
                label="Valve drive time"
                value={data.valveDriveTime != null ? `${data.valveDriveTime} s${data.valveDriveTime === 0 ? " (30 ms pulse — latching solenoid)" : ""}` : null}
                mono
                title="ValveDriveTime: how long the solenoid valve is driven open/closed (seconds). EEPROM byte 0x1F (default 6 s). Zero selects a 30 ms pulse for latching solenoid valves."
              />
              <Row
                label="Dispense time limit"
                value={dispenseTime(data.dispenseTimeLimitMins)}
                mono
                title="DispenseTimeLimit: HI-byte of 16-bit value in seconds (actual = N × 256 s). A Dispense-Limit event is generated when exceeded, valve briefly cycles. EEPROM byte 0x2A (default 7, i.e. ≈ 30 min)."
              />
              <Row
                label="Dispense flow limit"
                value={dispenseFlow(data.dispenseFlowLimitLpm, data.ewcLcf)}
                mono
                title="DispenseFlowLimit: HI-byte of 24-bit flow tick limit (actual = N × 65536 ticks). A Dispense-Limit event is generated when exceeded, valve briefly cycles. EEPROM byte 0x2B (default 1, ≈ 182 L at LCF 360)."
              />
              <Row
                label="Pre-load value"
                value={data.flowPreloadCharge != null ? `${data.flowPreloadCharge} ticks` : null}
                mono
                title="PRE-LOAD-VALUE: number of extra flow-meter ticks added to the running total when the PRE-LOAD-PERIOD is reached. Accounts for un-metered water. EEPROM bytes 0x17–0x18 (default 360 = 1 L)."
              />
              <Row
                label="Pre-load period"
                value={data.flowPreloadThreshold != null
                  ? (data.flowPreloadThreshold === 0 ? "0 ticks (add at dispense start)" : `${data.flowPreloadThreshold} ticks`)
                  : null}
                mono
                title="PRE-LOAD-PERIOD: accumulated flow-tick count at which PRE-LOAD-VALUE is added. 0 = add immediately at start of dispensing. EEPROM bytes 0x26–0x27 (default 0)."
              />
            </SubSection>

            {/* No-flow detection */}
            <SubSection title="No-Flow Detection" icon={<Radio className="w-3 h-3" />}>
              <Row
                label="Cycle count"
                value={data.noFlowCycleCount != null ? `${data.noFlowCycleCount} s` : null}
                mono
                title="NoFlowCycleCount: timeout period in seconds that the flow pulse count is measured over. If flow count < pulse-count threshold in this period, NO_FLOW alarm triggers. EEPROM byte 0x1C (default 14 s)."
              />
              <Row
                label="Min pulse count"
                value={data.noFlowPulseCount != null ? `${data.noFlowPulseCount} ticks/cycle` : null}
                mono
                title="NoFlowPulseCount: minimum flow-meter tick count expected within the cycle period. If actual count is less, NO_FLOW alarm triggers. EEPROM bytes 0x1D–0x1E (default 360 = 1 L at LCF 360)."
              />
              <Row
                label="Lockout timeout"
                value={data.noFlowLockoutMins != null ? `${data.noFlowLockoutMins} s` : null}
                mono
                title="NoFlowLockoutTimeout: valve lock-out duration in seconds after a NO_FLOW alarm. EEPROM byte 0x20 (default 30 s)."
              />
              <Row
                label="Error control"
                value={onOffHex(data.noFlowErrorControl)}
                mono
                title="NoFlowErrorControl: 0xFF = no-flow detection enabled, 0x00 = disabled (use for in-house valve/meter mode). EEPROM byte 0x25."
              />
            </SubSection>

            {/* Battery thresholds */}
            <SubSection title="Battery Thresholds" icon={<Battery className="w-3 h-3" />}>
              <Row
                label="Low battery warning"
                value={adcToVolts(data.lowBatteryWarningAdc)}
                mono
                title="LowBatteryWarning: ADC threshold below which the low-battery alarm triggers and dispensing stops (voltage = ADC ÷ 256 × 15 V). EEPROM byte 0x28 (default 203 ≈ 11.9 V)."
              />
              <Row
                label="High battery value"
                value={adcToVolts(data.highBatteryValueAdc)}
                mono
                title="HighBatteryValue: ADC threshold above which normal operation resumes after a low-battery condition (voltage = ADC ÷ 256 × 15 V). EEPROM byte 0x29 (default 212 ≈ 12.4 V)."
              />
            </SubSection>

            {/* Reporting & polling */}
            <SubSection title="Reporting & Polling" icon={<Clock className="w-3 h-3" />}>
              <Row
                label="Health state report period"
                value={data.healthStateReportPeriod != null
                  ? (data.healthStateReportPeriod === 0 ? "0 (disabled)" : `${data.healthStateReportPeriod} min`)
                  : null}
                mono
                title="HealthStateReportPeriod: interval between automatic HEALTH_STATE datalog packets (1–255 minutes). 0 = disabled. EEPROM byte 0x1B."
              />
              <Row
                label="1st extended polling"
                value={pollTime(data.firstExtendedPolling)}
                mono
                title="Tag Polling Period 1: HI-byte of polling interval (actual = N × 256 s). After 1 hour of inactivity the sleep period extends to this value. EEPROM byte 0x21 (default 0x0E → 3584 s ≈ 1 h)."
              />
              <Row
                label="2nd extended polling"
                value={pollTime(data.secondExtendedPolling)}
                mono
                title="Tag Polling Period 2: HI-byte of polling interval (actual = N × 256 s). After 2 hours of inactivity the sleep period extends to this value. EEPROM byte 0x22 (default 0x1C → 7168 s ≈ 2 h)."
              />
              <Row
                label="SMARTD display"
                value={onOffHex(data.smartDisplayControl)}
                mono
                title="SmartDisplayControl: 0xFF = SMARTD consumer display messages enabled, 0x00 = disabled. EEPROM byte 0x23."
              />
              <Row
                label="Proximity detection"
                value={onOffHex(data.proximityDetection)}
                mono
                title="ProximityDetection: 0xFF = magnetic proximity (reed switch) detection enabled, 0x00 = disabled. EEPROM byte 0x24."
              />
            </SubSection>

            {/* RFID / Security */}
            <SubSection title="RFID / Security" icon={<Lock className="w-3 h-3" />}>
              <Row
                label="MIFARE block address"
                value={data.mifareBlockAddress}
                mono
                title="MiFareBlockAddress: block number on the MIFARE 1k card where EWC credit data is stored (0–255). EEPROM byte 0x02 (default 10 = block 0x0A)."
              />
              <Row
                label="Key number/type"
                value={data.ewcAccessKey}
                mono
                title="EwcAccessKey: key number/type byte. Bit 7 = key type (0=KeyA, 1=KeyB); bits 4:0 = key code number (0–31). EEPROM byte 0x03 (default 5 = KeyA, code 5)."
              />
              <Row
                label="Encryption control"
                value={onOffHex(data.encryptionControl)}
                mono
                title="EncryptionControl: 0xFF = card data encryption enabled, 0x00 = disabled. EEPROM byte 0x04."
              />
              <Row
                label="Encryption seed"
                value={data.encryptionSeed != null ? toHex32(data.encryptionSeed) : null}
                mono
                title="EncryptionSeed: 32-bit seed (Seed1) for the dynamic card encryption algorithm. EEPROM bytes 0x05–0x08 (default 0x01030907)."
              />
              <Row
                label="Key A"
                value={toHex48(data.keyA)}
                mono
                title="KeyA: 6-byte MIFARE CRYPTO1 authentication key A for block access. Stored in EEPROM bytes 0x09–0x0E (default 0xEF F2 6D 53 42 8C)."
              />
              <Row
                label="Auth code"
                value={data.ewcAuthCode != null ? toHex32(data.ewcAuthCode) : null}
                mono
                title="EwcAuthCode: 4-byte code stored in EEPROM (bytes 0x0F–0x12) and on card block data. Used to authenticate cards as valid eWater cards (default 0x8F 67 CE B9)."
              />
              <Row
                label="SuperTap encrypt mask"
                value={data.supertapEncryptionMask != null ? toHex32(data.supertapEncryptionMask) : null}
                mono
                title="SupertapEncryptionMask: 32-bit pseudo-UID seed used to decrypt encrypted SuperTap top-up UID and credit values received from the host. EEPROM bytes 0x13–0x16 (default 0xE9 FD 1A B7)."
              />
            </SubSection>

            {/* Device */}
            <SubSection title="Device" icon={<Cpu className="w-3 h-3" />}>
              <Row
                label="EWC device ID"
                value={data.ewcDeviceId != null ? toHex32(data.ewcDeviceId) : null}
                mono
                title="EwcId: 4-byte unique hardware identifier of this EWC board. EEPROM bytes 0x32–0x35. Not reset by Factory Reset."
              />
              <Row
                label="Power cycle count"
                value={data.powerCount}
                mono
                title="PowerCount: cumulative power-on/reset count. Increments on each power-up. EEPROM byte 0x36. Not reset by Factory Reset."
              />
            </SubSection>
          </>
        )}
      </CardContent>
    </Card>
  );
}
