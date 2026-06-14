import { pgTable, serial, boolean, real, integer, timestamp } from "drizzle-orm/pg-core";

export const alertRulesTable = pgTable("alert_rules", {
  id: serial("id").primaryKey(),
  offlineEnabled: boolean("offline_enabled").notNull().default(true),
  offlineHours: real("offline_hours").notNull().default(48),
  lowBatteryEnabled: boolean("low_battery_enabled").notNull().default(true),
  lowBatteryVoltage: real("low_battery_voltage").notNull().default(3.5),
  lowTankEnabled: boolean("low_tank_enabled").notNull().default(true),
  lowTankPercent: real("low_tank_percent").notNull().default(20),
  lowFlowEnabled: boolean("low_flow_enabled").notNull().default(false),
  lowFlowLitres: real("low_flow_litres").notNull().default(10),
  highFlowEnabled: boolean("high_flow_enabled").notNull().default(false),
  highFlowLitres: real("high_flow_litres").notNull().default(500),
  stuckValveEnabled: boolean("stuck_valve_enabled").notNull().default(false),
  cooldownMinutes: integer("cooldown_minutes").notNull().default(60),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AlertRulesRow = typeof alertRulesTable.$inferSelect;
