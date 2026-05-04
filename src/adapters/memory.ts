// In-memory repository implementation. Used for unit tests and as a reference
// implementation. Not suitable for production — no persistence, no concurrency
// guarantees, no indexes beyond Map lookups.

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
import { uuidv7 } from 'uuidv7';

export function createMemoryRepository(): Repository {
  const users = new Map<string, User>();
  const usersByEmail = new Map<string, string>();
  const magicLinks = new Map<string, MagicLink>();
  const sessions = new Map<string, Session>();
  const teams = new Map<string, Team>();
  const teamsByNormalizedName = new Map<string, string>();
  const members = new Map<string, TeamMember>(); // key: `${teamId}::${userId}`
  const invites = new Map<string, TeamInvite>();
  const audit: AuditEntry[] = [];
  let auditId = 0;

  const memberKey = (teamId: string, userId: string) => `${teamId}::${userId}`;

  return {
    // ---- users ----
    async createUser(input: CreateUserInput, now: number): Promise<User> {
      const user: User = {
        id: uuidv7(),
        email: input.email,
        displayName: input.displayName ?? null,
        role: input.role ?? 'user',
        status: 'active',
        avatarColor: input.avatarColor ?? '#525252',
        avatarInitials: input.avatarInitials ?? '?',
        avatarUrl: null,
        createdAt: now,
        lastSeenAt: null,
      };
      users.set(user.id, user);
      usersByEmail.set(user.email, user.id);
      return { ...user };
    },

    async getUser(id: string): Promise<User | null> {
      const u = users.get(id);
      return u ? { ...u } : null;
    },

    async findUserByEmail(email: string): Promise<User | null> {
      const id = usersByEmail.get(email);
      return id ? { ...users.get(id)! } : null;
    },

    async updateUser(id: string, patch: UpdateUserInput): Promise<User> {
      const existing = users.get(id);
      if (!existing) throw new Error(`User ${id} not found`);
      if (patch.email && patch.email !== existing.email) {
        usersByEmail.delete(existing.email);
        usersByEmail.set(patch.email, id);
      }
      const updated: User = {
        ...existing,
        ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
        ...(patch.role !== undefined ? { role: patch.role } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.lastSeenAt !== undefined ? { lastSeenAt: patch.lastSeenAt } : {}),
        ...(patch.email !== undefined ? { email: patch.email } : {}),
        ...(patch.avatarColor !== undefined ? { avatarColor: patch.avatarColor } : {}),
        ...(patch.avatarInitials !== undefined ? { avatarInitials: patch.avatarInitials } : {}),
        ...(patch.avatarUrl !== undefined ? { avatarUrl: patch.avatarUrl } : {}),
      };
      users.set(id, updated);
      return { ...updated };
    },

    async deleteUser(id: string): Promise<void> {
      const u = users.get(id);
      if (!u) return;
      users.delete(id);
      usersByEmail.delete(u.email);
      // Cascade sessions
      for (const [hash, s] of sessions) {
        if (s.userId === id) sessions.delete(hash);
      }
      // Cascade team memberships
      for (const [key, m] of members) {
        if (m.userId === id) members.delete(key);
      }
    },

    async listUsers(filter: ListUsersFilter): Promise<ListUsersResult> {
      let list = Array.from(users.values());
      if (filter.search) {
        const q = filter.search.toLowerCase();
        list = list.filter(
          (u) =>
            u.email.toLowerCase().includes(q) ||
            (u.displayName ?? '').toLowerCase().includes(q),
        );
      }
      list.sort((a, b) => a.createdAt - b.createdAt);
      const total = list.length;
      const page = Math.max(filter.page ?? 1, 1);
      const pageSize = filter.pageSize ?? total;
      const start = (page - 1) * pageSize;
      return {
        users: list.slice(start, start + pageSize).map((u) => ({ ...u })),
        total,
      };
    },

    // ---- magic links ----
    async createMagicLink(input: CreateMagicLinkInput, now: number): Promise<void> {
      magicLinks.set(input.tokenHash, {
        tokenHash: input.tokenHash,
        email: input.email,
        createdAt: now,
        expiresAt: input.expiresAt,
        consumedAt: null,
      });
    },

    async findMagicLinkByHash(tokenHash: string): Promise<MagicLink | null> {
      const link = magicLinks.get(tokenHash);
      return link ? { ...link } : null;
    },

    async consumeMagicLink(tokenHash: string, now: number): Promise<void> {
      const link = magicLinks.get(tokenHash);
      if (!link) return;
      magicLinks.set(tokenHash, { ...link, consumedAt: now });
    },

    async countMagicLinksForEmailSince(email: string, since: number): Promise<number> {
      let n = 0;
      for (const link of magicLinks.values()) {
        if (link.email === email && link.createdAt >= since) n++;
      }
      return n;
    },

    // ---- sessions ----
    async createSession(input: CreateSessionInput, now: number): Promise<Session> {
      const session: Session = {
        tokenHash: input.tokenHash,
        userId: input.userId,
        createdAt: now,
        expiresAt: input.expiresAt,
        lastUsedAt: now,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      };
      sessions.set(session.tokenHash, session);
      return { ...session };
    },

    async findSessionByHash(tokenHash: string): Promise<Session | null> {
      const s = sessions.get(tokenHash);
      return s ? { ...s } : null;
    },

    async bumpSession(tokenHash: string, lastUsedAt: number, expiresAt: number): Promise<void> {
      const s = sessions.get(tokenHash);
      if (!s) return;
      sessions.set(tokenHash, { ...s, lastUsedAt, expiresAt });
    },

    async deleteSession(tokenHash: string): Promise<void> {
      sessions.delete(tokenHash);
    },

    async deleteSessionsForUser(userId: string): Promise<number> {
      let n = 0;
      for (const [hash, s] of sessions) {
        if (s.userId === userId) {
          sessions.delete(hash);
          n++;
        }
      }
      return n;
    },

    // ---- teams ----
    async createTeam(input: CreateTeamInput, now: number): Promise<Team> {
      const nameNormalized = input.nameNormalized ?? input.name.trim().toLowerCase();
      if (teamsByNormalizedName.has(nameNormalized)) {
        throw new Error(`Team name ${nameNormalized} taken`);
      }
      const team: Team = {
        id: input.id,
        name: input.name,
        nameNormalized,
        adminId: input.adminId,
        avatarColor: input.avatarColor ?? '#525252',
        avatarInitials: input.avatarInitials ?? '?',
        avatarUrl: null,
        createdAt: now,
      };
      teams.set(team.id, team);
      teamsByNormalizedName.set(team.nameNormalized, team.id);
      return { ...team };
    },

    async getTeam(id: string): Promise<Team | null> {
      const t = teams.get(id);
      return t ? { ...t } : null;
    },

    async findTeamByNormalizedName(nameNormalized: string): Promise<Team | null> {
      const id = teamsByNormalizedName.get(nameNormalized);
      return id ? { ...teams.get(id)! } : null;
    },

    async updateTeam(id: string, patch: UpdateTeamInput): Promise<Team> {
      const t = teams.get(id);
      if (!t) throw new Error(`Team ${id} not found`);
      if (patch.nameNormalized && patch.nameNormalized !== t.nameNormalized) {
        if (teamsByNormalizedName.has(patch.nameNormalized)) {
          throw new Error(`Team name ${patch.nameNormalized} taken`);
        }
        teamsByNormalizedName.delete(t.nameNormalized);
        teamsByNormalizedName.set(patch.nameNormalized, id);
      }
      const updated: Team = {
        ...t,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.nameNormalized !== undefined ? { nameNormalized: patch.nameNormalized } : {}),
        ...(patch.adminId !== undefined ? { adminId: patch.adminId } : {}),
        ...(patch.avatarColor !== undefined ? { avatarColor: patch.avatarColor } : {}),
        ...(patch.avatarInitials !== undefined ? { avatarInitials: patch.avatarInitials } : {}),
        ...(patch.avatarUrl !== undefined ? { avatarUrl: patch.avatarUrl } : {}),
      };
      teams.set(id, updated);
      return { ...updated };
    },

    async deleteTeam(id: string): Promise<void> {
      const t = teams.get(id);
      if (!t) return;
      teams.delete(id);
      teamsByNormalizedName.delete(t.nameNormalized);
      for (const [key, m] of members) {
        if (m.teamId === id) members.delete(key);
      }
      for (const [hash, inv] of invites) {
        if (inv.teamId === id) invites.delete(hash);
      }
    },

    async listTeamsForUser(userId) {
      const result: Array<{ team: Team; role: TeamMember['role'] }> = [];
      for (const m of members.values()) {
        if (m.userId === userId) {
          const team = teams.get(m.teamId);
          if (team) result.push({ team: { ...team }, role: m.role });
        }
      }
      return result;
    },

    // ---- team members ----
    async addTeamMember(teamId, userId, role, now): Promise<TeamMember> {
      const tm: TeamMember = { teamId, userId, role, joinedAt: now };
      members.set(memberKey(teamId, userId), tm);
      return { ...tm };
    },

    async getTeamMember(teamId, userId): Promise<TeamMember | null> {
      const tm = members.get(memberKey(teamId, userId));
      return tm ? { ...tm } : null;
    },

    async listTeamMembers(teamId) {
      const list: Array<{ member: TeamMember; user: User }> = [];
      for (const m of members.values()) {
        if (m.teamId === teamId) {
          const user = users.get(m.userId);
          if (user) list.push({ member: { ...m }, user: { ...user } });
        }
      }
      return list;
    },

    async updateTeamMemberRole(teamId, userId, role): Promise<TeamMember> {
      const key = memberKey(teamId, userId);
      const tm = members.get(key);
      if (!tm) throw new Error(`Member not found`);
      const updated = { ...tm, role };
      members.set(key, updated);
      return { ...updated };
    },

    async removeTeamMember(teamId, userId): Promise<void> {
      members.delete(memberKey(teamId, userId));
    },

    // ---- team invites ----
    async createTeamInvite(input: CreateTeamInviteInput, now: number): Promise<void> {
      invites.set(input.tokenHash, {
        tokenHash: input.tokenHash,
        teamId: input.teamId,
        inviterId: input.inviterId,
        email: input.email,
        role: input.role,
        createdAt: now,
        expiresAt: input.expiresAt,
        consumedAt: null,
      });
    },

    async findTeamInviteByHash(tokenHash): Promise<TeamInvite | null> {
      const inv = invites.get(tokenHash);
      return inv ? { ...inv } : null;
    },

    async consumeTeamInvite(tokenHash, now): Promise<void> {
      const inv = invites.get(tokenHash);
      if (!inv) return;
      invites.set(tokenHash, { ...inv, consumedAt: now });
    },

    async deleteTeamInvite(tokenHash): Promise<void> {
      invites.delete(tokenHash);
    },

    async listPendingInvitesForTeam(teamId, now): Promise<TeamInvite[]> {
      return Array.from(invites.values())
        .filter(
          (i) => i.teamId === teamId && i.consumedAt === null && i.expiresAt >= now,
        )
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((i) => ({ ...i }));
    },

    async listTeamInvites(teamId): Promise<TeamInvite[]> {
      return Array.from(invites.values())
        .filter((i) => i.teamId === teamId)
        .map((i) => ({ ...i }));
    },

    async findPendingInvitesForEmail(email, now): Promise<TeamInvite[]> {
      return Array.from(invites.values())
        .filter((i) => i.email === email && i.consumedAt === null && i.expiresAt >= now)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((i) => ({ ...i }));
    },

    // ---- audit ----
    async createAuditEntry(input: CreateAuditEntryInput, now: number): Promise<AuditEntry> {
      const entry: AuditEntry = {
        id: ++auditId,
        actorId: input.actorId,
        action: input.action,
        targetId: input.targetId ?? null,
        metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
        createdAt: now,
      };
      audit.push(entry);
      return { ...entry };
    },

    async listAuditEntries(filter: ListAuditFilter): Promise<AuditEntry[]> {
      let list = audit.slice();
      if (filter.action) list = list.filter((e) => e.action === filter.action);
      if (filter.actorId) list = list.filter((e) => e.actorId === filter.actorId);
      if (filter.targetId) list = list.filter((e) => e.targetId === filter.targetId);
      list.sort((a, b) => b.createdAt - a.createdAt);
      if (filter.limit !== undefined) list = list.slice(0, filter.limit);
      return list.map((e) => ({ ...e }));
    },
  };
}
