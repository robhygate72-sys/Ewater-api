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

// Convert flow-meter ticks → litres using the asset's LCF (LitresConversion,
// ticks per litre). The LCF comes from EWC settings — NOT packet bytes[33–34]
// (that trailer is the FCF). Returns null when the LCF is unknown so the UI can
// avoid showing a fabricated value.
function ticksToLitres(flowTicks: number, lcf?: number | null): number | null {
  return lcf != null && lcf > 0 ? Math.round((flowTicks / lcf) * 100) / 100 : null;
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
  litres: number | null; // flowTicks / LCF; null when LCF unknown
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

export function decodeEwc25(hexPayload: string, lcf?: number | null): Ewc25Result {
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
  const litres = ticksToLitres(flowTicks, lcf);
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

// ─── EWC command names (shared by reply + command-api decoders) ────────────────

// Command codes per the EWC2.5 / eSENSE-Lite RS232 command specifications
// (Summary of Command codes table). ASCII letter shown in comments.
export const EWC_CMD_NAMES: Record<number, string> = {
  0x41: "Read Tick Accumulator",     // A
  0x42: "Bulk Clear Supertap Table", // B
  0x43: "Set Clock",                 // C — Set RTC clock / calendar
  0x44: "Datalog Output",            // D — Automatic datalog output
  0x45: "Read EEPROM Byte",          // E
  0x46: "Factory Reset",             // F
  0x4B: "Request to Program",        // K — Request to PROGRAM (bootloader)
  0x4C: "Load Supertap UID + Top-Up",// L
  0x4D: "Version Message",           // M — Message1 (version string)
  0x4E: "Write Tick Accumulator",    // N
  0x4F: "Valve OFF",                 // O — Host Valve OFF
  0x50: "Write EEPROM Byte",         // P
  0x52: "Read SPI Log",              // R — Read SPI EEPROM datalog packet
  0x53: "Consumer Data Message",     // S — SMARTD display message
  0x54: "Get Time",                  // T — Get RTC clock / calendar
  0x55: "Tap Top-Up",                // U — Host tap top-up
  0x56: "Valve ON",                  // V — Host Valve ON
  0x58: "Get Status",                // X — flags, ADC readings, flow check
  0x5A: "Clear Supertap UID + Top-Up", // Z
  0x65: "Read EEPROM Word",          // e
  0x6D: "Copyright Message",         // m — Message2 (copyright string)
  0x70: "Write EEPROM Word",         // p
  0x72: "Read Log Pointer",          // r — Read datalog pointer
  0x77: "Write Log Pointer",         // w — Write datalog pointer
};

// ─── Decode 28-byte embedded datalog (bytes 4-31 of a READ SPI LOG reply) ─────

function decodeDatalog28(b: number[], lcf?: number | null): Ewc25Result {
  if (b.length < 28) return { valid: false, reason: `Expected 28 bytes, got ${b.length}` };
  const event = b[0]!;
  const eventName = EWC25_EVENT_NAMES[event] ?? `Unknown (0x${event.toString(16)})`;
  const category = eventCategory(event);
  const deviceTime: Ewc25DeviceTime = {
    seconds: bcd(b[1]!), minutes: bcd(b[2]!), hours: bcd(b[3]!),
    day: bcd(b[4]!), month: bcd(b[5]!), year: bcd(b[6]!),
  };
  const dt = deviceTime;
  const deviceTimeStr =
    `${String(dt.hours).padStart(2, "0")}:${String(dt.minutes).padStart(2, "0")}:${String(dt.seconds).padStart(2, "0")} ` +
    `${String(dt.day).padStart(2, "0")}/${String(dt.month).padStart(2, "0")}/${dt.year + 2000}`;
  const uid = hexStr([b[7]!, b[8]!, b[9]!, b[10]!]);
  const batteryAdcRaw = b[11]!;
  const batteryVolts = Math.round((batteryAdcRaw / 256) * 15 * 100) / 100;
  const rs = b[12]!;

  if (event === 0x19) {
    // Health State: different byte layout from offset 11 onward
    const vbatAdcRaw = b[11]!;
    const vwatAdcRaw = b[12]!;
    const vsen1 = b[13]!;
    const vsen2 = b[14]!;
    const vsen3 = b[15]!;
    const taccBytes = b.slice(16, 24);
    const tickAccumulatorHex = hexStr(taccBytes);
    const flg0 = b[24]!;
    const flags = {
      tamp2: !!(flg0 & 0x01), tamp1: !!(flg0 & 0x02),
      gsmNotLocked: !!(flg0 & 0x04), valveOn: !!(flg0 & 0x08),
      lockFlag: !!(flg0 & 0x10), proxFlag: !!(flg0 & 0x20),
      lowBattery: !!(flg0 & 0x40), rfidDisabled: !!(flg0 & 0x80),
    };
    return {
      valid: true, ewcId: 0, ewcIdHex: "00000000",
      event, eventName, category, deviceTime, deviceTimeStr, uid,
      batteryAdcRaw: vbatAdcRaw,
      batteryVolts: Math.round((vbatAdcRaw / 256) * 15 * 100) / 100,
      rs: 0, usageCounter: 0,
      startCreditMits: 0, endCreditMits: 0, creditUsedMits: 0,
      flowTicks: 0, litres: 0, flowTimeSecs: 0,
      fcf: 0, datalogPointer: 0, xorValid: true,
      healthState: { vbatAdcRaw, vwatAdcRaw, vsen1, vsen2, vsen3, tickAccumulatorHex, flags },
    };
  }

  const usageCounter = uint16(b[13]!, b[14]!);
  const startCreditMits = uint32(b[15]!, b[16]!, b[17]!, b[18]!);
  const endCreditMits = uint32(b[19]!, b[20]!, b[21]!, b[22]!);
  const creditUsedMits = startCreditMits >= endCreditMits ? startCreditMits - endCreditMits : 0;
  const flowTicks = uint24(b[23]!, b[24]!, b[25]!);
  const litres = ticksToLitres(flowTicks, lcf);
  const flowTimeSecs = uint16(b[26]!, b[27]!);

  const base: Omit<Ewc25Decoded, "tamper" | "pressureOk" | "startUp" | "healthState" | "unmeteredFlowTicks"> = {
    valid: true, ewcId: 0, ewcIdHex: "00000000",
    event, eventName, category, deviceTime, deviceTimeStr, uid,
    batteryAdcRaw, batteryVolts, rs, usageCounter,
    startCreditMits, endCreditMits, creditUsedMits,
    flowTicks, litres, flowTimeSecs,
    fcf: 0, datalogPointer: 0, xorValid: true,
  };

  if (event === 0x18) return { ...base, tamper: { tamp1Open: !!(rs & 0x01), tamp2Open: !!(rs & 0x02) } };
  if (event === 0x13) return { ...base, pressureOk: rs === 0 };
  if (event === 0x01) return { ...base, usageCounter: 0, unmeteredFlowTicks: usageCounter };
  if (event === 0x16) {
    return {
      ...base, startCreditMits: 0,
      startUp: {
        powerUpCount: b[15]!,
        firmwareDateStr: `${String(bcd(b[16]!)).padStart(2, "0")}/${String(bcd(b[17]!)).padStart(2, "0")}/${bcd(b[18]!) + 2000}`,
      },
    };
  }
  return base as Ewc25Decoded;
}

// ─── EWC reply packet decoder (0x80 / 0x88) ────────────────────────────────────

export type EwcReplyData =
  | {
      kind: "get-status";
      deviceTime: Ewc25DeviceTime; deviceTimeStr: string; uid: string;
      batteryVolts: number; pressureOk: boolean;
      valveOn: boolean; tamp1: boolean; tamp2: boolean;
      lowBattery: boolean; rfidDisabled: boolean;
      flowCount: number; samplePeriodMs: number;
    }
  | { kind: "read-log"; logNumber: number; datalog: Ewc25Result }
  | { kind: "tick-accumulator"; hex: string }
  | { kind: "valve-on" | "valve-off" | "top-up"; creditMits: number }
  | { kind: "eeprom-read"; addr: number; value: number }
  | { kind: "eeprom-word-read"; addr: number; value: number }
  | { kind: "get-time"; deviceTime: Ewc25DeviceTime; deviceTimeStr: string }
  | { kind: "log-pointer-read"; pointer: number }
  | { kind: "ack"; cmdName: string }
  | { kind: "generic"; rawHex: string };

export interface EwcReplyDecoded {
  valid: true;
  ok: boolean; // true = 0x80, false = 0x88 (error)
  cmdByte: number;
  cmdName: string;
  xorValid: boolean;
  data: EwcReplyData;
}

export interface EwcReplyInvalid { valid: false; reason: string; }
export type EwcReplyResult = EwcReplyDecoded | EwcReplyInvalid;

export function decodeEwcReply(hexPayload: string, lcf?: number | null): EwcReplyResult {
  const bytes = parseHex(hexPayload);
  if (!bytes) return { valid: false, reason: "Cannot parse hex" };
  if (bytes.length < 4) return { valid: false, reason: `Too short: ${bytes.length} bytes` };
  const b0 = bytes[0]!;
  if (b0 !== 0x80 && b0 !== 0x88) return { valid: false, reason: `Not a reply: 0x${b0.toString(16)}` };

  const ok = b0 === 0x80;
  const cmdByte = bytes[1]!;
  const cmdName = EWC_CMD_NAMES[cmdByte] ?? `Unknown (0x${cmdByte.toString(16)})`;
  const xorCalc = xorAll(bytes.slice(0, bytes.length - 1));
  const xorValid = xorCalc === bytes[bytes.length - 1];

  let data: EwcReplyData;

  if (cmdByte === 0x58 && bytes.length === 26) {
    // GET_STATUS reply: 80 58 SS MM HH DD MN YY UID[4] VBAT VWAT RS2 RS3 RS4 RS0 RS1 FLG0 FLG1 FC0 FC1 FT ETX XOR
    const deviceTime: Ewc25DeviceTime = {
      seconds: bcd(bytes[2]!), minutes: bcd(bytes[3]!), hours: bcd(bytes[4]!),
      day: bcd(bytes[5]!), month: bcd(bytes[6]!), year: bcd(bytes[7]!),
    };
    const dt = deviceTime;
    const deviceTimeStr =
      `${String(dt.hours).padStart(2, "0")}:${String(dt.minutes).padStart(2, "0")}:${String(dt.seconds).padStart(2, "0")} ` +
      `${String(dt.day).padStart(2, "0")}/${String(dt.month).padStart(2, "0")}/${dt.year + 2000}`;
    const uid = hexStr([bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!]);
    const batteryVolts = Math.round((bytes[12]! / 256) * 15 * 100) / 100;
    const flg0 = bytes[19]!;
    data = {
      kind: "get-status",
      deviceTime, deviceTimeStr, uid, batteryVolts,
      pressureOk: bytes[13] === 0,
      valveOn: !!(flg0 & 0x08),
      tamp1: !!(flg0 & 0x02),
      tamp2: !!(flg0 & 0x01),
      lowBattery: !!(flg0 & 0x40),
      rfidDisabled: !!(flg0 & 0x80),
      flowCount: uint16(bytes[21]!, bytes[22]!),
      samplePeriodMs: bytes[23]! * 20,
    };
  } else if (cmdByte === 0x52 && bytes.length === 34) {
    // READ SPI LOG reply: 80 52 DLH DLL <28-byte datalog> ETX XOR
    const logNumber = uint16(bytes[2]!, bytes[3]!);
    const datalog = decodeDatalog28([...bytes.slice(4, 32)], lcf);
    data = { kind: "read-log", logNumber, datalog };
  } else if ((cmdByte === 0x56 || cmdByte === 0x4F || cmdByte === 0x55) && bytes.length === 8) {
    // Valve ON / OFF / Top-Up reply: 80 XX CR[4] ETX XOR
    const creditMits = uint32(bytes[2]!, bytes[3]!, bytes[4]!, bytes[5]!);
    data = { kind: cmdByte === 0x56 ? "valve-on" : cmdByte === 0x4F ? "valve-off" : "top-up", creditMits };
  } else if (cmdByte === 0x45 && bytes.length === 6) {
    // READ EEPROM: 80 45 ADR DATA ETX XOR
    data = { kind: "eeprom-read", addr: bytes[2]!, value: bytes[3]! };
  } else if (cmdByte === 0x65 && bytes.length === 7) {
    // READ EEPROM WORD: 80 65 ADR HI LO ETX XOR
    data = { kind: "eeprom-word-read", addr: bytes[2]!, value: uint16(bytes[3]!, bytes[4]!) };
  } else if (cmdByte === 0x41 && bytes.length === 12) {
    // READ TICK ACC: 80 41 TACC[8] ETX XOR
    data = { kind: "tick-accumulator", hex: hexStr([...bytes.slice(2, 10)]) };
  } else if (cmdByte === 0x54 && bytes.length === 10) {
    // GET TIME: 80 54 SS MM HH DD MN YY ETX XOR
    const deviceTime: Ewc25DeviceTime = {
      seconds: bcd(bytes[2]!), minutes: bcd(bytes[3]!), hours: bcd(bytes[4]!),
      day: bcd(bytes[5]!), month: bcd(bytes[6]!), year: bcd(bytes[7]!),
    };
    const dt = deviceTime;
    const deviceTimeStr =
      `${String(dt.hours).padStart(2,"0")}:${String(dt.minutes).padStart(2,"0")}:${String(dt.seconds).padStart(2,"0")} ` +
      `${String(dt.day).padStart(2,"0")}/${String(dt.month).padStart(2,"0")}/${dt.year + 2000}`;
    data = { kind: "get-time", deviceTime, deviceTimeStr };
  } else if (cmdByte === 0x72 && bytes.length === 6) {
    // READ LOG POINTER: 80 72 HI LO ETX XOR
    data = { kind: "log-pointer-read", pointer: uint16(bytes[2]!, bytes[3]!) };
  } else if (bytes.length === 4 && [0x43, 0x46, 0x4B, 0x50, 0x70, 0x77, 0x4F].includes(cmdByte)) {
    // Simple ACK replies: 80 CMD ETX XOR
    data = { kind: "ack", cmdName };
  } else {
    data = { kind: "generic", rawHex: hexStr([...bytes]) };
  }

  return { valid: true, ok, cmdByte, cmdName, xorValid, data };
}

// ─── CommandApi_1 outer JSON decoder ──────────────────────────────────────────

export type CommandApiArgs =
  | { kind: "credit"; creditMits: number }          // Valve ON / Tap Top-Up
  | { kind: "read-log"; logNumber: number }          // Read SPI Log
  | { kind: "set-clock"; timeStr: string }           // Set Clock
  | { kind: "eeprom-read"; addr: number }            // Read EEPROM / Read EEPROM Word
  | { kind: "eeprom-write"; addr: number; value: number }       // Write EEPROM
  | { kind: "eeprom-word-write"; addr: number; value: number }  // Write EEPROM Word
  | { kind: "log-pointer-write"; pointer: number };             // Write Log Pointer

export interface CommandApiDecoded {
  outgoingPipeline: string | null;
  priority: string | null;
  retry: boolean;
  cmdByte: number | null;
  cmdName: string | null;
  args: CommandApiArgs | null;
  rawInnerHex: string;
}

export function decodeCommandApiPayload(base64Json: string): CommandApiDecoded | null {
  try {
    const jsonStr = atob(base64Json);
    const json = JSON.parse(jsonStr) as Record<string, unknown>;
    const innerB64 = json["Payload"] as string | undefined;
    if (!innerB64) return null;
    const innerBytes = Array.from(atob(innerB64), (c) => c.charCodeAt(0));
    const cmdByte = innerBytes[0] ?? null;
    const cmdName = cmdByte !== null
      ? (EWC_CMD_NAMES[cmdByte] ?? `Unknown (0x${cmdByte.toString(16)})`)
      : null;

    let args: CommandApiArgs | null = null;

    if (cmdByte !== null) {
      if ((cmdByte === 0x56 || cmdByte === 0x55) && innerBytes.length >= 5) {
        // Valve ON / Tap Top-Up: CMD CR[4]
        args = { kind: "credit", creditMits: uint32(innerBytes[1]!, innerBytes[2]!, innerBytes[3]!, innerBytes[4]!) };
      } else if (cmdByte === 0x52 && innerBytes.length >= 3) {
        // Read SPI Log: CMD DLH DLL
        args = { kind: "read-log", logNumber: uint16(innerBytes[1]!, innerBytes[2]!) };
      } else if (cmdByte === 0x43 && innerBytes.length >= 7) {
        // Set Clock: CMD SS MM HH DD MN YY (BCD)
        const ss = bcd(innerBytes[1]!), mm = bcd(innerBytes[2]!), hh = bcd(innerBytes[3]!);
        const dd = bcd(innerBytes[4]!), mn = bcd(innerBytes[5]!), yy = bcd(innerBytes[6]!);
        args = {
          kind: "set-clock",
          timeStr: `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")} ${String(dd).padStart(2,"0")}/${String(mn).padStart(2,"0")}/${yy + 2000}`,
        };
      } else if ((cmdByte === 0x45 || cmdByte === 0x65) && innerBytes.length >= 2) {
        // Read EEPROM / Read EEPROM Word: CMD ADR
        args = { kind: "eeprom-read", addr: innerBytes[1]! };
      } else if (cmdByte === 0x50 && innerBytes.length >= 3) {
        // Write EEPROM: CMD ADR VAL
        args = { kind: "eeprom-write", addr: innerBytes[1]!, value: innerBytes[2]! };
      } else if (cmdByte === 0x70 && innerBytes.length >= 4) {
        // Write EEPROM Word: CMD ADR HI LO
        args = { kind: "eeprom-word-write", addr: innerBytes[1]!, value: uint16(innerBytes[2]!, innerBytes[3]!) };
      } else if (cmdByte === 0x77 && innerBytes.length >= 3) {
        // Write Log Pointer: CMD HI LO
        args = { kind: "log-pointer-write", pointer: uint16(innerBytes[1]!, innerBytes[2]!) };
      }
    }

    const rawInnerHex = innerBytes.map((b) => b.toString(16).padStart(2, "0")).join(" ");
    return {
      outgoingPipeline: (json["OutgoingPipeline"] as string) ?? null,
      priority: (json["Priority"] as string) ?? null,
      retry: (json["Retry"] as boolean) ?? false,
      cmdByte, cmdName, args, rawInnerHex,
    };
  } catch {
    return null;
  }
}
