// PostgreSQL repository implementation. Accepts any client that conforms to
// the small `PgQueryClient` interface — usually a `pg.Pool` or `pg.Client`,
// but consumers can plug `postgres-js` or a custom wrapper.
//
// To use: install `pg` (peer dep, optional), create a Pool, run
// `runPostgresMigrations(client)` once, then pass it to
// `createPostgresRepository(client)`.

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

export interface PgQueryClient {
  query: <R = unknown>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: R[]; rowCount?: number | null }>;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  status: string;
  avatar_color: string;
  avatar_initials: string;
  avatar_url: string | null;
  created_at: string | number;
  last_seen_at: string | number | null;
}

interface SessionRow {
  token_hash: string;
  user_id: string;
  created_at: string | number;
  expires_at: string | number;
  last_used_at: string | number;
  ip: string | null;
  user_agent: string | null;
}

interface MagicLinkRow {
  token_hash: string;
  email: string;
  created_at: string | number;
  expires_at: string | number;
  consumed_at: string | number | null;
}

interface TeamRow {
  id: string;
  name: string;
  name_normalized: string;
  admin_id: string;
  avatar_color: string;
  avatar_initials: string;
  avatar_url: string | null;
  created_at: string | number;
}

interface TeamMemberRow {
  team_id: string;
  user_id: string;
  role: string;
  joined_at: string | number;
}

interface TeamInviteRow {
  token_hash: string;
  team_id: string;
  inviter_id: string;
  email: string;
  role: string;
  created_at: string | number;
  expires_at: string | number;
  consumed_at: string | number | null;
}

interface AuditRow {
  id: string | number;
  actor_id: string | null;
  action: string;
  target_id: string | null;
  metadata_json: string | null;
  created_at: string | number;
}

// pg returns BIGINT as string by default — coerce to number for our types.
const num = (v: string | number | null | undefined): number =>
  v === null || v === undefined ? 0 : typeof v === 'string' ? Number(v) : v;
const numOrNull = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined ? null : typeof v === 'string' ? Number(v) : v;

const userFromRow = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  displayName: r.display_name,
  role: r.role as User['role'],
  status: r.status as User['status'],
  avatarColor: r.avatar_color,
  avatarInitials: r.avatar_initials,
  avatarUrl: r.avatar_url,
  createdAt: num(r.created_at),
  lastSeenAt: numOrNull(r.last_seen_at),
});

const sessionFromRow = (r: SessionRow): Session => ({
  tokenHash: r.token_hash,
  userId: r.user_id,
  createdAt: num(r.created_at),
  expiresAt: num(r.expires_at),
  lastUsedAt: num(r.last_used_at),
  ip: r.ip,
  userAgent: r.user_agent,
});

const magicLinkFromRow = (r: MagicLinkRow): MagicLink => ({
  tokenHash: r.token_hash,
  email: r.email,
  createdAt: num(r.created_at),
  expiresAt: num(r.expires_at),
  consumedAt: numOrNull(r.consumed_at),
});

const teamFromRow = (r: TeamRow): Team => ({
  id: r.id,
  name: r.name,
  nameNormalized: r.name_normalized,
  adminId: r.admin_id,
  avatarColor: r.avatar_color,
  avatarInitials: r.avatar_initials,
  avatarUrl: r.avatar_url,
  createdAt: num(r.created_at),
});

const memberFromRow = (r: TeamMemberRow): TeamMember => ({
  teamId: r.team_id,
  userId: r.user_id,
  role: r.role as TeamMember['role'],
  joinedAt: num(r.joined_at),
});

const inviteFromRow = (r: TeamInviteRow): TeamInvite => ({
  tokenHash: r.token_hash,
  teamId: r.team_id,
  inviterId: r.inviter_id,
  email: r.email,
  role: r.role as TeamInvite['role'],
  createdAt: num(r.created_at),
  expiresAt: num(r.expires_at),
  consumedAt: numOrNull(r.consumed_at),
});

const auditFromRow = (r: AuditRow): AuditEntry => ({
  id: typeof r.id === 'string' ? Number(r.id) : r.id,
  actorId: r.actor_id,
  action: r.action,
  targetId: r.target_id,
  metadataJson: r.metadata_json,
  createdAt: num(r.created_at),
});

export function createPostgresRepository(client: PgQueryClient): Repository {
  return {
    // ---- users ----
    async createUser(input: CreateUserInput, now: number): Promise<User> {
      const id = uuidv7();
      const { rows } = await client.query<UserRow>(
        `INSERT INTO users (id, email, display_name, role, status, avatar_color, avatar_initials, created_at, last_seen_at)
         VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, NULL)
         RETURNING *`,
        [
          id,
          input.email,
          input.displayName ?? null,
          input.role ?? 'user',
          input.avatarColor ?? '#525252',
          input.avatarInitials ?? '?',
          now,
        ],
      );
      return userFromRow(rows[0]!);
    },

    async getUser(id) {
      const { rows } = await client.query<UserRow>(
        'SELECT * FROM users WHERE id = $1',
        [id],
      );
      return rows[0] ? userFromRow(rows[0]) : null;
    },

    async findUserByEmail(email) {
      const { rows } = await client.query<UserRow>(
        'SELECT * FROM users WHERE email = $1',
        [email],
      );
      return rows[0] ? userFromRow(rows[0]) : null;
    },

    async updateUser(id, patch: UpdateUserInput) {
      const sets: string[] = [];
      const params: unknown[] = [];
      let n = 1;
      const push = (col: string, v: unknown): void => {
        sets.push(`${col} = $${n++}`);
        params.push(v);
      };
      if (patch.displayName !== undefined) push('display_name', patch.displayName);
      if (patch.role !== undefined) push('role', patch.role);
      if (patch.status !== undefined) push('status', patch.status);
      if (patch.lastSeenAt !== undefined) push('last_seen_at', patch.lastSeenAt);
      if (patch.email !== undefined) push('email', patch.email);
      if (patch.avatarColor !== undefined) push('avatar_color', patch.avatarColor);
      if (patch.avatarInitials !== undefined) push('avatar_initials', patch.avatarInitials);
      if (patch.avatarUrl !== undefined) push('avatar_url', patch.avatarUrl);

      if (sets.length === 0) {
        const { rows } = await client.query<UserRow>(
          'SELECT * FROM users WHERE id = $1',
          [id],
        );
        if (!rows[0]) throw new Error(`User ${id} not found`);
        return userFromRow(rows[0]);
      }
      params.push(id);
      const { rows } = await client.query<UserRow>(
        `UPDATE users SET ${sets.join(', ')} WHERE id = $${n} RETURNING *`,
        params,
      );
      if (!rows[0]) throw new Error(`User ${id} not found`);
      return userFromRow(rows[0]);
    },

    async deleteUser(id) {
      await client.query('DELETE FROM users WHERE id = $1', [id]);
    },

    async listUsers(filter: ListUsersFilter): Promise<ListUsersResult> {
      const where: string[] = [];
      const params: unknown[] = [];
      let n = 1;
      if (filter.search) {
        where.push(
          `(LOWER(email) LIKE $${n} OR LOWER(COALESCE(display_name, '')) LIKE $${n})`,
        );
        params.push(`%${filter.search.toLowerCase()}%`);
        n++;
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const totalRes = await client.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM users ${whereSql}`,
        params,
      );
      const total = Number(totalRes.rows[0]?.c ?? 0);

      const page = Math.max(filter.page ?? 1, 1);
      const pageSize = filter.pageSize ?? total;
      const offset = (page - 1) * pageSize;

      const { rows } = await client.query<UserRow>(
        `SELECT * FROM users ${whereSql} ORDER BY created_at ASC LIMIT $${n} OFFSET $${n + 1}`,
        [...params, pageSize, offset],
      );
      return { users: rows.map(userFromRow), total };
    },

    // ---- magic links ----
    async createMagicLink(input: CreateMagicLinkInput, now: number) {
      await client.query(
        `INSERT INTO magic_links (token_hash, email, created_at, expires_at, consumed_at)
         VALUES ($1, $2, $3, $4, NULL)`,
        [input.tokenHash, input.email, now, input.expiresAt],
      );
    },

    async findMagicLinkByHash(tokenHash) {
      const { rows } = await client.query<MagicLinkRow>(
        'SELECT * FROM magic_links WHERE token_hash = $1',
        [tokenHash],
      );
      return rows[0] ? magicLinkFromRow(rows[0]) : null;
    },

    async consumeMagicLink(tokenHash, now) {
      await client.query(
        'UPDATE magic_links SET consumed_at = $1 WHERE token_hash = $2',
        [now, tokenHash],
      );
    },

    async countMagicLinksForEmailSince(email, since) {
      const { rows } = await client.query<{ c: string }>(
        'SELECT COUNT(*)::text AS c FROM magic_links WHERE email = $1 AND created_at >= $2',
        [email, since],
      );
      return Number(rows[0]?.c ?? 0);
    },

    // ---- sessions ----
    async createSession(input: CreateSessionInput, now: number) {
      const { rows } = await client.query<SessionRow>(
        `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used_at, ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          input.tokenHash,
          input.userId,
          now,
          input.expiresAt,
          now,
          input.ip ?? null,
          input.userAgent ?? null,
        ],
      );
      return sessionFromRow(rows[0]!);
    },

    async findSessionByHash(tokenHash) {
      const { rows } = await client.query<SessionRow>(
        'SELECT * FROM sessions WHERE token_hash = $1',
        [tokenHash],
      );
      return rows[0] ? sessionFromRow(rows[0]) : null;
    },

    async bumpSession(tokenHash, lastUsedAt, expiresAt) {
      await client.query(
        'UPDATE sessions SET last_used_at = $1, expires_at = $2 WHERE token_hash = $3',
        [lastUsedAt, expiresAt, tokenHash],
      );
    },

    async deleteSession(tokenHash) {
      await client.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
    },

    async deleteSessionsForUser(userId) {
      const { rowCount } = await client.query(
        'DELETE FROM sessions WHERE user_id = $1',
        [userId],
      );
      return rowCount ?? 0;
    },

    // ---- teams ----
    async createTeam(input: CreateTeamInput, now: number) {
      const nameNormalized = input.nameNormalized ?? input.name.trim().toLowerCase();
      const { rows } = await client.query<TeamRow>(
        `INSERT INTO teams (id, name, name_normalized, admin_id, avatar_color, avatar_initials, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          input.id,
          input.name,
          nameNormalized,
          input.adminId,
          input.avatarColor ?? '#525252',
          input.avatarInitials ?? '?',
          now,
        ],
      );
      return teamFromRow(rows[0]!);
    },

    async getTeam(id) {
      const { rows } = await client.query<TeamRow>(
        'SELECT * FROM teams WHERE id = $1',
        [id],
      );
      return rows[0] ? teamFromRow(rows[0]) : null;
    },

    async findTeamByNormalizedName(nameNormalized) {
      const { rows } = await client.query<TeamRow>(
        'SELECT * FROM teams WHERE name_normalized = $1',
        [nameNormalized],
      );
      return rows[0] ? teamFromRow(rows[0]) : null;
    },

    async updateTeam(id, patch: UpdateTeamInput) {
      const sets: string[] = [];
      const params: unknown[] = [];
      let n = 1;
      const push = (col: string, v: unknown): void => {
        sets.push(`${col} = $${n++}`);
        params.push(v);
      };
      if (patch.name !== undefined) push('name', patch.name);
      if (patch.nameNormalized !== undefined) push('name_normalized', patch.nameNormalized);
      if (patch.adminId !== undefined) push('admin_id', patch.adminId);
      if (patch.avatarColor !== undefined) push('avatar_color', patch.avatarColor);
      if (patch.avatarInitials !== undefined) push('avatar_initials', patch.avatarInitials);
      if (patch.avatarUrl !== undefined) push('avatar_url', patch.avatarUrl);

      if (sets.length === 0) {
        const { rows } = await client.query<TeamRow>(
          'SELECT * FROM teams WHERE id = $1',
          [id],
        );
        if (!rows[0]) throw new Error(`Team ${id} not found`);
        return teamFromRow(rows[0]);
      }
      params.push(id);
      const { rows } = await client.query<TeamRow>(
        `UPDATE teams SET ${sets.join(', ')} WHERE id = $${n} RETURNING *`,
        params,
      );
      if (!rows[0]) throw new Error(`Team ${id} not found`);
      return teamFromRow(rows[0]);
    },

    async deleteTeam(id) {
      await client.query('DELETE FROM teams WHERE id = $1', [id]);
    },

    async listTeamsForUser(userId) {
      const { rows } = await client.query<TeamRow & { mr: string }>(
        `SELECT t.*, tm.role AS mr
           FROM teams t
           JOIN team_members tm ON tm.team_id = t.id
          WHERE tm.user_id = $1
          ORDER BY t.created_at ASC`,
        [userId],
      );
      return rows.map((r) => ({
        team: teamFromRow(r),
        role: r.mr as TeamMember['role'],
      }));
    },

    // ---- team members ----
    async addTeamMember(teamId, userId, role, now) {
      await client.query(
        `INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4)`,
        [teamId, userId, role, now],
      );
      return { teamId, userId, role, joinedAt: now };
    },

    async getTeamMember(teamId, userId) {
      const { rows } = await client.query<TeamMemberRow>(
        'SELECT * FROM team_members WHERE team_id = $1 AND user_id = $2',
        [teamId, userId],
      );
      return rows[0] ? memberFromRow(rows[0]) : null;
    },

    async listTeamMembers(teamId) {
      interface JoinedRow {
        team_id: string;
        user_id: string;
        role: string;
        joined_at: string | number;
        u_id: string;
        email: string;
        display_name: string | null;
        u_role: string;
        status: string;
        u_avatar_color: string;
        u_avatar_initials: string;
        u_avatar_url: string | null;
        u_created_at: string | number;
        last_seen_at: string | number | null;
      }
      const { rows } = await client.query<JoinedRow>(
        `SELECT tm.team_id, tm.user_id, tm.role, tm.joined_at,
                u.id AS u_id, u.email, u.display_name, u.role AS u_role,
                u.status,
                u.avatar_color    AS u_avatar_color,
                u.avatar_initials AS u_avatar_initials,
                u.avatar_url      AS u_avatar_url,
                u.created_at      AS u_created_at, u.last_seen_at
           FROM team_members tm
           JOIN users u ON u.id = tm.user_id
          WHERE tm.team_id = $1
          ORDER BY tm.joined_at ASC`,
        [teamId],
      );
      return rows.map((r) => ({
        member: {
          teamId: r.team_id,
          userId: r.user_id,
          role: r.role as TeamMember['role'],
          joinedAt: num(r.joined_at),
        },
        user: {
          id: r.u_id,
          email: r.email,
          displayName: r.display_name,
          role: r.u_role as User['role'],
          status: r.status as User['status'],
          avatarColor: r.u_avatar_color,
          avatarInitials: r.u_avatar_initials,
          avatarUrl: r.u_avatar_url,
          createdAt: num(r.u_created_at),
          lastSeenAt: numOrNull(r.last_seen_at),
        },
      }));
    },

    async updateTeamMemberRole(teamId, userId, role) {
      const { rows } = await client.query<TeamMemberRow>(
        `UPDATE team_members SET role = $1 WHERE team_id = $2 AND user_id = $3 RETURNING *`,
        [role, teamId, userId],
      );
      if (!rows[0]) throw new Error('Member not found');
      return memberFromRow(rows[0]);
    },

    async removeTeamMember(teamId, userId) {
      await client.query(
        'DELETE FROM team_members WHERE team_id = $1 AND user_id = $2',
        [teamId, userId],
      );
    },

    // ---- team invites ----
    async createTeamInvite(input: CreateTeamInviteInput, now: number) {
      await client.query(
        `INSERT INTO team_invites (token_hash, team_id, inviter_id, email, role, created_at, expires_at, consumed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)`,
        [
          input.tokenHash,
          input.teamId,
          input.inviterId,
          input.email,
          input.role,
          now,
          input.expiresAt,
        ],
      );
    },

    async findTeamInviteByHash(tokenHash) {
      const { rows } = await client.query<TeamInviteRow>(
        'SELECT * FROM team_invites WHERE token_hash = $1',
        [tokenHash],
      );
      return rows[0] ? inviteFromRow(rows[0]) : null;
    },

    async consumeTeamInvite(tokenHash, now) {
      await client.query(
        'UPDATE team_invites SET consumed_at = $1 WHERE token_hash = $2',
        [now, tokenHash],
      );
    },

    async deleteTeamInvite(tokenHash) {
      await client.query('DELETE FROM team_invites WHERE token_hash = $1', [tokenHash]);
    },

    async listPendingInvitesForTeam(teamId, now) {
      const { rows } = await client.query<TeamInviteRow>(
        `SELECT * FROM team_invites
          WHERE team_id = $1
            AND consumed_at IS NULL
            AND expires_at >= $2
          ORDER BY created_at DESC`,
        [teamId, now],
      );
      return rows.map(inviteFromRow);
    },

    async listTeamInvites(teamId) {
      const { rows } = await client.query<TeamInviteRow>(
        'SELECT * FROM team_invites WHERE team_id = $1 ORDER BY created_at DESC',
        [teamId],
      );
      return rows.map(inviteFromRow);
    },

    async findPendingInvitesForEmail(email, now) {
      const { rows } = await client.query<TeamInviteRow>(
        `SELECT * FROM team_invites
          WHERE email = $1
            AND consumed_at IS NULL
            AND expires_at >= $2
          ORDER BY created_at ASC`,
        [email, now],
      );
      return rows.map(inviteFromRow);
    },

    // ---- audit ----
    async createAuditEntry(input: CreateAuditEntryInput, now: number) {
      const { rows } = await client.query<AuditRow>(
        `INSERT INTO audit_log (actor_id, action, target_id, metadata_json, created_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [
          input.actorId,
          input.action,
          input.targetId ?? null,
          input.metadata ? JSON.stringify(input.metadata) : null,
          now,
        ],
      );
      return auditFromRow(rows[0]!);
    },

    async listAuditEntries(filter: ListAuditFilter): Promise<AuditEntry[]> {
      const where: string[] = [];
      const params: unknown[] = [];
      let n = 1;
      if (filter.action) {
        where.push(`action = $${n++}`);
        params.push(filter.action);
      }
      if (filter.actorId) {
        where.push(`actor_id = $${n++}`);
        params.push(filter.actorId);
      }
      if (filter.targetId) {
        where.push(`target_id = $${n++}`);
        params.push(filter.targetId);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const limit = filter.limit ?? 100;

      const { rows } = await client.query<AuditRow>(
        `SELECT * FROM audit_log ${whereSql} ORDER BY created_at DESC, id DESC LIMIT $${n}`,
        [...params, limit],
      );
      return rows.map(auditFromRow);
    },
  };
}
