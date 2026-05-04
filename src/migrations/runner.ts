// Migration runner for SQLite. Tracks applied migrations in the namespaced
// `_uat_migrations` table so the package can share a database with a consumer's
// own schema without colliding on a generic `_migrations` table.

import type { Database as Sqlite } from 'better-sqlite3';
import { migrations } from './index.js';

const TRACKER_TABLE = '_uat_migrations';

export function runMigrations(db: Sqlite): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TRACKER_TABLE} (
      id          TEXT PRIMARY KEY,
      applied_at  INTEGER NOT NULL
    );
  `);

  const stmt = db.prepare<[string], { id: string }>(
    `SELECT id FROM ${TRACKER_TABLE} WHERE id = ?`,
  );
  const insert = db.prepare<[string, number]>(
    `INSERT INTO ${TRACKER_TABLE} (id, applied_at) VALUES (?, ?)`,
  );

  // Each migration runs in its own transaction so a failure mid-run leaves the
  // database in a consistent (pre-migration) state for that step.
  for (const m of migrations) {
    if (stmt.get(m.id)) continue;

    db.transaction(() => {
      db.exec(m.sql);
      insert.run(m.id, Date.now());
    })();
  }
}
