// better-sqlite3 repository implementation. The synchronous nature of
// better-sqlite3 is wrapped in async signatures to match the Repository
// contract — operations module + Fastify routes are async, so this matches.

import type { Database as Sqlite } from 'better-sqlite3';
import { uuidv7 } from 'uuidv7';
import type {
  AuditEntry,
  MagicLink,
  Session,
  Team,
  TeamInvite,
  TeamMember,
  User,
} from '../core/types.js';
import type {
  CreateAuditEntryInput,
  CreateMagicLinkInput,
  CreateSessionInput,
  CreateTeamInput,
  CreateTeamInviteInput,
  CreateUserInput,
  ListAuditFilter,
  ListUsersFilter,
  ListUsersResult,
  Repository,
  UpdateTeamInput,
  UpdateUserInput,
} from '../core/repository.js';

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  status: string;
  created_at: number;
  last_seen_at: number | null;
}

interface SessionRow {
  token_hash: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  last_used_at: number;
  ip: string | null;
  user_agent: string | null;
}

interface MagicLinkRow {
  token_hash: string;
  email: string;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
}

interface TeamRow {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  created_at: number;
}

interface TeamMemberRow {
  team_id: string;
  user_id: string;
  role: string;
  joined_at: number;
}

interface TeamInviteRow {
  token_hash: string;
  team_id: string;
  inviter_id: string;
  email: string;
  role: string;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
}

interface AuditRow {
  id: number;
  actor_id: string | null;
  action: string;
  target_id: string | null;
  metadata_json: string | null;
  created_at: number;
}

const userFromRow = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  displayName: r.display_name,
  role: r.role as User['role'],
  status: r.status as User['status'],
  createdAt: r.created_at,
  lastSeenAt: r.last_seen_at,
});

const sessionFromRow = (r: SessionRow): Session => ({
  tokenHash: r.token_hash,
  userId: r.user_id,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  lastUsedAt: r.last_used_at,
  ip: r.ip,
  userAgent: r.user_agent,
});

const magicLinkFromRow = (r: MagicLinkRow): MagicLink => ({
  tokenHash: r.token_hash,
  email: r.email,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  consumedAt: r.consumed_at,
});

const teamFromRow = (r: TeamRow): Team => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  ownerId: r.owner_id,
  createdAt: r.created_at,
});

const memberFromRow = (r: TeamMemberRow): TeamMember => ({
  teamId: r.team_id,
  userId: r.user_id,
  role: r.role as TeamMember['role'],
  joinedAt: r.joined_at,
});

const inviteFromRow = (r: TeamInviteRow): TeamInvite => ({
  tokenHash: r.token_hash,
  teamId: r.team_id,
  inviterId: r.inviter_id,
  email: r.email,
  role: r.role as TeamInvite['role'],
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  consumedAt: r.consumed_at,
});

const auditFromRow = (r: AuditRow): AuditEntry => ({
  id: r.id,
  actorId: r.actor_id,
  action: r.action,
  targetId: r.target_id,
  metadataJson: r.metadata_json,
  createdAt: r.created_at,
});

export function createSqliteRepository(db: Sqlite): Repository {
  // Enable foreign keys for cascade behavior (caller may have set it; this is idempotent)
  db.pragma('foreign_keys = ON');

  return {
    // ---- users ----
    async createUser(input: CreateUserInput, now: number): Promise<User> {
      const id = uuidv7();
      db.prepare(
        `INSERT INTO users (id, email, display_name, role, status, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, 'active', ?, NULL)`,
      ).run(id, input.email, input.displayName ?? null, input.role ?? 'user', now);

      const row = db.prepare<[string], UserRow>('SELECT * FROM users WHERE id = ?').get(id);
      return userFromRow(row!);
    },

    async getUser(id) {
      const row = db
        .prepare<[string], UserRow>('SELECT * FROM users WHERE id = ?')
        .get(id);
      return row ? userFromRow(row) : null;
    },

    async findUserByEmail(email) {
      const row = db
        .prepare<[string], UserRow>('SELECT * FROM users WHERE email = ?')
        .get(email);
      return row ? userFromRow(row) : null;
    },

    async updateUser(id, patch: UpdateUserInput) {
      const sets: string[] = [];
      const params: Array<string | number | null> = [];

      if (patch.displayName !== undefined) {
        sets.push('display_name = ?');
        params.push(patch.displayName);
      }
      if (patch.role !== undefined) {
        sets.push('role = ?');
        params.push(patch.role);
      }
      if (patch.status !== undefined) {
        sets.push('status = ?');
        params.push(patch.status);
      }
      if (patch.lastSeenAt !== undefined) {
        sets.push('last_seen_at = ?');
        params.push(patch.lastSeenAt);
      }
      if (patch.email !== undefined) {
        sets.push('email = ?');
        params.push(patch.email);
      }

      if (sets.length > 0) {
        params.push(id);
        db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);
      }

      const row = db.prepare<[string], UserRow>('SELECT * FROM users WHERE id = ?').get(id);
      if (!row) throw new Error(`User ${id} not found`);
      return userFromRow(row);
    },

    async deleteUser(id) {
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    },

    async listUsers(filter: ListUsersFilter): Promise<ListUsersResult> {
      const where: string[] = [];
      const params: Array<string | number> = [];
      if (filter.search) {
        where.push("(LOWER(email) LIKE ? OR LOWER(COALESCE(display_name, '')) LIKE ?)");
        const q = `%${filter.search.toLowerCase()}%`;
        params.push(q, q);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const totalRow = db
        .prepare<typeof params, { c: number }>(
          `SELECT COUNT(*) AS c FROM users ${whereSql}`,
        )
        .get(...params);
      const total = totalRow?.c ?? 0;

      const page = Math.max(filter.page ?? 1, 1);
      const pageSize = filter.pageSize ?? total;
      const offset = (page - 1) * pageSize;

      const rows = db
        .prepare<Array<string | number>, UserRow>(
          `SELECT * FROM users ${whereSql} ORDER BY created_at ASC LIMIT ? OFFSET ?`,
        )
        .all(...params, pageSize, offset);

      return { users: rows.map(userFromRow), total };
    },

    // ---- magic links ----
    async createMagicLink(input: CreateMagicLinkInput, now: number) {
      db.prepare(
        `INSERT INTO magic_links (token_hash, email, created_at, expires_at, consumed_at)
         VALUES (?, ?, ?, ?, NULL)`,
      ).run(input.tokenHash, input.email, now, input.expiresAt);
    },

    async findMagicLinkByHash(tokenHash) {
      const row = db
        .prepare<[string], MagicLinkRow>('SELECT * FROM magic_links WHERE token_hash = ?')
        .get(tokenHash);
      return row ? magicLinkFromRow(row) : null;
    },

    async consumeMagicLink(tokenHash, now) {
      db.prepare('UPDATE magic_links SET consumed_at = ? WHERE token_hash = ?').run(
        now,
        tokenHash,
      );
    },

    async countMagicLinksForEmailSince(email, since) {
      const row = db
        .prepare<[string, number], { c: number }>(
          'SELECT COUNT(*) AS c FROM magic_links WHERE email = ? AND created_at >= ?',
        )
        .get(email, since);
      return row?.c ?? 0;
    },

    // ---- sessions ----
    async createSession(input: CreateSessionInput, now: number) {
      db.prepare(
        `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used_at, ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.tokenHash,
        input.userId,
        now,
        input.expiresAt,
        now,
        input.ip ?? null,
        input.userAgent ?? null,
      );
      const row = db
        .prepare<[string], SessionRow>('SELECT * FROM sessions WHERE token_hash = ?')
        .get(input.tokenHash);
      return sessionFromRow(row!);
    },

    async findSessionByHash(tokenHash) {
      const row = db
        .prepare<[string], SessionRow>('SELECT * FROM sessions WHERE token_hash = ?')
        .get(tokenHash);
      return row ? sessionFromRow(row) : null;
    },

    async bumpSession(tokenHash, lastUsedAt, expiresAt) {
      db.prepare(
        'UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE token_hash = ?',
      ).run(lastUsedAt, expiresAt, tokenHash);
    },

    async deleteSession(tokenHash) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    },

    async deleteSessionsForUser(userId) {
      const result = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      return Number(result.changes);
    },

    // ---- teams ----
    async createTeam(input: CreateTeamInput, now: number) {
      db.prepare(
        `INSERT INTO teams (id, name, slug, owner_id, created_at) VALUES (?, ?, ?, ?, ?)`,
      ).run(input.id, input.name, input.slug, input.ownerId, now);
      const row = db.prepare<[string], TeamRow>('SELECT * FROM teams WHERE id = ?').get(input.id);
      return teamFromRow(row!);
    },

    async getTeam(id) {
      const row = db.prepare<[string], TeamRow>('SELECT * FROM teams WHERE id = ?').get(id);
      return row ? teamFromRow(row) : null;
    },

    async findTeamBySlug(slug) {
      const row = db
        .prepare<[string], TeamRow>('SELECT * FROM teams WHERE slug = ?')
        .get(slug);
      return row ? teamFromRow(row) : null;
    },

    async updateTeam(id, patch: UpdateTeamInput) {
      const sets: string[] = [];
      const params: Array<string | number> = [];
      if (patch.name !== undefined) {
        sets.push('name = ?');
        params.push(patch.name);
      }
      if (patch.slug !== undefined) {
        sets.push('slug = ?');
        params.push(patch.slug);
      }
      if (patch.ownerId !== undefined) {
        sets.push('owner_id = ?');
        params.push(patch.ownerId);
      }
      if (sets.length > 0) {
        params.push(id);
        db.prepare(`UPDATE teams SET ${sets.join(', ')} WHERE id = ?`).run(...params);
      }
      const row = db.prepare<[string], TeamRow>('SELECT * FROM teams WHERE id = ?').get(id);
      if (!row) throw new Error(`Team ${id} not found`);
      return teamFromRow(row);
    },

    async deleteTeam(id) {
      db.prepare('DELETE FROM teams WHERE id = ?').run(id);
    },

    async listTeamsForUser(userId) {
      const rows = db
        .prepare<[string], TeamRow & { mr: string }>(
          `SELECT t.*, tm.role AS mr
             FROM teams t
             JOIN team_members tm ON tm.team_id = t.id
            WHERE tm.user_id = ?
            ORDER BY t.created_at ASC`,
        )
        .all(userId);
      return rows.map((r) => ({ team: teamFromRow(r), role: r.mr as TeamMember['role'] }));
    },

    // ---- team members ----
    async addTeamMember(teamId, userId, role, now) {
      db.prepare(
        `INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)`,
      ).run(teamId, userId, role, now);
      return { teamId, userId, role, joinedAt: now };
    },

    async getTeamMember(teamId, userId) {
      const row = db
        .prepare<[string, string], TeamMemberRow>(
          'SELECT * FROM team_members WHERE team_id = ? AND user_id = ?',
        )
        .get(teamId, userId);
      return row ? memberFromRow(row) : null;
    },

    async listTeamMembers(teamId) {
      interface JoinedRow {
        team_id: string;
        user_id: string;
        role: string;
        joined_at: number;
        u_id: string;
        email: string;
        display_name: string | null;
        u_role: string;
        status: string;
        u_created_at: number;
        last_seen_at: number | null;
      }
      const rows = db
        .prepare<[string], JoinedRow>(
          `SELECT tm.team_id, tm.user_id, tm.role, tm.joined_at,
                  u.id AS u_id, u.email, u.display_name, u.role AS u_role,
                  u.status, u.created_at AS u_created_at, u.last_seen_at
             FROM team_members tm
             JOIN users u ON u.id = tm.user_id
            WHERE tm.team_id = ?
            ORDER BY tm.joined_at ASC`,
        )
        .all(teamId);
      return rows.map((r) => ({
        member: {
          teamId: r.team_id,
          userId: r.user_id,
          role: r.role as TeamMember['role'],
          joinedAt: r.joined_at,
        },
        user: {
          id: r.u_id,
          email: r.email,
          displayName: r.display_name,
          role: r.u_role as User['role'],
          status: r.status as User['status'],
          createdAt: r.u_created_at,
          lastSeenAt: r.last_seen_at,
        },
      }));
    },

    async updateTeamMemberRole(teamId, userId, role) {
      db.prepare(
        'UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?',
      ).run(role, teamId, userId);
      const row = db
        .prepare<[string, string], TeamMemberRow>(
          'SELECT * FROM team_members WHERE team_id = ? AND user_id = ?',
        )
        .get(teamId, userId);
      if (!row) throw new Error('Member not found');
      return memberFromRow(row);
    },

    async removeTeamMember(teamId, userId) {
      db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(
        teamId,
        userId,
      );
    },

    // ---- team invites ----
    async createTeamInvite(input: CreateTeamInviteInput, now: number) {
      db.prepare(
        `INSERT INTO team_invites (token_hash, team_id, inviter_id, email, role, created_at, expires_at, consumed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).run(
        input.tokenHash,
        input.teamId,
        input.inviterId,
        input.email,
        input.role,
        now,
        input.expiresAt,
      );
    },

    async findTeamInviteByHash(tokenHash) {
      const row = db
        .prepare<[string], TeamInviteRow>('SELECT * FROM team_invites WHERE token_hash = ?')
        .get(tokenHash);
      return row ? inviteFromRow(row) : null;
    },

    async consumeTeamInvite(tokenHash, now) {
      db.prepare('UPDATE team_invites SET consumed_at = ? WHERE token_hash = ?').run(
        now,
        tokenHash,
      );
    },

    async listTeamInvites(teamId) {
      const rows = db
        .prepare<[string], TeamInviteRow>(
          'SELECT * FROM team_invites WHERE team_id = ? ORDER BY created_at DESC',
        )
        .all(teamId);
      return rows.map(inviteFromRow);
    },

    // ---- audit ----
    async createAuditEntry(input: CreateAuditEntryInput, now: number) {
      const result = db
        .prepare(
          `INSERT INTO audit_log (actor_id, action, target_id, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          input.actorId,
          input.action,
          input.targetId ?? null,
          input.metadata ? JSON.stringify(input.metadata) : null,
          now,
        );
      const id = Number(result.lastInsertRowid);
      const row = db
        .prepare<[number], AuditRow>('SELECT * FROM audit_log WHERE id = ?')
        .get(id);
      return auditFromRow(row!);
    },

    async listAuditEntries(filter: ListAuditFilter): Promise<AuditEntry[]> {
      const where: string[] = [];
      const params: Array<string | number> = [];
      if (filter.action) {
        where.push('action = ?');
        params.push(filter.action);
      }
      if (filter.actorId) {
        where.push('actor_id = ?');
        params.push(filter.actorId);
      }
      if (filter.targetId) {
        where.push('target_id = ?');
        params.push(filter.targetId);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const limit = filter.limit ?? 100;

      const rows = db
        .prepare<Array<string | number>, AuditRow>(
          `SELECT * FROM audit_log ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .all(...params, limit);
      return rows.map(auditFromRow);
    },
  };
}
