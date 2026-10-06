import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { openDb, type DbHandle } from "../../src/db/client";

/** A throwaway SQLite file under ./data (git-ignored). */
export async function openTestDb(): Promise<DbHandle & { cleanup: () => void }> {
  const file = `./data/test-${randomUUID()}.db`;
  const handle = await openDb(`file:${file}`);
  return {
    ...handle,
    cleanup: () => {
      handle.close();
      for (const f of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) {
        try {
          fs.rmSync(f, { force: true });
        } catch {
          /* Windows may keep the file locked briefly; data/ is git-ignored anyway */
        }
      }
    },
  };
}