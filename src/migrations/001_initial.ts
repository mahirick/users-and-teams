// Migration 001 — initial users + auth schema (auth-only; teams + audit added later).

export const id = '001_initial';

export const sql = /* sql */ `
  CREATE TABLE users (
    id              TEXT PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    display_name    TEXT,
    role            TEXT NOT NULL DEFAULT 'user',
    status          TEXT NOT NULL DEFAULT 'active',
    created_at      INTEGER NOT NULL,
    last_seen_at    INTEGER
  );
  CREATE INDEX idx_users_email ON users (email);

  CREATE TABLE magic_links (
    token_hash      TEXT PRIMARY KEY,
    email           TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    expires_at      INTEGER NOT NULL,
    consumed_at     INTEGER
  );
  CREATE INDEX idx_magic_links_email ON magic_links (email);
  CREATE INDEX idx_magic_links_expires ON magic_links (expires_at);

  CREATE TABLE sessions (
    token_hash      TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      INTEGER NOT NULL,
    expires_at      INTEGER NOT NULL,
    last_used_at    INTEGER NOT NULL,
    ip              TEXT,
    user_agent      TEXT
  );
  CREATE INDEX idx_sessions_user_id ON sessions (user_id);
  CREATE INDEX idx_sessions_expires ON sessions (expires_at);
`;
