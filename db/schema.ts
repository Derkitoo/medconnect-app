import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const families = sqliteTable("families", {
  token: text("token").primaryKey(),
  morningConfirmed: integer("morning_confirmed", { mode: "boolean" })
    .notNull()
    .default(false),
  stateJson: text("state_json"),
  updatedAt: integer("updated_at").notNull(),
});
