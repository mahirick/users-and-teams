// Migration 005 — adds avatar_url columns to users and teams. Optional URL
// (null when the user/team is using auto-derived initials only). The package
// stores the *URL* the consumer's avatar store hands back, not the bytes.

export const id = '005_avatar_urls';

export const sql = /* sql */ `
  ALTER TABLE users ADD COLUMN avatar_url TEXT;
  ALTER TABLE teams ADD COLUMN avatar_url TEXT;
`;
