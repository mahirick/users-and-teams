import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepository } from '../adapters/memory.js';
import { recordAudit, AUDIT_ACTIONS } from './audit.js';

describe('recordAudit', () => {
  let repo: ReturnType<typeof createMemoryRepository>;
  beforeEach(() => {
    repo = createMemoryRepository();
  });

  it('writes the entry with the given fields', async () => {
    const entry = await recordAudit(repo, {
      actorId: 'admin-1',
      action: AUDIT_ACTIONS.USER_SUSPEND,
      targetId: 'user-2',
      metadata: { reason: 'spam' },
      now: 1_000_000,
    });
    expect(entry.action).toBe('user.suspend');
    expect(entry.targetId).toBe('user-2');
    expect(JSON.parse(entry.metadataJson!)).toEqual({ reason: 'spam' });
  });

  it('null actorId is allowed (system actions)', async () => {
    const entry = await recordAudit(repo, {
      actorId: null,
      action: AUDIT_ACTIONS.USER_CREATE,
      targetId: 'user-1',
      now: 0,
    });
    expect(entry.actorId).toBeNull();
  });

  it('AUDIT_ACTIONS string constants are stable', () => {
    expect(AUDIT_ACTIONS.USER_CREATE).toBe('user.create');
    expect(AUDIT_ACTIONS.TEAM_INVITE_SEND).toBe('team.invite.send');
  });
});
