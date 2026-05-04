// Postgres-flavored migrations. Equivalent schema + data to the SQLite
// migrations under `src/migrations/`, but using BIGINT/TEXT/BOOLEAN and
// $1-style parameters where it matters. Runner: `runPostgresMigrations`.

export interface PgMigration {
  id: string;
  sql: string;
}

const m001_initial: PgMigration = {
  id: '001_initial',
  sql: /* sql */ `
    CREATE TABLE IF NOT EXISTS users (
      id              TEXT PRIMARY KEY,
      email           TEXT NOT NULL UNIQUE,
      display_name    TEXT,
      role            TEXT NOT NULL DEFAULT 'user',
      status          TEXT NOT NULL DEFAULT 'active',
      created_at      BIGINT NOT NULL,
      last_seen_at    BIGINT
    );

    CREATE TABLE IF NOT EXISTS magic_links (
      token_hash      TEXT PRIMARY KEY,
      email           TEXT NOT NULL,
      created_at      BIGINT NOT NULL,
      expires_at      BIGINT NOT NULL,
      consumed_at     BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_magic_links_email ON magic_links (email);

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash      TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at      BIGINT NOT NULL,
      expires_at      BIGINT NOT NULL,
      last_used_at    BIGINT NOT NULL,
      ip              TEXT,
      user_agent      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
  `,
};

const m002_teams: PgMigration = {
  id: '002_teams',
  sql: /* sql */ `
    CREATE TABLE IF NOT EXISTS teams (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      slug            TEXT NOT NULL UNIQUE,
      owner_id        TEXT NOT NULL REFERENCES users(id),
      created_at      BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS team_members (
      team_id         TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role            TEXT NOT NULL DEFAULT 'member',
      joined_at       BIGINT NOT NULL,
      PRIMARY KEY (team_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members (user_id);

    CREATE TABLE IF NOT EXISTS team_invites (
      token_hash      TEXT PRIMARY KEY,
      team_id         TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      inviter_id      TEXT NOT NULL REFERENCES users(id),
      email           TEXT NOT NULL,
      role            TEXT NOT NULL DEFAULT 'member',
      created_at      BIGINT NOT NULL,
      expires_at      BIGINT NOT NULL,
      consumed_at     BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_team_invites_team ON team_invites (team_id);
    CREATE INDEX IF NOT EXISTS idx_team_invites_email ON team_invites (email);
  `,
};

const m003_audit: PgMigration = {
  id: '003_audit',
  sql: /* sql */ `
    CREATE TABLE IF NOT EXISTS audit_log (
      id              BIGSERIAL PRIMARY KEY,
      actor_id        TEXT,
      action          TEXT NOT NULL,
      target_id       TEXT,
      metadata_json   TEXT,
      created_at      BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log (action);
    CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log (actor_id);
    CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log (target_id);
  `,
};

const m004_membership_v2: PgMigration = {
  id: '004_membership_v2',
  sql: /* sql */ `
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_color    TEXT NOT NULL DEFAULT '#525252';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_initials TEXT NOT NULL DEFAULT '?';
    UPDATE users SET role = 'owner' WHERE role = 'admin';

    -- Postgres can drop a UNIQUE column directly.
    ALTER TABLE teams DROP COLUMN IF EXISTS slug;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS name_normalized TEXT;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS avatar_color    TEXT NOT NULL DEFAULT '#525252';
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS avatar_initials TEXT NOT NULL DEFAULT '?';
    UPDATE teams SET name_normalized = LOWER(TRIM(name)) WHERE name_normalized IS NULL;
    ALTER TABLE teams ALTER COLUMN name_normalized SET NOT NULL;
    ALTER TABLE teams RENAME COLUMN owner_id TO admin_id;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_name_normalized ON teams (name_normalized);

    UPDATE team_members SET role = 'admin' WHERE role = 'owner';
    UPDATE team_members SET role = 'user'  WHERE role = 'member';
    UPDATE team_invites SET role = 'admin' WHERE role = 'owner';
    UPDATE team_invites SET role = 'user'  WHERE role = 'member';
  `,
};

const m005_avatar_urls: PgMigration = {
  id: '005_avatar_urls',
  sql: /* sql */ `
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS avatar_url TEXT;
  `,
};

export const pgMigrations: PgMigration[] = [
  m001_initial,
  m002_teams,
  m003_audit,
  m004_membership_v2,
  m005_avatar_urls,
];
