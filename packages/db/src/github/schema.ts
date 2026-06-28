import { sql } from "drizzle-orm";
import { db } from "../index";

let schemaReady: Promise<void> | null = null;

export function ensureGithubSchema() {
  schemaReady ??= (async () => {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS "user" (
        "id" text PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "email" text NOT NULL UNIQUE,
        "email_verified" boolean DEFAULT false NOT NULL,
        "image" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
      );
    `));

    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS "github_profiles" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL REFERENCES "public"."user"("id") ON DELETE cascade,
        "github_id" integer NOT NULL,
        "username" text NOT NULL,
        "avatar_url" text NOT NULL,
        "bio" text,
        "public_repos" integer DEFAULT 0 NOT NULL,
        "synced_at" timestamp DEFAULT now() NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
      );
    `));

    await db.execute(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS "github_profiles_user_id_idx"
        ON "github_profiles" USING btree ("user_id");
    `));

    await db.execute(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS "github_profiles_github_id_idx"
        ON "github_profiles" USING btree ("github_id");
    `));
  })();

  return schemaReady;
}
