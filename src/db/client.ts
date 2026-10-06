import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema";

export type Db = LibSQLDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  close: () => void;
}

/**
 * Opens a SQLite database (creating the folder if needed) and applies migrations.
 * NOTE: use a file URL, not ":memory:". libsql opens a fresh connection after each
 * transaction, which would give an in-memory database a brand-new empty state.
 */
export async function openDb(url: string): Promise<DbHandle> {
  if (url.startsWith("file:")) {
    fs.mkdirSync(path.dirname(url.slice("file:".length)), { recursive: true });
  }
  const client = createClient({ url });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return { db, close: () => client.close() };
}