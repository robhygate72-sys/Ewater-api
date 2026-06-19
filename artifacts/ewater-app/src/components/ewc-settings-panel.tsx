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
  return `${((adc / 256) * 15).toFixed(2)}V (ADC ${adc})`;
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
            <span className="ml-auto text-[10px] font-normal text-muted-foreground">
              as of {data.settingsDate.slice(0, 10)}
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
              <Row label="FCF — ticks/credit" value={data.ewcFcf} mono title="FlowConversion: ticks of the flow meter per credit dispensed" />
              <Row label="LCF — ticks/litre" value={data.ewcLcf} mono title="LitresConversion: flow meter ticks per litre" />
              <Row label="FX — currency conversion" value={data.ewcFx?.toLocaleString()} mono title="CurrencyConversion: MITs per local currency unit" />
              {data.priceOfWater != null && (
                <Row label="Price of water" value={`${data.priceOfWater.toFixed(6)} /L`} mono title="Derived: FX × LCF / (FCF × 1,000,000)" />
              )}
              <Row label="Preload credit" value={data.ewcPreload} mono title="Preload: starting credit amount" />
            </SubSection>

            {/* Valve & Flow */}
            <SubSection title="Valve & Flow" icon={<Zap className="w-3 h-3" />}>
              <Row label="Valve drive time" value={data.valveDriveTime != null ? `${data.valveDriveTime} × 100 ms` : null} mono title="ValveDriveTime: time to hold solenoid (units of 100 ms)" />
              <Row label="Dispense time limit" value={data.dispenseTimeLimitMins != null ? `${data.dispenseTimeLimitMins} min` : null} mono title="DispenseTimeLimit: max dispense session duration (minutes)" />
              <Row label="Dispense flow limit" value={data.dispenseFlowLimitLpm != null ? `${data.dispenseFlowLimitLpm} L/min` : null} mono title="DispenseFlowLimit: minimum acceptable flow rate (L/min)" />
              <Row label="Preload charge" value={data.flowPreloadCharge} mono title="FlowPreloadCharge: credit pre-charged at start of dispense (ticks)" />
              <Row label="Preload threshold" value={data.flowPreloadThreshold} mono title="FlowPreloadThreshold: ticks after which preload is applied" />
            </SubSection>

            {/* No-flow detection */}
            <SubSection title="No-Flow Detection" icon={<Radio className="w-3 h-3" />}>
              <Row label="Cycle count" value={data.noFlowCycleCount} mono title="NoFlowCycleCount: polling cycles with no flow before alarm" />
              <Row label="Pulse count" value={data.noFlowPulseCount} mono title="NoFlowPulseCount: minimum pulse count expected per cycle" />
              <Row label="Lockout timeout" value={data.noFlowLockoutMins != null ? `${data.noFlowLockoutMins} min` : null} mono title="NoFlowLockoutTimeout: lockout duration after no-flow alarm (minutes)" />
              <Row label="Error control" value={data.noFlowErrorControl != null ? toHex32(data.noFlowErrorControl, 1) : null} mono title="NoFlowErrorControl: feature flags for no-flow error behaviour" />
            </SubSection>

            {/* Battery thresholds */}
            <SubSection title="Battery Thresholds" icon={<Battery className="w-3 h-3" />}>
              <Row label="Low battery warning" value={adcToVolts(data.lowBatteryWarningAdc)} mono title="LowBatteryWarning: ADC threshold for low battery alert (ADC/256×15V)" />
              <Row label="High battery value" value={adcToVolts(data.highBatteryValueAdc)} mono title="HighBatteryValue: ADC value representing a fully charged battery" />
            </SubSection>

            {/* Reporting & polling */}
            <SubSection title="Reporting & Polling" icon={<Clock className="w-3 h-3" />}>
              <Row label="Health state report period" value={data.healthStateReportPeriod != null ? `${data.healthStateReportPeriod} min` : null} mono title="HealthStateReportPeriod: how often health state packets are sent (minutes)" />
              <Row label="1st extended polling" value={data.firstExtendedPolling != null ? `${data.firstExtendedPolling} days` : null} mono title="FirstExtendedPolling: first polling interval extension (days)" />
              <Row label="2nd extended polling" value={data.secondExtendedPolling != null ? `${data.secondExtendedPolling} days` : null} mono title="SecondExtendedPolling: second polling interval extension (days)" />
              <Row label="Smart display control" value={data.smartDisplayControl != null ? toHex32(data.smartDisplayControl, 1) : null} mono title="SmartDisplayControl: feature flags for display behaviour" />
              <Row label="Proximity detection" value={data.proximityDetection != null ? toHex32(data.proximityDetection, 1) : null} mono title="ProximityDetection: feature flags for proximity sensor behaviour" />
            </SubSection>

            {/* RFID / Security */}
            <SubSection title="RFID / Security" icon={<Lock className="w-3 h-3" />}>
              <Row label="MIFARE block address" value={data.mifareBlockAddress} mono title="MiFareBlockAddress: block number on the MIFARE card used for EWC data" />
              <Row label="Access key index" value={data.ewcAccessKey} mono title="EwcAccessKey: which key slot is used for MIFARE authentication" />
              <Row label="Encryption control" value={data.encryptionControl != null ? toHex32(data.encryptionControl, 1) : null} mono title="EncryptionControl: encryption feature flags" />
              <Row label="Encryption seed" value={data.encryptionSeed != null ? toHex32(data.encryptionSeed) : null} mono title="EncryptionSeed: seed value for encryption/decryption" />
              <Row label="Key A" value={toHex48(data.keyA)} mono title="KeyA: 6-byte MIFARE authentication key A" />
              <Row label="Auth code" value={data.ewcAuthCode != null ? toHex32(data.ewcAuthCode) : null} mono title="EwcAuthCode: EWC authentication code" />
              <Row label="Supertap mask" value={data.supertapEncryptionMask != null ? toHex32(data.supertapEncryptionMask) : null} mono title="SupertapEncryptionMask: bit mask used in supertap encryption" />
            </SubSection>

            {/* Device */}
            <SubSection title="Device" icon={<Cpu className="w-3 h-3" />}>
              <Row label="EWC device ID" value={data.ewcDeviceId != null ? toHex32(data.ewcDeviceId) : null} mono title="EwcId: unique hardware identifier of this EWC device" />
              <Row label="Power cycle count" value={data.powerCount} mono title="PowerCount: number of times the device has power-cycled" />
            </SubSection>
          </>
        )}
      </CardContent>
    </Card>
  );
}
