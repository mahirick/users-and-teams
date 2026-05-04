// Admin operations: list / read / update / suspend / delete users + audit log.
// All operations check that `actor.role === 'admin'` (system role) before
// performing any state change.

import { AUDIT_ACTIONS, recordAudit } from '../core/audit.js';
import { NotAuthorizedError, UserNotFoundError } from '../core/errors.js';
import type { Repository, ListUsersResult } from '../core/repository.js';
import type { AuditEntry, Role, User, UserStatus } from '../core/types.js';

function requireAdmin(actor: User): void {
  if (actor.role !== 'admin') {
    throw new NotAuthorizedError('Admin role required');
  }
}

export interface ListUsersInput {
  repo: Repository;
  actor: User;
  search?: string;
  page?: number;
  pageSize?: number;
}

export async function listUsers(input: ListUsersInput): Promise<ListUsersResult> {
  requireAdmin(input.actor);
  const filter: Parameters<Repository['listUsers']>[0] = {};
  if (input.search !== undefined) filter.search = input.search;
  if (input.page !== undefined) filter.page = input.page;
  if (input.pageSize !== undefined) filter.pageSize = input.pageSize;
  return input.repo.listUsers(filter);
}

export interface GetUserDetailInput {
  repo: Repository;
  actor: User;
  userId: string;
}

export interface UserDetail {
  user: User;
  teams: Array<{
    team: import('../core/types.js').Team;
    role: import('../core/types.js').MemberRole;
  }>;
  audit: AuditEntry[];
}

export async function getUserDetail(input: GetUserDetailInput): Promise<UserDetail> {
  requireAdmin(input.actor);
  const user = await input.repo.getUser(input.userId);
  if (!user) throw new UserNotFoundError();
  const teams = await input.repo.listTeamsForUser(user.id);
  const audit = await input.repo.listAuditEntries({ targetId: user.id, limit: 50 });
  return { user, teams, audit };
}

export interface UpdateUserInput {
  repo: Repository;
  actor: User;
  userId: string;
  displayName?: string | null;
  role?: Role;
  status?: UserStatus;
  email?: string;
}

export async function updateUser(input: UpdateUserInput): Promise<User> {
  requireAdmin(input.actor);
  const target = await input.repo.getUser(input.userId);
  if (!target) throw new UserNotFoundError();

  const patch: Parameters<Repository['updateUser']>[1] = {};
  const auditDeltas: Array<{ action: string; metadata: Record<string, unknown> }> = [];

  if (input.displayName !== undefined && input.displayName !== target.displayName) {
    patch.displayName = input.displayName;
    auditDeltas.push({
      action: AUDIT_ACTIONS.USER_DISPLAY_NAME_CHANGE,
      metadata: { from: target.displayName, to: input.displayName },
    });
  }
  if (input.role !== undefined && input.role !== target.role) {
    patch.role = input.role;
    auditDeltas.push({
      action: AUDIT_ACTIONS.USER_ROLE_CHANGE,
      metadata: { from: target.role, to: input.role },
    });
  }
  if (input.status !== undefined && input.status !== target.status) {
    patch.status = input.status;
  }
  if (input.email !== undefined && input.email !== target.email) {
    patch.email = input.email.trim().toLowerCase();
  }

  const updated = await input.repo.updateUser(input.userId, patch);
  for (const d of auditDeltas) {
    await recordAudit(input.repo, {
      actorId: input.actor.id,
      action: d.action,
      targetId: input.userId,
      metadata: d.metadata,
    });
  }
  return updated;
}

export interface SuspendUserInput {
  repo: Repository;
  actor: User;
  userId: string;
}

export async function suspendUser(input: SuspendUserInput): Promise<User> {
  requireAdmin(input.actor);
  const target = await input.repo.getUser(input.userId);
  if (!target) throw new UserNotFoundError();
  const updated = await input.repo.updateUser(input.userId, { status: 'suspended' });
  await input.repo.deleteSessionsForUser(input.userId);
  await recordAudit(input.repo, {
    actorId: input.actor.id,
    action: AUDIT_ACTIONS.USER_SUSPEND,
    targetId: input.userId,
  });
  return updated;
}

export async function unsuspendUser(input: SuspendUserInput): Promise<User> {
  requireAdmin(input.actor);
  const target = await input.repo.getUser(input.userId);
  if (!target) throw new UserNotFoundError();
  const updated = await input.repo.updateUser(input.userId, { status: 'active' });
  await recordAudit(input.repo, {
    actorId: input.actor.id,
    action: AUDIT_ACTIONS.USER_UNSUSPEND,
    targetId: input.userId,
  });
  return updated;
}

export interface DeleteUserInput {
  repo: Repository;
  actor: User;
  userId: string;
}

export async function deleteUser(input: DeleteUserInput): Promise<void> {
  requireAdmin(input.actor);
  if (input.userId === input.actor.id) {
    throw new NotAuthorizedError('Admins cannot delete their own account');
  }
  const target = await input.repo.getUser(input.userId);
  if (!target) throw new UserNotFoundError();

  await input.repo.deleteUser(input.userId);
  await recordAudit(input.repo, {
    actorId: input.actor.id,
    action: AUDIT_ACTIONS.USER_DELETE,
    targetId: input.userId,
    metadata: { email: target.email },
  });
}

export interface ListAuditLogInput {
  repo: Repository;
  actor: User;
  action?: string;
  actorId?: string;
  targetId?: string;
  limit?: number;
}

export async function listAuditLog(input: ListAuditLogInput): Promise<AuditEntry[]> {
  requireAdmin(input.actor);
  const filter: Parameters<Repository['listAuditEntries']>[0] = {};
  if (input.action !== undefined) filter.action = input.action;
  if (input.actorId !== undefined) filter.actorId = input.actorId;
  if (input.targetId !== undefined) filter.targetId = input.targetId;
  if (input.limit !== undefined) filter.limit = input.limit;
  return input.repo.listAuditEntries(filter);
}
