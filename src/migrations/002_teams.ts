// Migration 002 — teams + members + invites.

export const id = '002_teams';

export const sql = /* sql */ `
  CREATE TABLE teams (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    owner_id        TEXT NOT NULL REFERENCES users(id),
    created_at      INTEGER NOT NULL
  );

  CREATE TABLE team_members (
    team_id         TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            TEXT NOT NULL DEFAULT 'member',
    joined_at       INTEGER NOT NULL,
    PRIMARY KEY (team_id, user_id)
  );
  CREATE INDEX idx_team_members_user_id ON team_members (user_id);

  CREATE TABLE team_invites (
    token_hash      TEXT PRIMARY KEY,
    team_id         TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    inviter_id      TEXT NOT NULL REFERENCES users(id),
    email           TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'member',
    created_at      INTEGER NOT NULL,
    expires_at      INTEGER NOT NULL,
    consumed_at     INTEGER
  );
  CREATE INDEX idx_team_invites_team ON team_invites (team_id);
  CREATE INDEX idx_team_invites_email ON team_invites (email);
`;
