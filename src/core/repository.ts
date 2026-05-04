// Storage interface. Pure data layer — no business logic, no validation, no
// hashing. Operations modules sit on top and add behavior; adapters sit
// underneath and translate to a backing store (SQLite, in-memory, future PG).

import type {
  AuditEntry,
  MagicLink,
  MemberRole,
  Role,
  Session,
  Team,
  TeamInvite,
  TeamMember,
  User,
  UserStatus,
} from './types.js';

export interface ListUsersFilter {
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ListUsersResult {
  users: User[];
  total: number;
}

export interface CreateUserInput {
  email: string;          // already normalized lowercase
  role?: Role;            // default 'user'
  displayName?: string | null;
  /** Optional — adapters fall back to a placeholder. Operations layer should
   *  provide deterministic values (deriveInitials/pickColor); tests can omit. */
  avatarColor?: string;
  avatarInitials?: string;
}

export interface UpdateUserInput {
  displayName?: string | null;
  role?: Role;
  status?: UserStatus;
  lastSeenAt?: number | null;
  email?: string;
  avatarColor?: string;
  avatarInitials?: string;
}

export interface CreateMagicLinkInput {
  tokenHash: string;
  email: string;
  expiresAt: number;      // epoch ms
}

export interface CreateSessionInput {
  tokenHash: string;
  userId: string;
  expiresAt: number;
  ip?: string | null;
  userAgent?: string | null;
}

export interface CreateTeamInput {
  id: string;
  name: string;
  /** Defaults to lower(trim(name)). Operations should pass an explicit value. */
  nameNormalized?: string;
  adminId: string;
  avatarColor?: string;
  avatarInitials?: string;
}

export interface UpdateTeamInput {
  name?: string;
  nameNormalized?: string;
  adminId?: string;       // for admin transfer
  avatarColor?: string;
  avatarInitials?: string;
}

export interface CreateTeamInviteInput {
  tokenHash: string;
  teamId: string;
  inviterId: string;
  email: string;
  role: MemberRole;
  expiresAt: number;
}

export interface CreateAuditEntryInput {
  actorId: string | null;
  action: string;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ListAuditFilter {
  action?: string;
  actorId?: string;
  targetId?: string;
  limit?: number;
}

export interface Repository {
  // ---- users ----
  createUser(input: CreateUserInput, now: number): Promise<User>;
  getUser(id: string): Promise<User | null>;
  findUserByEmail(email: string): Promise<User | null>;
  updateUser(id: string, patch: UpdateUserInput): Promise<User>;
  deleteUser(id: string): Promise<void>;
  listUsers(filter: ListUsersFilter): Promise<ListUsersResult>;

  // ---- magic links ----
  createMagicLink(input: CreateMagicLinkInput, now: number): Promise<void>;
  findMagicLinkByHash(tokenHash: string): Promise<MagicLink | null>;
  consumeMagicLink(tokenHash: string, now: number): Promise<void>;
  countMagicLinksForEmailSince(email: string, since: number): Promise<number>;

  // ---- sessions ----
  createSession(input: CreateSessionInput, now: number): Promise<Session>;
  findSessionByHash(tokenHash: string): Promise<Session | null>;
  bumpSession(tokenHash: string, lastUsedAt: number, expiresAt: number): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteSessionsForUser(userId: string): Promise<number>;

  // ---- teams ----
  createTeam(input: CreateTeamInput, now: number): Promise<Team>;
  getTeam(id: string): Promise<Team | null>;
  findTeamByNormalizedName(nameNormalized: string): Promise<Team | null>;
  updateTeam(id: string, patch: UpdateTeamInput): Promise<Team>;
  deleteTeam(id: string): Promise<void>;
  listTeamsForUser(userId: string): Promise<Array<{ team: Team; role: MemberRole }>>;

  // ---- team members ----
  addTeamMember(teamId: string, userId: string, role: MemberRole, now: number): Promise<TeamMember>;
  getTeamMember(teamId: string, userId: string): Promise<TeamMember | null>;
  listTeamMembers(teamId: string): Promise<Array<{ member: TeamMember; user: User }>>;
  updateTeamMemberRole(teamId: string, userId: string, role: MemberRole): Promise<TeamMember>;
  removeTeamMember(teamId: string, userId: string): Promise<void>;

  // ---- team invites ----
  createTeamInvite(input: CreateTeamInviteInput, now: number): Promise<void>;
  findTeamInviteByHash(tokenHash: string): Promise<TeamInvite | null>;
  consumeTeamInvite(tokenHash: string, now: number): Promise<void>;
  listTeamInvites(teamId: string): Promise<TeamInvite[]>;
  /** All un-consumed, un-expired invites for a given email (for auto-add at signup). */
  findPendingInvitesForEmail(email: string, now: number): Promise<TeamInvite[]>;

  // ---- audit ----
  createAuditEntry(input: CreateAuditEntryInput, now: number): Promise<AuditEntry>;
  listAuditEntries(filter: ListAuditFilter): Promise<AuditEntry[]>;
}
