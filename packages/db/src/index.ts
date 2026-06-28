import { env } from "@taskaws/env/server";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema";

// Writer — handles INSERT/UPDATE/DELETE (and migrations via drizzle-kit)
export const dbWrite = drizzle({
  connection: {
    connectionString: env.DATABASE_WRITER_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  },
  schema,
});

// Reader — handles SELECT; point DATABASE_READER_URL at a read replica to offload reads
export const dbRead = drizzle({
  connection: {
    connectionString: env.DATABASE_READER_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  },
  schema,
});

// Backward-compatible alias — existing code that imports `db` keeps working on the writer pool
export const db = dbWrite;

// Backward-compatible factory — packages/auth calls `createDb()` at module init
export function createDb() {
  return dbWrite;
}

export * from "./github";
