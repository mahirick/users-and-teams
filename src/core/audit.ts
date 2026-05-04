// Audit-write helper. Operations modules call this to record significant
// state changes. Strings live in AUDIT_ACTIONS so we can grep + maintain a
// stable taxonomy.

import type { AuditEntry } from './types.js';
import type { Repository } from './repository.js';

export const AUDIT_ACTIONS = {
  USER_CREATE: 'user.create',
  USER_SUSPEND: 'user.suspend',
  USER_UNSUSPEND: 'user.unsuspend',
  USER_DELETE: 'user.delete',
  USER_ROLE_CHANGE: 'user.role.change',
  USER_DISPLAY_NAME_CHANGE: 'user.display_name.change',

  TEAM_CREATE: 'team.create',
  TEAM_DELETE: 'team.delete',
  TEAM_INVITE_SEND: 'team.invite.send',
  TEAM_INVITE_ACCEPT: 'team.invite.accept',
  TEAM_MEMBER_ADD: 'team.member.add',
  TEAM_MEMBER_REMOVE: 'team.member.remove',
  TEAM_MEMBER_ROLE_CHANGE: 'team.member.role.change',
  TEAM_TRANSFER: 'team.transfer',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface RecordAuditInput {
  actorId: string | null;
  action: AuditAction | string;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  now?: number;
}

export async function recordAudit(
  repo: Repository,
  input: RecordAuditInput,
): Promise<AuditEntry> {
  const entry: Parameters<Repository['createAuditEntry']>[0] = {
    actorId: input.actorId,
    action: input.action,
    targetId: input.targetId ?? null,
    metadata: input.metadata ?? null,
  };
  return repo.createAuditEntry(entry, input.now ?? Date.now());
}
