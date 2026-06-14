import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const assetFavouritesTable = pgTable("asset_favourites", {
  id: serial("id").primaryKey(),
  assetId: text("asset_id").notNull().unique(),
  assetName: text("asset_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAssetFavouriteSchema = createInsertSchema(assetFavouritesTable).omit({ id: true, createdAt: true });
export type InsertAssetFavourite = z.infer<typeof insertAssetFavouriteSchema>;
export type AssetFavourite = typeof assetFavouritesTable.$inferSelect;
