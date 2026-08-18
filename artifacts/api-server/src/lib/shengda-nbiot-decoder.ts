// ---------------------------------------------------------------------------
// Shengda NB-IoT protocol decoder (CBOR / LwM2M-style object frames)
//
// Frame layout (all fields big-endian):
//   [0-1]  Version              fixed 01 01
//   [2]    Message type         0 = needs confirmation, 1 = no confirmation
//                                2 = response message,   3 = reset message
//   [3]    Function code        0x02 = device report
//                                0x44 = device response to platform setting
//                                0x45 = platform setting instruction
//                                0x03 = platform calibration delivery
//   [4-5]  Message ID
//   [6]    Data field format    0x3C = CBOR
//   [7-8]  Data field length    Nb (bytes)
//   [9]    Delimiter            fixed 0xFF
//   [10..10+Nb)  Data field     CBOR-encoded array of LwM2M-style objects
//   [10+Nb, 10+Nb+2)  Check code  CRC-16/AUG-CCITT over bytes [0, 10+Nb)
//
// Field/enum tables below are transcribed directly from the vendor protocol
// document ("NBIOT METERS PROTOCOL") — see attached_assets. Fields the doc
// left unlabelled (no name/unit given) are rendered as "(undocumented)"
// rather than guessed.
// ---------------------------------------------------------------------------

const MESSAGE_TYPE_LABELS: Record<number, string> = {
  0: "Needs confirmation",
  1: "No confirmation required",
  2: "Response message",
  3: "Reset message",
};

const FUNCTION_CODE_LABELS: Record<number, string> = {
  0x02: "Device report",
  0x44: "Response to platform-setting instruction",
  0x45: "Platform setting instruction",
  0x03: "Platform calibration delivery",
};

interface FieldDef {
  label: string;
  unit?: string;
  /** Raw integer value is divided by this to get the displayed value. */
  scale?: number;
  enum?: Record<number, string>;
  isUnixTime?: boolean;
}

const OBJECT_NAMES: Record<string, string> = {
  "/3/0": "Device Info",
  "/70/0": "Protocol Queue",
  "/80/0": "Meter Basic",
  "/81/0": "Valve Control",
  "/82/0": "Abnormal Alarm",
  "/84/0": "Reporting Config",
  "/99/0": "NB Delivery",
};

const OBJECT_FIELDS: Record<string, Record<number, FieldDef>> = {
  "/3/0": {
    0: { label: "Manufacturer" },
    1: { label: "Model" },
    2: { label: "Serial Number" },
    3: { label: "Firmware Version" },
    4: { label: "Reboot" },
    5: { label: "Factory Reset" },
    6: {
      label: "Power Supply Type",
      enum: {
        1: "Internal battery",
        2: "External battery (replaceable)",
        4: "Ethernet",
        5: "USB",
        6: "AC power",
        7: "Solar",
      },
    },
    7: { label: "Power Supply Voltage", unit: "V", scale: 100 },
    8: { label: "Power Supply Current", unit: "mA" },
    9: { label: "Battery Level", unit: "%" },
    10: { label: "Memory Free" },
    11: { label: "Error Code", enum: { 1: "No error" } },
    12: { label: "Reset Error Code" },
    13: { label: "Current Time", isUnixTime: true },
    14: { label: "UTC Offset" },
    15: { label: "Timezone (IANA)" },
    16: { label: "Binding Modes" },
    17: { label: "Device Type", enum: { 1: "Prepaid water meter" } },
    18: { label: "Hardware Version" },
    19: { label: "Software Version" },
    20: {
      label: "Battery Status",
      enum: {
        0: "Normal",
        1: "Charging",
        2: "Fully charged (still charging)",
        3: "Damaged",
        4: "Low battery",
        5: "Not installed",
        6: "Unknown",
      },
    },
    21: { label: "Memory Total" },
    22: { label: "Extended Device Info" },
    23: { label: "Message Sequence" },
    24: { label: "Meter Working Hours", unit: "h" },
    40: { label: "Info Query" },
  },
  "/70/0": {
    2: { label: "Field 2 (undocumented)" },
  },
  "/80/0": {
    0: { label: "Meter Type" },
    1: {
      label: "Measurement Model",
      enum: {
        0: "Dual reed switch",
        1: "Single reed switch",
        2: "Dual hall",
        3: "Direct reading meter",
        4: "Non-magnetic inductive",
        5: "Non-magnetic coil",
        6: "Three hall",
        7: "Single hall",
      },
    },
    2: {
      label: "PN (Pulse Constant)",
      enum: {
        0: "Direct meter reading",
        1: "1 L/pulse",
        2: "10 L/pulse",
        3: "100 L/pulse",
        4: "1000 L/pulse",
        5: "0.5 L/pulse",
        6: "5 L/pulse",
      },
    },
    3: { label: "Meter DN Size" },
    4: { label: "Common Flow (Q3)" },
    5: { label: "Minimum Flow (Q1)" },
    6: { label: "Meter Status Word (bit0 historical magnetic attack, bit1 measurement error, bit2 magnetic attack)" },
    7: { label: "Max Reading" },
    8: { label: "Instantaneous Flow", unit: "L/h" },
    9: { label: "Instantaneous Power", unit: "W" },
    10: { label: "Accumulated Heat", unit: "Wh" },
    11: { label: "Inlet Water Temperature", unit: "°C", scale: 100 },
    12: { label: "Return Water Temperature", unit: "°C", scale: 100 },
    13: { label: "Positive (Forward) Flow", unit: "L" },
    14: { label: "Reverse Flow", unit: "L" },
    15: { label: "Peak Flow Rate (unsupported)" },
    16: { label: "Meter Reading (Cumulative)", unit: "L" },
    17: { label: "Daily Dense Data" },
    18: { label: "Frozen Data" },
    19: { label: "Read Daily Frozen Data Selector" },
    21: { label: "Meter Reading Time", isUnixTime: true },
    22: { label: "Water Meter No." },
    23: { label: "Available Water Allowance", unit: "L" },
    24: { label: "Available Water Allowance Alarm Value", unit: "L" },
    26: { label: "Overdraft Volume", unit: "L" },
    27: { label: "Dense Data Cycle", unit: "min" },
    28: { label: "Read Frozen Data (day/month)" },
    29: { label: "Read Monthly Frozen Data" },
    30: { label: "Read Dense Frozen Data" },
    31: { label: "Payment Function", enum: { 0: "Disabled", 1: "Enabled" } },
    32: { label: "Dense Frozen Function", enum: { 0: "Disabled", 1: "Enabled" } },
    33: { label: "Heat Meter Temperature Difference", unit: "°C", scale: 100 },
    34: { label: "Pressure Value", unit: "KPa" },
    35: { label: "Temperature Value", unit: "°C", scale: 100 },
    36: { label: "Electromagnetic Water Meter Status", enum: { 0: "OK", 1: "Alarm/Tamper/Critical" } },
    37: { label: "Battery Voltage", unit: "V", scale: 100 },
    38: { label: "Cumulative Cold Amount", unit: "Wh" },
    40: { label: "Meter Info Query" },
    41: { label: "Latitude" },
    42: { label: "Longitude" },
    43: { label: "Altitude", unit: "m" },
  },
  "/81/0": {
    0: { label: "Valve Control Word", enum: { 0: "Open", 1: "Close" } },
    1: { label: "Valve Status", enum: { 0: "Open", 1: "Closed" } },
    2: { label: "Valve Failure Status", enum: { 0: "Normal", 1: "Failure" } },
    3: {
      label: "Valve Type",
      enum: {
        0: "Two-wire",
        1: "Five-wire (close in place)",
        2: "No valve",
        3: "Five-wire (disconnected in place)",
      },
    },
    4: { label: "Valve Dredge Cycle", unit: "times/month" },
    5: { label: "Magnetic Attack Valve Close Enable", enum: { 0: "Disabled", 1: "Enabled" } },
    6: {
      label: "Forced Control Valve",
      enum: { 0: "Force open", 1: "Force close", 2: "Cancel forced control" },
    },
    7: { label: "Valve Timeout Period", unit: "s" },
    8: { label: "Valve Opening Angle", unit: "°" },
    40: { label: "Valve Info Query" },
  },
  "/82/0": {
    0: { label: "Magnetic Attack Status", enum: { 0: "None", 1: "Yes" } },
    1: { label: "Historical Magnetic Attack", enum: { 0: "None", 1: "Yes" } },
    2: { label: "Anti-demolition", enum: { 0: "None", 1: "Yes" } },
    3: { label: "Historical Anti-demolition", enum: { 0: "None", 1: "Yes" } },
    4: { label: "Leak Status", enum: { 0: "None", 1: "Yes" } },
    5: { label: "Overflow Status", enum: { 0: "None", 1: "Yes" } },
    6: { label: "Stop Status", enum: { 0: "None", 1: "Yes" } },
    7: { label: "Water Error Code" },
    8: { label: "Heat Error Code (bitmask ST1/ST2, vendor-defined)" },
    9: { label: "Ultrasonic Error Code (bitmask, vendor-defined)" },
    10: { label: "Reverse Flow Status", enum: { 0: "None", 1: "Yes" } },
    11: { label: "Available Water Alarm", enum: { 0: "Sufficient", 1: "Insufficient" } },
  },
  "/84/0": {
    0: { label: "Report Cycle", unit: "s" },
    1: { label: "Report Time Slot", unit: "s" },
    2: { label: "Retransmission Times" },
    3: { label: "Retransmission Cycle", unit: "s" },
    4: { label: "Meter Reading Start/Close Time" },
    5: { label: "Report Interval (discrete start/end)" },
    10: { label: "RF Working Mode", enum: { 0: "Report once", 1: "Continuously reporting" } },
    11: { label: "RF Working Channel Group" },
  },
  "/99/0": {
    0: { label: "NB Module Version" },
    1: { label: "IMEI" },
    2: { label: "IMSI" },
    3: { label: "ICCID" },
    4: { label: "IP:Port" },
    5: { label: "APN" },
    6: { label: "PLMN ID" },
    7: { label: "Band Indicator" },
    8: { label: "EARFCN" },
    9: { label: "Cell ID" },
    10: { label: "PCI" },
    11: { label: "RSRP (raw, unit unspecified in doc)" },
    12: { label: "RSRQ (raw, unit unspecified in doc)" },
    13: { label: "RSSI (raw, unit unspecified in doc)" },
    14: { label: "SNR (raw, unit unspecified in doc)" },
    15: { label: "ECL" },
    16: { label: "TX Power" },
    17: { label: "TX Time" },
    18: { label: "RX Time" },
    19: { label: "CSQ" },
    20: { label: "NB Info Query" },
    21: { label: "PSM Enable", enum: { 0: "Disabled", 1: "Enabled" } },
    23: { label: "Network Protocol", enum: { 0: "COAP", 1: "UDP" } },
  },
};

// ---------------------------------------------------------------------------
// Minimal CBOR decoder — just enough to parse the object maps this protocol
// produces (uints, negative ints, byte/text strings, arrays, maps, tags,
// booleans/null, and floats). No external `cbor` package is installed.
// ---------------------------------------------------------------------------

class CborReader {
  pos = 0;
  constructor(private buf: Buffer) {}

  private byte(): number {
    if (this.pos >= this.buf.length) throw new Error("CBOR: unexpected end of buffer");
    return this.buf[this.pos++]!;
  }

  private readUint(addInfo: number): number {
    if (addInfo < 24) return addInfo;
    if (addInfo === 24) return this.byte();
    if (addInfo === 25) {
      const v = this.buf.readUInt16BE(this.pos);
      this.pos += 2;
      return v;
    }
    if (addInfo === 26) {
      const v = this.buf.readUInt32BE(this.pos);
      this.pos += 4;
      return v;
    }
    if (addInfo === 27) {
      const v = this.buf.readBigUInt64BE(this.pos);
      this.pos += 8;
      return Number(v);
    }
    throw new Error(`CBOR: unsupported additional info ${addInfo}`);
  }

  readValue(): unknown {
    const initial = this.byte();
    const majorType = initial >> 5;
    const addInfo = initial & 0x1f;

    switch (majorType) {
      case 0:
        return this.readUint(addInfo);
      case 1:
        return -1 - this.readUint(addInfo);
      case 2: {
        const len = this.readUint(addInfo);
        const bytes = this.buf.subarray(this.pos, this.pos + len);
        this.pos += len;
        return bytes;
      }
      case 3: {
        const len = this.readUint(addInfo);
        const str = this.buf.toString("utf8", this.pos, this.pos + len);
        this.pos += len;
        return str;
      }
      case 4: {
        if (addInfo === 31) {
          const arr: unknown[] = [];
          while (this.buf[this.pos] !== 0xff) arr.push(this.readValue());
          this.pos++;
          return arr;
        }
        const len = this.readUint(addInfo);
        const arr: unknown[] = [];
        for (let i = 0; i < len; i++) arr.push(this.readValue());
        return arr;
      }
      case 5: {
        const map = new Map<unknown, unknown>();
        if (addInfo === 31) {
          while (this.buf[this.pos] !== 0xff) {
            const k = this.readValue();
            const v = this.readValue();
            map.set(k, v);
          }
          this.pos++;
          return map;
        }
        const len = this.readUint(addInfo);
        for (let i = 0; i < len; i++) {
          const k = this.readValue();
          const v = this.readValue();
          map.set(k, v);
        }
        return map;
      }
      case 6:
        this.readUint(addInfo); // tag number, ignored
        return this.readValue();
      case 7:
        if (addInfo === 20) return false;
        if (addInfo === 21) return true;
        if (addInfo === 22) return null;
        if (addInfo === 23) return undefined;
        if (addInfo === 26) {
          const v = this.buf.readFloatBE(this.pos);
          this.pos += 4;
          return v;
        }
        if (addInfo === 27) {
          const v = this.buf.readDoubleBE(this.pos);
          this.pos += 8;
          return v;
        }
        return null;
      default:
        throw new Error(`CBOR: unsupported major type ${majorType}`);
    }
  }
}

// CRC-16/AUG-CCITT: poly 0x1021, init 0x1D0F, no reflection, no final xor.
function crc16AugCcitt(bytes: Buffer): number {
  let crc = 0x1d0f;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

function formatFieldValue(def: FieldDef | undefined, raw: unknown): string {
  if (Buffer.isBuffer(raw)) return raw.toString("hex");
  if (raw === null || raw === undefined) return "null";
  if (!def) return String(raw);
  if (typeof raw === "number") {
    if (def.isUnixTime) {
      const d = new Date(raw * 1000);
      return isNaN(d.getTime()) ? String(raw) : d.toISOString();
    }
    const value = def.scale ? raw / def.scale : raw;
    const enumLabel = def.enum?.[raw];
    let out = String(value);
    if (def.unit) out += ` ${def.unit}`;
    if (enumLabel) out += ` (${enumLabel})`;
    return out;
  }
  return String(raw);
}

// ---------------------------------------------------------------------------
// Structured state — typed sub-objects per LwM2M section. All fields are null
// when the packet did not carry them (never 0 as a fallback).
// ---------------------------------------------------------------------------

export interface ShengdaDeviceInfo {
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  firmwareVersion: string | null;
  hardwareVersion: string | null;
  softwareVersion: string | null;
  powerSupplyType: string | null;
  powerSupplyVoltage: number | null;
  batteryLevelPercent: number | null;
  batteryStatus: string | null;
  errorCode: number | null;
  rtcTime: string | null;
  deviceType: string | null;
  meterWorkingHours: number | null;
}

export interface ShengdaMeterState {
  meterReadingLitres: number | null;
  meterReadingTime: string | null;
  availableWaterAllowanceLitres: number | null;
  availableWaterAllowanceAlarmLitres: number | null;
  overdraftVolumeLitres: number | null;
  instantaneousFlowLph: number | null;
  forwardFlowLitres: number | null;
  reverseFlowLitres: number | null;
  batteryVoltage: number | null;
  meterStatusWord: number | null;
  waterMeterNo: string | null;
  paymentFunctionEnabled: boolean | null;
  measurementModel: string | null;
  pulseConstant: string | null;
  meterDnSize: number | null;
  pressureKpa: number | null;
  temperatureCelsius: number | null;
}

export interface ShengdaValveState {
  controlWord: string | null;
  status: string | null;
  failureStatus: string | null;
  valveType: string | null;
  dredgeCyclePerMonth: number | null;
  timeoutSeconds: number | null;
  openingAngleDegrees: number | null;
}

export interface ShengdaAlarmState {
  magneticAttack: boolean | null;
  historicalMagneticAttack: boolean | null;
  antiDemolition: boolean | null;
  historicalAntiDemolition: boolean | null;
  leak: boolean | null;
  overflow: boolean | null;
  stop: boolean | null;
  reverseFlow: boolean | null;
  waterErrorCode: number | null;
  availableWaterInsufficient: boolean | null;
}

export interface ShengdaReportingState {
  reportCycleSeconds: number | null;
  reportTimeSlotSeconds: number | null;
  retransmissionTimes: number | null;
  retransmissionCycleSeconds: number | null;
  rfWorkingMode: string | null;
}

export interface ShengdaNetworkState {
  nbModuleVersion: string | null;
  imei: string | null;
  imsi: string | null;
  iccid: string | null;
  ipPort: string | null;
  apn: string | null;
  plmnId: string | null;
  bandIndicator: string | null;
  earfcn: number | null;
  cellId: string | null;
  pci: number | null;
  rsrp: number | null;
  rsrq: number | null;
  rssi: number | null;
  snr: number | null;
  ecl: number | null;
  txPower: number | null;
  csq: number | null;
  psmEnabled: boolean | null;
  networkProtocol: string | null;
}

export interface ShengdaState {
  device: ShengdaDeviceInfo;
  meter: ShengdaMeterState;
  valve: ShengdaValveState;
  alarms: ShengdaAlarmState;
  reporting: ShengdaReportingState;
  network: ShengdaNetworkState;
}

function emptyShengdaState(): ShengdaState {
  return {
    device: {
      manufacturer: null,
      model: null,
      serialNumber: null,
      firmwareVersion: null,
      hardwareVersion: null,
      softwareVersion: null,
      powerSupplyType: null,
      powerSupplyVoltage: null,
      batteryLevelPercent: null,
      batteryStatus: null,
      errorCode: null,
      rtcTime: null,
      deviceType: null,
      meterWorkingHours: null,
    },
    meter: {
      meterReadingLitres: null,
      meterReadingTime: null,
      availableWaterAllowanceLitres: null,
      availableWaterAllowanceAlarmLitres: null,
      overdraftVolumeLitres: null,
      instantaneousFlowLph: null,
      forwardFlowLitres: null,
      reverseFlowLitres: null,
      batteryVoltage: null,
      meterStatusWord: null,
      waterMeterNo: null,
      paymentFunctionEnabled: null,
      measurementModel: null,
      pulseConstant: null,
      meterDnSize: null,
      pressureKpa: null,
      temperatureCelsius: null,
    },
    valve: {
      controlWord: null,
      status: null,
      failureStatus: null,
      valveType: null,
      dredgeCyclePerMonth: null,
      timeoutSeconds: null,
      openingAngleDegrees: null,
    },
    alarms: {
      magneticAttack: null,
      historicalMagneticAttack: null,
      antiDemolition: null,
      historicalAntiDemolition: null,
      leak: null,
      overflow: null,
      stop: null,
      reverseFlow: null,
      waterErrorCode: null,
      availableWaterInsufficient: null,
    },
    reporting: {
      reportCycleSeconds: null,
      reportTimeSlotSeconds: null,
      retransmissionTimes: null,
      retransmissionCycleSeconds: null,
      rfWorkingMode: null,
    },
    network: {
      nbModuleVersion: null,
      imei: null,
      imsi: null,
      iccid: null,
      ipPort: null,
      apn: null,
      plmnId: null,
      bandIndicator: null,
      earfcn: null,
      cellId: null,
      pci: null,
      rsrp: null,
      rsrq: null,
      rssi: null,
      snr: null,
      ecl: null,
      txPower: null,
      csq: null,
      psmEnabled: null,
      networkProtocol: null,
    },
  };
}

// Small coercion helpers used when populating structured state.
function asNum(v: unknown): number | null {
  return typeof v === "number" && !isNaN(v) ? v : null;
}
function asStr(v: unknown): string | null {
  if (typeof v === "string") return v !== "" ? v : null;
  if (typeof v === "number") return String(v);
  if (Buffer.isBuffer(v)) return v.toString("hex");
  return null;
}
function asBool01(v: unknown): boolean | null {
  if (v === 0) return false;
  if (v === 1) return true;
  return null;
}
function asUnixIso(v: unknown): string | null {
  if (typeof v !== "number") return null;
  const d = new Date(v * 1000);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
function enumOrRaw(def: FieldDef | undefined, v: unknown): string | null {
  if (typeof v !== "number") return asStr(v);
  return def?.enum?.[v] ?? String(v);
}

export interface ShengdaLwm2mDecoded {
  valid: boolean;
  messageType: string;
  messageFunction: string;
  meterReading: number | null;
  prepayLitres: number | null;
  supplyVoltage: number | null;
  batteryState: string | null;
  valveStatus: string | null;
  signalPower: string | null;
  signalSnr: string | null;
  errorCode: number | null;
  magneticAttack: boolean | null;
  description: string;
  /** Fully structured per-section state extracted from this packet. */
  state: ShengdaState;
}

/**
 * Attempts to decode a base64 packet payload as a Shengda NB-IoT
 * CBOR/LwM2M-style frame. Returns null if the payload does not match this
 * protocol's fixed header shape (version 01 01, data format 0x3C), so callers
 * can fall back to the existing eWater DescribeRawData decode path.
 */
export function tryDecodeShengdaLwm2m(payloadBase64: string): ShengdaLwm2mDecoded | null {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(payloadBase64, "base64");
  } catch {
    return null;
  }
  if (bytes.length < 12) return null;
  if (bytes[0] !== 0x01 || bytes[1] !== 0x01) return null; // fixed version 01 01
  const dataFormat = bytes[6];
  if (dataFormat !== 0x3c) return null; // only handle CBOR-formatted frames

  const msgTypeByte = bytes[2]!;
  const funcCodeByte = bytes[3]!;
  const dataLen = bytes.readUInt16BE(7);
  const headerLen = 10;

  if (bytes.length < headerLen + dataLen + 2) return null;

  const checkedRegion = bytes.subarray(0, headerLen + dataLen);
  const expectedCrc = crc16AugCcitt(checkedRegion);
  const actualCrc = bytes.readUInt16BE(headerLen + dataLen);
  const valid = expectedCrc === actualCrc;

  const dataField = bytes.subarray(headerLen, headerLen + dataLen);

  let objects: Map<unknown, unknown>[] = [];
  try {
    const reader = new CborReader(dataField);
    const parsed = reader.readValue();
    if (Array.isArray(parsed)) {
      objects = parsed.filter((o): o is Map<unknown, unknown> => o instanceof Map);
    } else if (parsed instanceof Map) {
      objects = [parsed];
    }
  } catch {
    return null;
  }

  const messageType = MESSAGE_TYPE_LABELS[msgTypeByte] ?? `Unknown (0x${msgTypeByte.toString(16)})`;
  const messageFunction =
    FUNCTION_CODE_LABELS[funcCodeByte] ?? `Unknown (0x${funcCodeByte.toString(16)})`;

  const lines: string[] = [
    "Shengda NB-IoT (LwM2M/CBOR)",
    "Version: V1.01",
    `MessageType: ${messageType} (${msgTypeByte})`,
    `FunctionCode: ${messageFunction} (0x${funcCodeByte.toString(16).padStart(2, "0")})`,
    `Checksum: ${valid ? "valid" : "INVALID"} (0x${actualCrc.toString(16).padStart(4, "0")})`,
    "",
  ];

  // Legacy-compatible flattened fields, pulled from whichever object carries
  // them (mirrors what the older Shengda-hex decoder exposed).
  let meterReading: number | null = null;
  let prepayLitres: number | null = null;
  let supplyVoltage: number | null = null;
  let batteryState: string | null = null;
  let valveStatus: string | null = null;
  let signalPower: string | null = null;
  let signalSnr: string | null = null;
  let errorCode: number | null = null;
  let magneticAttack: boolean | null = null;

  const state = emptyShengdaState();

  for (const obj of objects) {
    const bn = obj.get("bn");
    const bnStr = typeof bn === "string" ? bn : null;
    const fieldDefs = bnStr ? OBJECT_FIELDS[bnStr] : undefined;
    const objName = bnStr ? (OBJECT_NAMES[bnStr] ?? "Unknown object") : "Unknown object";

    lines.push(`Object ${bnStr ?? "?"} (${objName})`);
    for (const [key, value] of obj) {
      if (key === "bn") continue;
      const code = typeof key === "number" ? key : Number(key);
      const def = fieldDefs?.[code];
      const label = def?.label ?? `Field ${code} (undocumented)`;
      lines.push(`  ${code} ${label}: ${formatFieldValue(def, value)}`);

      if (bnStr === "/80/0") {
        if (code === 16 && typeof value === "number") meterReading = value;
        if (code === 23 && typeof value === "number") prepayLitres = value;
        if (code === 37 && typeof value === "number") supplyVoltage = value / 100;
      }
      if (bnStr === "/3/0") {
        if (code === 7 && typeof value === "number" && supplyVoltage === null) {
          supplyVoltage = value / 100;
        }
        if (code === 20 && typeof value === "number") {
          batteryState = def?.enum?.[value] ?? String(value);
        }
        if (code === 11 && typeof value === "number") errorCode = value;
      }
      if (bnStr === "/81/0" && code === 1 && typeof value === "number") {
        valveStatus = def?.enum?.[value] ?? String(value);
      }
      if (bnStr === "/82/0") {
        if (code === 7 && typeof value === "number") errorCode = value;
        if ((code === 0 || code === 1) && value === 1) magneticAttack = true;
        if (code === 0 && value === 0 && magneticAttack === null) magneticAttack = false;
      }
      if (bnStr === "/99/0") {
        if (code === 11) signalPower = `${String(value)} (rsrp)`;
        if (code === 14) signalSnr = `${String(value)} (snr)`;
      }

      // ── Structured state population (per LwM2M section) ──────────────────
      if (bnStr === "/3/0") {
        const d = state.device;
        if (code === 0) d.manufacturer = asStr(value);
        if (code === 1) d.model = asStr(value);
        if (code === 2) d.serialNumber = asStr(value);
        if (code === 3) d.firmwareVersion = asStr(value);
        if (code === 18) d.hardwareVersion = asStr(value);
        if (code === 19) d.softwareVersion = asStr(value);
        if (code === 6) d.powerSupplyType = enumOrRaw(def, value);
        if (code === 7) d.powerSupplyVoltage = asNum(value) != null ? (value as number) / 100 : null;
        if (code === 9) d.batteryLevelPercent = asNum(value);
        if (code === 20) d.batteryStatus = enumOrRaw(def, value);
        if (code === 11) d.errorCode = asNum(value);
        if (code === 13) d.rtcTime = asUnixIso(value);
        if (code === 17) d.deviceType = enumOrRaw(def, value);
        if (code === 24) d.meterWorkingHours = asNum(value);
      }
      if (bnStr === "/80/0") {
        const m = state.meter;
        if (code === 16) m.meterReadingLitres = asNum(value);
        if (code === 21) m.meterReadingTime = asUnixIso(value);
        if (code === 23) m.availableWaterAllowanceLitres = asNum(value);
        if (code === 24) m.availableWaterAllowanceAlarmLitres = asNum(value);
        if (code === 26) m.overdraftVolumeLitres = asNum(value);
        if (code === 8) m.instantaneousFlowLph = asNum(value);
        if (code === 13) m.forwardFlowLitres = asNum(value);
        if (code === 14) m.reverseFlowLitres = asNum(value);
        if (code === 37) m.batteryVoltage = asNum(value) != null ? (value as number) / 100 : null;
        if (code === 6) m.meterStatusWord = asNum(value);
        if (code === 22) m.waterMeterNo = asStr(value);
        if (code === 31) m.paymentFunctionEnabled = asBool01(value);
        if (code === 1) m.measurementModel = enumOrRaw(def, value);
        if (code === 2) m.pulseConstant = enumOrRaw(def, value);
        if (code === 3) m.meterDnSize = asNum(value);
        if (code === 34) m.pressureKpa = asNum(value);
        if (code === 35) m.temperatureCelsius = asNum(value) != null ? (value as number) / 100 : null;
      }
      if (bnStr === "/81/0") {
        const v = state.valve;
        if (code === 0) v.controlWord = enumOrRaw(def, value);
        if (code === 1) v.status = enumOrRaw(def, value);
        if (code === 2) v.failureStatus = enumOrRaw(def, value);
        if (code === 3) v.valveType = enumOrRaw(def, value);
        if (code === 4) v.dredgeCyclePerMonth = asNum(value);
        if (code === 7) v.timeoutSeconds = asNum(value);
        if (code === 8) v.openingAngleDegrees = asNum(value);
      }
      if (bnStr === "/82/0") {
        const a = state.alarms;
        if (code === 0) a.magneticAttack = asBool01(value);
        if (code === 1) a.historicalMagneticAttack = asBool01(value);
        if (code === 2) a.antiDemolition = asBool01(value);
        if (code === 3) a.historicalAntiDemolition = asBool01(value);
        if (code === 4) a.leak = asBool01(value);
        if (code === 5) a.overflow = asBool01(value);
        if (code === 6) a.stop = asBool01(value);
        if (code === 10) a.reverseFlow = asBool01(value);
        if (code === 7) a.waterErrorCode = asNum(value);
        if (code === 11) a.availableWaterInsufficient = asBool01(value);
      }
      if (bnStr === "/84/0") {
        const r = state.reporting;
        if (code === 0) r.reportCycleSeconds = asNum(value);
        if (code === 1) r.reportTimeSlotSeconds = asNum(value);
        if (code === 2) r.retransmissionTimes = asNum(value);
        if (code === 3) r.retransmissionCycleSeconds = asNum(value);
        if (code === 10) r.rfWorkingMode = enumOrRaw(def, value);
      }
      if (bnStr === "/99/0") {
        const n = state.network;
        if (code === 0) n.nbModuleVersion = asStr(value);
        if (code === 1) n.imei = asStr(value);
        if (code === 2) n.imsi = asStr(value);
        if (code === 3) n.iccid = asStr(value);
        if (code === 4) n.ipPort = asStr(value);
        if (code === 5) n.apn = asStr(value);
        if (code === 6) n.plmnId = asStr(value);
        if (code === 7) n.bandIndicator = asStr(value);
        if (code === 8) n.earfcn = asNum(value);
        if (code === 9) n.cellId = asStr(value);
        if (code === 10) n.pci = asNum(value);
        if (code === 11) n.rsrp = asNum(value);
        if (code === 12) n.rsrq = asNum(value);
        if (code === 13) n.rssi = asNum(value);
        if (code === 14) n.snr = asNum(value);
        if (code === 15) n.ecl = asNum(value);
        if (code === 16) n.txPower = asNum(value);
        if (code === 19) n.csq = asNum(value);
        if (code === 21) n.psmEnabled = asBool01(value);
        if (code === 23) n.networkProtocol = enumOrRaw(def, value);
      }
    }
    lines.push("");
  }

  return {
    valid,
    messageType,
    messageFunction,
    meterReading,
    prepayLitres,
    supplyVoltage,
    batteryState,
    valveStatus,
    signalPower,
    signalSnr,
    errorCode,
    magneticAttack,
    description: lines.join("\n").trimEnd(),
    state,
  };
}

// ---------------------------------------------------------------------------
// State reducer — folds multiple partial packets into an authoritative
// current state. Walks entries newest-first; the newest non-null observation
// of each field wins and carries its own `observedAt` timestamp, so a partial
// newer packet never silently erases fields only present in older packets.
// Packets with valid === false (bad CRC) are excluded from authoritative
// state but retained in `invalidPackets`.
// ---------------------------------------------------------------------------

export interface ShengdaDecodedLogEntry {
  id: string;
  /** ISO timestamp the packet was received. */
  timestamp: string;
  decoded: ShengdaLwm2mDecoded;
}

export interface ObservedField {
  value: string | number | boolean;
  observedAt: string;
}

export type ObservedSection = Record<string, ObservedField | null>;

export interface ShengdaCurrentState {
  device: ObservedSection;
  meter: ObservedSection;
  valve: ObservedSection;
  alarms: ObservedSection;
  reporting: ObservedSection;
  network: ObservedSection;
  /** Timestamp of the newest packet considered (valid or not). */
  lastPacketAt: string | null;
  /** Timestamp of the newest CRC-valid packet. */
  lastValidPacketAt: string | null;
  validPacketCount: number;
  invalidPackets: { id: string; timestamp: string }[];
}

const STATE_SECTIONS = ["device", "meter", "valve", "alarms", "reporting", "network"] as const;

export function buildShengdaCurrentState(entries: ShengdaDecodedLogEntry[]): ShengdaCurrentState {
  // Newest first
  const sorted = [...entries].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  const empty = emptyShengdaState();
  const out: ShengdaCurrentState = {
    device: {},
    meter: {},
    valve: {},
    alarms: {},
    reporting: {},
    network: {},
    lastPacketAt: sorted[0]?.timestamp ?? null,
    lastValidPacketAt: null,
    validPacketCount: 0,
    invalidPackets: [],
  };
  for (const section of STATE_SECTIONS) {
    for (const key of Object.keys(empty[section])) {
      out[section][key] = null;
    }
  }

  for (const entry of sorted) {
    if (!entry.decoded.valid) {
      out.invalidPackets.push({ id: entry.id, timestamp: entry.timestamp });
      continue;
    }
    out.validPacketCount += 1;
    if (out.lastValidPacketAt === null) out.lastValidPacketAt = entry.timestamp;

    for (const section of STATE_SECTIONS) {
      const src = entry.decoded.state[section] as unknown as Record<string, unknown>;
      const dst = out[section];
      for (const [key, value] of Object.entries(src)) {
        if (value === null || value === undefined) continue;
        if (dst[key] != null) continue; // newer observation already recorded
        dst[key] = {
          value: value as string | number | boolean,
          observedAt: entry.timestamp,
        };
      }
    }
  }

  return out;
}
