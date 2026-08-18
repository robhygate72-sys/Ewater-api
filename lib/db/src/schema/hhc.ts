import {
  pgTable,
  serial,
  text,
  integer,
  real,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// HHC (Household Meter Commissioning) persistence.
//
// hhc_commissioning_sessions — one row per meter asset going through the
// three-gate commissioning workflow (Gate 1 Manufacturer QC, Gate 2
// Gearbox/bench test, Gate 3 eWATER Kenya acceptance).
// ---------------------------------------------------------------------------

export const hhcCommissioningSessionsTable = pgTable(
  "hhc_commissioning_sessions",
  {
    id: serial("id").primaryKey(),
    assetId: text("asset_id").notNull(),
    /** gate1 | gate2 | gate3 | approved */
    stage: text("stage").notNull().default("gate1"),
    /** Set when the three-communication commissioning test is started. */
    commissioningTestStartedAt: timestamp("commissioning_test_started_at", { withTimezone: true }),
    /** Batch size this meter belongs to (drives Gate 3 sampling maths). */
    batchSize: integer("batch_size"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: text("approved_by"),
    /** Non-null when approval happened via authorised override of blockers. */
    overrideReason: text("override_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    updatedBy: text("updated_by"),
  },
  (t) => [uniqueIndex("hhc_sessions_asset_id_idx").on(t.assetId)],
);

// ---------------------------------------------------------------------------
// hhc_qc_results — manual QC check results per (asset, checkCode). Auto checks
// are never stored here: they are always recomputed from live device data.
// ---------------------------------------------------------------------------

export const hhcQcResultsTable = pgTable(
  "hhc_qc_results",
  {
    id: serial("id").primaryKey(),
    assetId: text("asset_id").notNull(),
    checkCode: text("check_code").notNull(),
    /** 1 | 2 | 3 — which gate this check belongs to. */
    gate: integer("gate").notNull(),
    /** PASS | FAIL | PENDING */
    result: text("result").notNull().default("PENDING"),
    operator: text("operator").notNull(),
    notes: text("notes"),
    /** Free-form structured evidence supplied by the operator. */
    evidence: jsonb("evidence"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("hhc_qc_results_asset_check_idx").on(t.assetId, t.checkCode),
    index("hhc_qc_results_asset_idx").on(t.assetId),
  ],
);

// ---------------------------------------------------------------------------
// hhc_configuration — single-row global HHC configuration.
//
// Enforced as a singleton via a fixed primary key (id = 1) and a CHECK
// constraint. All reads and writes use `id = 1` directly; upsert ensures
// concurrent first-access cannot produce duplicate rows.
// ---------------------------------------------------------------------------

export const hhcConfigurationTable = pgTable(
  "hhc_configuration",
  {
    /** Fixed singleton PK — always 1. */
    id: integer("id").primaryKey().default(1),
    batteryCriticalVoltage: real("battery_critical_voltage").notNull().default(3.2),
    batteryWarningVoltage: real("battery_warning_voltage").notNull().default(3.5),
    /** Percentage of a batch that Gate 3 acceptance must sample. */
    gate3SamplePct: real("gate3_sample_pct").notNull().default(10),
    /** Max allowed |device RTC − server receive time| in seconds; null = not configured. */
    rtcToleranceSeconds: integer("rtc_tolerance_seconds").default(300),
    requiredOverdraftLitres: real("required_overdraft_litres").notNull().default(0),
    tariffKesPer1000L: real("tariff_kes_per_1000l").notNull().default(250),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    updatedBy: text("updated_by"),
  },
  (t) => [check("hhc_configuration_singleton", sql`${t.id} = 1`)],
);

// ---------------------------------------------------------------------------
// hhc_action_audit — append-only audit log of commissioning actions
// (stage transitions, approvals, overrides, Pulse parts calls, config edits).
// ---------------------------------------------------------------------------

export const hhcActionAuditTable = pgTable(
  "hhc_action_audit",
  {
    id: serial("id").primaryKey(),
    assetId: text("asset_id"),
    action: text("action").notNull(),
    operator: text("operator").notNull(),
    reason: text("reason"),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("hhc_action_audit_asset_idx").on(t.assetId)],
);

export type HhcCommissioningSessionRow = typeof hhcCommissioningSessionsTable.$inferSelect;
export type HhcQcResultRow = typeof hhcQcResultsTable.$inferSelect;
export type HhcConfigurationRow = typeof hhcConfigurationTable.$inferSelect;
export type HhcActionAuditRow = typeof hhcActionAuditTable.$inferSelect;
