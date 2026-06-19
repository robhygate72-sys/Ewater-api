// EWC2.5 39-byte DATALOG packet decoder
// Protocol reference: EWC2_5_PRE-LOAD_RS232_cmds_confidential_080324

export const EWC25_EVENT_NAMES: Record<number, string> = {
  0x00: "No Error",
  0x01: "No Credit",
  0x02: "Format – ID Fail",
  0x03: "Not Mifare 1k",
  0x04: "Keycode Load Error",
  0x05: "Card Comms Error",
  0x06: "Auth Error (CRYPTO1)",
  0x07: "Format – Checksum Fail",
  0x08: "EEPROM Write Error (Int)",
  0x09: "Tag Removed",
  0x0a: "RS232 Command Error",
  0x0b: "Dispense Limit",
  0x0c: "EEPROM Write Error (Ext)",
  0x0d: "MFRC Chip Error",
  0x0e: "Block Read Error",
  0x0f: "Block Write Error",
  0x10: "No Flow",
  0x11: "Prox Detect",
  0x12: "Low Battery",
  0x13: "Pressure Event",
  0x14: "SuperTap Top-Up",
  0x15: "Host Valve Off",
  0x16: "Start-Up",
  0x17: "No Flow Repeat",
  0x18: "Tamper",
  0x19: "Health State",
};

export type EventCategory = "dispense" | "error" | "warning" | "status" | "startup";

export function eventCategory(code: number): EventCategory {
  if (code === 0x16) return "startup";
  if (code === 0x19 || code === 0x18 || code === 0x13 || code === 0x11) return "status";
  if (code === 0x12 || code === 0x01 || code === 0x10 || code === 0x17) return "warning";
  if (code >= 0x02 && code <= 0x0f) return "error";
  return "dispense";
}

function bcd(byte: number): number {
  return ((byte >> 4) & 0xf) * 10 + (byte & 0xf);
}

function uint16(hi: number, lo: number): number {
  return (hi << 8) | lo;
}

function uint24(b0: number, b1: number, b2: number): number {
  return (b0 << 16) | (b1 << 8) | b2;
}

function uint32(b0: number, b1: number, b2: number, b3: number): number {
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
}

function xorAll(bytes: number[]): number {
  return bytes.reduce((acc, b) => acc ^ b, 0);
}

function hexStr(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join("");
}

export interface Ewc25DeviceTime {
  seconds: number;
  minutes: number;
  hours: number;
  day: number;
  month: number;
  year: number; // 2-digit; add 2000 for full year
}

export interface Ewc25HealthState {
  vbatAdcRaw: number;
  vwatAdcRaw: number;
  vsen1: number;
  vsen2: number;
  vsen3: number;
  tickAccumulatorHex: string;
  flags: {
    tamp2: boolean;
    tamp1: boolean;
    gsmNotLocked: boolean;
    valveOn: boolean;
    lockFlag: boolean;
    proxFlag: boolean;
    lowBattery: boolean;
    rfidDisabled: boolean;
  };
}

export interface Ewc25Decoded {
  valid: true;
  ewcId: number;
  ewcIdHex: string;

  event: number;
  eventName: string;
  category: EventCategory;

  deviceTime: Ewc25DeviceTime;
  deviceTimeStr: string; // "HH:MM:SS DD/MM/YYYY"

  uid: string; // 8-char hex, uppercase
  batteryAdcRaw: number;
  batteryVolts: number; // ADC / 256 * 15, rounded to 2dp

  // Standard fields (most events)
  rs: number;
  usageCounter: number;
  startCreditMits: number;
  endCreditMits: number;
  creditUsedMits: number;
  flowTicks: number;
  litres: number; // flowTicks / 360
  flowTimeSecs: number;

  // Conversion factor (FCF from packet trailer, ticks per credit)
  fcf: number;
  datalogPointer: number;

  xorValid: boolean;

  // Event-specific extras (only present when relevant)
  unmeteredFlowTicks?: number; // event 0x01 No-Credit: overwrites usageCounter
  tamper?: { tamp1Open: boolean; tamp2Open: boolean };
  pressureOk?: boolean; // event 0x13: rs == 0 means OK
  startUp?: { powerUpCount: number; firmwareDateStr: string };
  healthState?: Ewc25HealthState;
}

export interface Ewc25Invalid {
  valid: false;
  reason: string;
}

export type Ewc25Result = Ewc25Decoded | Ewc25Invalid;

// Parse space-separated or continuous hex string into byte array
function parseHex(hex: string): number[] | null {
  const clean = hex.replace(/\s+/g, "");
  if (clean.length % 2 !== 0) return null;
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    const v = parseInt(clean.slice(i, i + 2), 16);
    if (isNaN(v)) return null;
    bytes.push(v);
  }
  return bytes;
}

export function decodeEwc25(hexPayload: string): Ewc25Result {
  const bytes = parseHex(hexPayload);
  if (!bytes) return { valid: false, reason: "Cannot parse hex" };
  if (bytes.length !== 39) return { valid: false, reason: `Expected 39 bytes, got ${bytes.length}` };
  if (bytes[0] !== 0x44) return { valid: false, reason: `Bad header: 0x${bytes[0]!.toString(16)}` };
  if (bytes[37] !== 0x03) return { valid: false, reason: `Bad ETX: 0x${bytes[37]!.toString(16)}` };

  const xorCalc = xorAll(bytes.slice(0, 38));
  const xorValid = xorCalc === bytes[38];

  const ewcId = uint32(bytes[1]!, bytes[2]!, bytes[3]!, bytes[4]!);
  const ewcIdHex = hexStr([bytes[1]!, bytes[2]!, bytes[3]!, bytes[4]!]);

  const event = bytes[5]!;
  const eventName = EWC25_EVENT_NAMES[event] ?? `Unknown (0x${event.toString(16)})`;
  const category = eventCategory(event);

  const deviceTime: Ewc25DeviceTime = {
    seconds: bcd(bytes[6]!),
    minutes: bcd(bytes[7]!),
    hours: bcd(bytes[8]!),
    day: bcd(bytes[9]!),
    month: bcd(bytes[10]!),
    year: bcd(bytes[11]!),
  };
  const dt = deviceTime;
  const deviceTimeStr =
    `${String(dt.hours).padStart(2, "0")}:${String(dt.minutes).padStart(2, "0")}:${String(dt.seconds).padStart(2, "0")} ` +
    `${String(dt.day).padStart(2, "0")}/${String(dt.month).padStart(2, "0")}/${String(dt.year + 2000)}`;

  const uid = hexStr([bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!]);
  const batteryAdcRaw = bytes[16]!;
  const batteryVolts = Math.round((batteryAdcRaw / 256) * 15 * 100) / 100;

  const rs = bytes[17]!;
  const fcf = uint16(bytes[33]!, bytes[34]!);
  const datalogPointer = uint16(bytes[35]!, bytes[36]!);

  // HEALTH_STATE has a completely different inner layout from byte 16 onward
  if (event === 0x19) {
    const vbatAdcRaw = bytes[16]!;
    const vwatAdcRaw = bytes[17]!;
    const vsen1 = bytes[18]!;
    const vsen2 = bytes[19]!;
    const vsen3 = bytes[20]!;
    const taccBytes = bytes.slice(21, 29);
    const tickAccumulatorHex = hexStr(taccBytes);
    const flg0 = bytes[29]!;
    const flags = {
      tamp2: !!(flg0 & 0x01),
      tamp1: !!(flg0 & 0x02),
      gsmNotLocked: !!(flg0 & 0x04),
      valveOn: !!(flg0 & 0x08),
      lockFlag: !!(flg0 & 0x10),
      proxFlag: !!(flg0 & 0x20),
      lowBattery: !!(flg0 & 0x40),
      rfidDisabled: !!(flg0 & 0x80),
    };
    const healthFcf = uint16(bytes[33]!, bytes[34]!);
    const healthDlp = uint16(bytes[35]!, bytes[36]!);
    return {
      valid: true,
      ewcId, ewcIdHex, event, eventName, category,
      deviceTime, deviceTimeStr,
      uid, batteryAdcRaw: vbatAdcRaw,
      batteryVolts: Math.round((vbatAdcRaw / 256) * 15 * 100) / 100,
      rs: 0, usageCounter: 0,
      startCreditMits: 0, endCreditMits: 0, creditUsedMits: 0,
      flowTicks: 0, litres: 0, flowTimeSecs: 0,
      fcf: healthFcf, datalogPointer: healthDlp,
      xorValid,
      healthState: {
        vbatAdcRaw, vwatAdcRaw, vsen1, vsen2, vsen3, tickAccumulatorHex, flags,
      },
    };
  }

  // All other events share the standard 28-byte datalog layout
  const usageCounter = uint16(bytes[18]!, bytes[19]!);
  const startCreditMits = uint32(bytes[20]!, bytes[21]!, bytes[22]!, bytes[23]!);
  const endCreditMits = uint32(bytes[24]!, bytes[25]!, bytes[26]!, bytes[27]!);
  const creditUsedMits = startCreditMits >= endCreditMits ? startCreditMits - endCreditMits : 0;
  const flowTicks = uint24(bytes[28]!, bytes[29]!, bytes[30]!);
  const litres = Math.round((flowTicks / 360) * 100) / 100;
  const flowTimeSecs = uint16(bytes[31]!, bytes[32]!);

  const base: Omit<Ewc25Decoded, "tamper" | "pressureOk" | "startUp" | "healthState" | "unmeteredFlowTicks"> = {
    valid: true,
    ewcId, ewcIdHex, event, eventName, category,
    deviceTime, deviceTimeStr,
    uid, batteryAdcRaw, batteryVolts,
    rs, usageCounter,
    startCreditMits, endCreditMits, creditUsedMits,
    flowTicks, litres, flowTimeSecs,
    fcf, datalogPointer, xorValid,
  };

  // TAMPER (0x18): rs byte = TP tamper status
  if (event === 0x18) {
    return {
      ...base,
      tamper: { tamp1Open: !!(rs & 0x01), tamp2Open: !!(rs & 0x02) },
    };
  }

  // PRESSURE (0x13): rs byte = Vwater ADC (0 = pressure OK)
  if (event === 0x13) {
    return { ...base, pressureOk: rs === 0 };
  }

  // NO-CREDIT (0x01): bytes 18-19 (UC position) hold un-metered flow count instead
  if (event === 0x01) {
    return {
      ...base,
      usageCounter: 0,
      unmeteredFlowTicks: usageCounter, // same bytes, different meaning
    };
  }

  // START_UP (0x16): SCR bytes hold power-up count + firmware date BCD
  if (event === 0x16) {
    const powerUpCount = bytes[20]!;
    const fwDay = bcd(bytes[21]!);
    const fwMonth = bcd(bytes[22]!);
    const fwYear = bcd(bytes[23]!);
    return {
      ...base,
      startCreditMits: 0,
      startUp: {
        powerUpCount,
        firmwareDateStr: `${String(fwDay).padStart(2, "0")}/${String(fwMonth).padStart(2, "0")}/${fwYear + 2000}`,
      },
    };
  }

  return base as Ewc25Decoded;
}
