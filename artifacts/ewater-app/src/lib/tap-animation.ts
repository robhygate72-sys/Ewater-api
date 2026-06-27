import { EWC25_EVENT_NAMES, eventCategory } from "./ewc25";

// Animation kinds the tap visualizer knows how to play.
export type TapAnimKind =
  | "dispense"
  | "tag-removed"
  | "dispense-limit"
  | "no-credit"
  | "valve-off"
  | "error"
  | "no-flow"
  | "low-battery"
  | "tamper"
  | "prox"
  | "pressure"
  | "health"
  | "startup"
  | "command"
  | "gadwall"
  | "beam"
  | "idle";

export type TapTone = "water" | "good" | "warn" | "error" | "info";

export interface TapAnim {
  kind: TapAnimKind;
  label: string;
  tone: TapTone;
}

function b64Byte(b64: string, idx: number): number | null {
  try {
    const s = atob(b64);
    return s.length > idx ? s.charCodeAt(idx) : null;
  } catch {
    return null;
  }
}

function ewcEventToAnim(ev: number): TapAnim {
  const name = EWC25_EVENT_NAMES[ev] ?? `Event 0x${ev.toString(16)}`;
  switch (ev) {
    case 0x09: return { kind: "tag-removed", label: "Tag removed", tone: "warn" };
    case 0x0b: return { kind: "dispense-limit", label: "Dispense limit reached", tone: "warn" };
    case 0x01: return { kind: "no-credit", label: "No credit", tone: "warn" };
    case 0x15: return { kind: "valve-off", label: "Host valve off", tone: "warn" };
    case 0x10:
    case 0x17: return { kind: "no-flow", label: name, tone: "warn" };
    case 0x12: return { kind: "low-battery", label: "Low battery", tone: "warn" };
    case 0x18: return { kind: "tamper", label: "Tamper detected", tone: "error" };
    case 0x11: return { kind: "prox", label: "Proximity detect", tone: "info" };
    case 0x13: return { kind: "pressure", label: "Pressure event", tone: "info" };
    case 0x16: return { kind: "startup", label: "Start-up", tone: "info" };
    case 0x19: return { kind: "health", label: "Healthy signal", tone: "good" };
    case 0x14: return { kind: "dispense", label: "SuperTap top-up", tone: "water" };
  }
  const cat = eventCategory(ev);
  if (cat === "error") return { kind: "error", label: name, tone: "error" };
  if (cat === "warning") return { kind: "no-flow", label: name, tone: "warn" };
  if (cat === "dispense") return { kind: "dispense", label: "Water dispensed", tone: "water" };
  return { kind: "idle", label: name, tone: "info" };
}

// Map a log entry (protocol + raw base64 message) to a tap animation descriptor.
// Reuses the same byte offsets the log categoriser uses.
export function entryToTapAnim(protocol: string | null, message: string | null): TapAnim {
  const p = protocol ?? "";
  const msg = message ?? "";
  const isEwc = p.toLowerCase().startsWith("ewc");

  if (p === "CommandApi_1") return { kind: "command", label: "Command sent", tone: "info" };

  if (isEwc) {
    const b0 = b64Byte(msg, 0);
    if (b0 === 0x80 || b0 === 0x88) return { kind: "command", label: "Command reply", tone: "info" };
    if (b0 === 0x44) {
      const ev = b64Byte(msg, 5);
      if (ev != null) return ewcEventToAnim(ev);
    }
    return { kind: "idle", label: "EWC packet", tone: "info" };
  }

  if (p === "4CCv1") return { kind: "gadwall", label: "Gadwall signal", tone: "info" };
  if (p.toLowerCase().includes("beam")) return { kind: "beam", label: "Beam signal", tone: "info" };

  return { kind: "idle", label: "Log entry", tone: "info" };
}
