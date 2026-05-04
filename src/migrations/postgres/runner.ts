// Postgres migration runner. Tracks applied migrations in the namespaced
// `_uat_migrations` table — same name as the SQLite runner, kept distinct
// per database.

import { pgMigrations } from './index.js';

export interface PgQueryClient {
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
}

const TRACKER_TABLE = '_uat_migrations';

export async function runPostgresMigrations(client: PgQueryClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${TRACKER_TABLE} (
      id          TEXT PRIMARY KEY,
      applied_at  BIGINT NOT NULL
    );
  `);

  for (const m of pgMigrations) {
    const { rows } = await client.query(
      `SELECT id FROM ${TRACKER_TABLE} WHERE id = $1`,
      [m.id],
    );
    if (rows.length > 0) continue;

    // Run inside a transaction so partial failure leaves the DB unchanged.
    await client.query('BEGIN');
    try {
      await client.query(m.sql);
      await client.query(
        `INSERT INTO ${TRACKER_TABLE} (id, applied_at) VALUES ($1, $2)`,
        [m.id, Date.now()],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }
}
