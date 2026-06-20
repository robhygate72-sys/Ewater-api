import { pgTable, serial, text, boolean, real, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const alertRulesTable = pgTable("alert_rules", {
  id: serial("id").primaryKey(),
  assetId: text("asset_id").notNull(),
  offlineEnabled: boolean("offline_enabled").notNull().default(true),
  offlineHours: real("offline_hours").notNull().default(48),
  lowBatteryEnabled: boolean("low_battery_enabled").notNull().default(true),
  lowBatteryVoltage: real("low_battery_voltage").notNull().default(11.5),
  lowTankEnabled: boolean("low_tank_enabled").notNull().default(true),
  lowTankPercent: real("low_tank_percent").notNull().default(20),
  lowFlowEnabled: boolean("low_flow_enabled").notNull().default(false),
  lowFlowLitres: real("low_flow_litres").notNull().default(10),
  highFlowEnabled: boolean("high_flow_enabled").notNull().default(false),
  highFlowLitres: real("high_flow_litres").notNull().default(500),
  stuckValveEnabled: boolean("stuck_valve_enabled").notNull().default(false),
  priceCheckEnabled: boolean("price_check_enabled").notNull().default(false),
  targetPrice: real("target_price").notNull().default(1.5),
  priceDeviancePercent: real("price_deviance_percent").notNull().default(0.5),
  cooldownMinutes: integer("cooldown_minutes").notNull().default(60),
  sensorRangeMetres1: real("sensor_range_metres_1"),
  sensorRangeMetres2: real("sensor_range_metres_2"),
  sensorRangeMetres3: real("sensor_range_metres_3"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("alert_rules_asset_id_idx").on(t.assetId),
]);

export type AlertRulesRow = typeof alertRulesTable.$inferSelect;
