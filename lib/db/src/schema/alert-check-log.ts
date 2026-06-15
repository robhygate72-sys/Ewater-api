import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const alertCheckLogTable = pgTable("alert_check_log", {
  id: serial("id").primaryKey(),
  runId: text("run_id").notNull(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  assetId: text("asset_id").notNull(),
  assetName: text("asset_name").notNull(),
  alertType: text("alert_type").notNull(),
  enabled: boolean("enabled").notNull(),
  triggered: boolean("triggered").notNull(),
  notified: boolean("notified").notNull().default(false),
  detail: text("detail").notNull(),
});

export type AlertCheckLog = typeof alertCheckLogTable.$inferSelect;
