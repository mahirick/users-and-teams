import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './runner.js';
import { migrations } from './index.js';

function freshDb() {
  return new Database(':memory:');
}

describe('runMigrations', () => {
  it('applies all migrations on a fresh db', () => {
    const db = freshDb();
    runMigrations(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);

    expect(names).toContain('users');
    expect(names).toContain('magic_links');
    expect(names).toContain('sessions');
    expect(names).toContain('teams');
    expect(names).toContain('team_members');
    expect(names).toContain('team_invites');
    expect(names).toContain('audit_log');
    expect(names).toContain('_uat_migrations');
  });

  it('records each applied migration in _uat_migrations', () => {
    const db = freshDb();
    runMigrations(db);

    const applied = db
      .prepare('SELECT id FROM _uat_migrations ORDER BY id')
      .all() as Array<{ id: string }>;
    expect(applied.map((r) => r.id)).toEqual(migrations.map((m) => m.id));
  });

  it('is idempotent — running twice does not error or duplicate', () => {
    const db = freshDb();
    runMigrations(db);
    runMigrations(db);

    const count = db.prepare('SELECT COUNT(*) AS c FROM _uat_migrations').get() as { c: number };
    expect(count.c).toBe(migrations.length);
  });

  it('does not collide with a consumer-owned _migrations table', () => {
    const db = freshDb();
    db.exec('CREATE TABLE _migrations (id TEXT PRIMARY KEY)');
    db.prepare('INSERT INTO _migrations (id) VALUES (?)').run('consumer_001');

    runMigrations(db);

    const consumerRows = db.prepare('SELECT id FROM _migrations').all() as Array<{ id: string }>;
    expect(consumerRows.map((r) => r.id)).toEqual(['consumer_001']);

    const ours = db.prepare('SELECT COUNT(*) AS c FROM _uat_migrations').get() as { c: number };
    expect(ours.c).toBe(migrations.length);
  });

  it('skips migrations already recorded', () => {
    const db = freshDb();
    runMigrations(db);

    // Drop a real table the second migration would create — runner should NOT recreate it
    // because the migration is recorded as already applied.
    db.exec('DROP TABLE teams');

    runMigrations(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='teams'")
      .all();
    expect(tables).toHaveLength(0);
  });
});
