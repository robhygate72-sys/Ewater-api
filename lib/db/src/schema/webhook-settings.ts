import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";

export const webhookSettingsTable = pgTable("webhook_settings", {
  id: serial("id").primaryKey(),
  webhookUrl: text("webhook_url"),
  enabled: boolean("enabled").notNull().default(false),
  refreshMinutes: integer("refresh_minutes").notNull().default(30),
  systems: jsonb("systems")
    .$type<Array<{ id: number; name: string }>>()
    .notNull()
    .default([
      { id: 217, name: "Kajire" },
      { id: 218, name: "Sagalla" },
    ]),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type WebhookSettingsRow = typeof webhookSettingsTable.$inferSelect;
