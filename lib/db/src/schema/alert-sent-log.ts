import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const alertSentLogTable = pgTable("alert_sent_log", {
  id: serial("id").primaryKey(),
  assetId: text("asset_id").notNull(),
  alertType: text("alert_type").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AlertSentLog = typeof alertSentLogTable.$inferSelect;
