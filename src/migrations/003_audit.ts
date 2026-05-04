// Migration 003 — audit log.

export const id = '003_audit';

export const sql = /* sql */ `
  CREATE TABLE audit_log (
    -- actor_id and target_id are intentionally NOT foreign keys: audit entries
    -- must persist after their referenced rows are deleted, and we may record
    -- non-user actors ('system', 'cron', etc.) in the future.
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id        TEXT,
    action          TEXT NOT NULL,
    target_id       TEXT,
    metadata_json   TEXT,
    created_at      INTEGER NOT NULL
  );
  CREATE INDEX idx_audit_action ON audit_log (action);
  CREATE INDEX idx_audit_actor ON audit_log (actor_id);
  CREATE INDEX idx_audit_target ON audit_log (target_id);
  CREATE INDEX idx_audit_created ON audit_log (created_at);
`;
