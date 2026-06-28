import { relations } from "drizzle-orm";
import { pgTable, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const githubProfiles = pgTable(
  "github_profiles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    githubId: integer("github_id").notNull(),
    username: text("username").notNull(),
    avatarUrl: text("avatar_url").notNull(),
    bio: text("bio"),
    publicRepos: integer("public_repos").notNull().default(0),
    syncedAt: timestamp("synced_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("github_profiles_user_id_idx").on(table.userId),
    uniqueIndex("github_profiles_github_id_idx").on(table.githubId),
  ],
);

export const githubProfilesRelations = relations(githubProfiles, ({ one }) => ({
  user: one(user, {
    fields: [githubProfiles.userId],
    references: [user.id],
  }),
}));
