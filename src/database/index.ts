import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config/index.js';
import { schema } from './schema.js';
mkdirSync(dirname(config.database), { recursive: true });

type SQLInputValue = any;

// Choose backend: Bun's builtin sqlite when running under Bun, otherwise better-sqlite3 for Node.
export let db: any;
const isBun = typeof Bun !== 'undefined' || !!process.env.BUN_VERSION;
if (isBun) {
  const mod = await import('bun:sqlite');
  // Bun's Database expects a filename string
  db = new mod.Database(config.database);
} else {
  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  const BetterSqlite3 = require('better-sqlite3');
  db = new BetterSqlite3(config.database);
}

db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
db.exec(schema);
console.log('Database backend:', isBun ? 'bun:sqlite' : 'better-sqlite3');
// Migrations: add branch phone column if missing so we can store contact numbers
try {
  const cols = db
    .prepare("PRAGMA table_info('branches')")
    .all()
    .map((c: any) => c.name);
  if (!cols.includes('phone')) {
    db.exec("ALTER TABLE branches ADD COLUMN phone TEXT DEFAULT ''");
  }
} catch (err) {
  // ignore migration errors; existing DBs remain functional
}
// SQL remains centralized and parameterized; row shapes are declared at the service boundary.
export function one<T = Record<string, any>>(sql: string, ...args: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...args) as T | undefined;
}
export function all<T = Record<string, any>>(sql: string, ...args: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...args) as T[];
}
export function run(sql: string, ...args: SQLInputValue[]) {
  const stmt = db.prepare(sql);
  return stmt.run(...args);
}
export function transaction<T>(action: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
