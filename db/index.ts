import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema";

let sqlite: Database.Database | null = null;

function getSqlite() {
  if (!sqlite) {
    const path = process.env.DATABASE_PATH?.trim() || "./data/relaydesk.sqlite";
    mkdirSync(dirname(path), { recursive: true });
    sqlite = new Database(path);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
  }
  return sqlite;
}

export function getDb() {
  return drizzle(getSqlite(), { schema });
}

export function getRawDb() {
  return getSqlite();
}
