// Migration 004 — v2 membership model.
//
// Breaking schema change. Renames role values across users / team_members /
// team_invites; drops teams.slug; adds avatar + name-normalized columns;
// renames teams.owner_id → teams.admin_id. Avatar columns get placeholder
// defaults — the operations layer recomputes on the next write per row.
//
// SQLite doesn't allow DROP COLUMN on a column with a UNIQUE constraint, so
// we rebuild the teams table with the new shape and copy data over.
//
// Throwaway data only (uat-test/demo). No production consumers exist; the
// package is being bumped to 2.0.0 alongside this migration.

export const id = '004_membership_v2';

export const sql = /* sql */ `
  -- users: add avatar columns; rename system role 'admin' → 'owner'
  ALTER TABLE users ADD COLUMN avatar_color    TEXT NOT NULL DEFAULT '#525252';
  ALTER TABLE users ADD COLUMN avatar_initials TEXT NOT NULL DEFAULT '?';
  UPDATE users SET role = 'owner' WHERE role = 'admin';

  -- teams: rebuild without slug; rename owner_id → admin_id; add avatar +
  -- name_normalized columns. SQLite cannot DROP a UNIQUE column, so we copy.
  CREATE TABLE teams_v2 (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    name_normalized TEXT NOT NULL,
    admin_id        TEXT NOT NULL REFERENCES users(id),
    avatar_color    TEXT NOT NULL DEFAULT '#525252',
    avatar_initials TEXT NOT NULL DEFAULT '?',
    created_at      INTEGER NOT NULL
  );
  INSERT INTO teams_v2 (id, name, name_normalized, admin_id, avatar_color, avatar_initials, created_at)
    SELECT id, name, LOWER(TRIM(name)), owner_id, '#525252', '?', created_at FROM teams;
  DROP TABLE teams;
  ALTER TABLE teams_v2 RENAME TO teams;
  CREATE UNIQUE INDEX idx_teams_name_normalized ON teams (name_normalized);

  -- team_members: collapse roles. owner|admin → admin, member → user
  UPDATE team_members SET role = 'admin' WHERE role = 'owner';
  UPDATE team_members SET role = 'user'  WHERE role = 'member';

  -- team_invites: same role rename
  UPDATE team_invites SET role = 'admin' WHERE role = 'owner';
  UPDATE team_invites SET role = 'user'  WHERE role = 'member';
`;
