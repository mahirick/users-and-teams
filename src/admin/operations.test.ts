import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepository } from '../adapters/memory.js';
import { NotAuthorizedError, UserNotFoundError } from '../core/errors.js';
import {
  deleteUser,
  getUserDetail,
  listAuditLog,
  listUsers,
  suspendUser,
  unsuspendUser,
  updateUser,
} from './operations.js';

const T0 = 1_700_000_000_000;

describe('admin operations', () => {
  let repo: ReturnType<typeof createMemoryRepository>;
  beforeEach(() => {
    repo = createMemoryRepository();
  });

  async function seedAdmin() {
    return repo.createUser({ email: 'admin@example.com', role: 'admin' }, T0);
  }
  async function seedUser(email: string) {
    return repo.createUser({ email }, T0);
  }

  describe('listUsers', () => {
    it('returns paginated users with total', async () => {
      const admin = await seedAdmin();
      await seedUser('a@example.com');
      await seedUser('b@example.com');

      const result = await listUsers({
        repo,
        actor: admin,
        page: 1,
        pageSize: 10,
      });
      expect(result.total).toBe(3);
      expect(result.users).toHaveLength(3);
    });

    it('rejects non-admins', async () => {
      const u = await seedUser('a@example.com');
      await expect(
        listUsers({ repo, actor: u, page: 1, pageSize: 10 }),
      ).rejects.toBeInstanceOf(NotAuthorizedError);
    });
  });

  describe('getUserDetail', () => {
    it('returns user + teams + recent audit', async () => {
      const admin = await seedAdmin();
      const target = await seedUser('t@example.com');

      // Make them an owner of a team for the teams field
      const team = await repo.createTeam(
        { id: 'tm1', name: 'T', slug: 't', ownerId: target.id },
        T0,
      );
      await repo.addTeamMember(team.id, target.id, 'owner', T0);
      await repo.createAuditEntry(
        { actorId: admin.id, action: 'user.create', targetId: target.id },
        T0,
      );

      const detail = await getUserDetail({ repo, actor: admin, userId: target.id });
      expect(detail.user.id).toBe(target.id);
      expect(detail.teams).toHaveLength(1);
      expect(detail.audit.length).toBeGreaterThan(0);
    });

    it('throws if target user does not exist', async () => {
      const admin = await seedAdmin();
      await expect(
        getUserDetail({ repo, actor: admin, userId: 'never' }),
      ).rejects.toBeInstanceOf(UserNotFoundError);
    });
  });

  describe('updateUser', () => {
    it('records an audit entry on display name change', async () => {
      const admin = await seedAdmin();
      const target = await seedUser('t@example.com');

      const updated = await updateUser({
        repo,
        actor: admin,
        userId: target.id,
        displayName: 'New Name',
      });
      expect(updated.displayName).toBe('New Name');

      const audit = await repo.listAuditEntries({ targetId: target.id });
      expect(audit.some((e) => e.action === 'user.display_name.change')).toBe(true);
    });

    it('records role change audit', async () => {
      const admin = await seedAdmin();
      const target = await seedUser('t@example.com');

      await updateUser({
        repo,
        actor: admin,
        userId: target.id,
        role: 'admin',
      });
      const audit = await repo.listAuditEntries({ targetId: target.id });
      expect(audit.some((e) => e.action === 'user.role.change')).toBe(true);
    });
  });

  describe('suspendUser', () => {
    it('suspends + revokes sessions + audits', async () => {
      const admin = await seedAdmin();
      const target = await seedUser('t@example.com');
      await repo.createSession(
        { tokenHash: 's1', userId: target.id, expiresAt: T0 + 1_000_000 },
        T0,
      );

      await suspendUser({ repo, actor: admin, userId: target.id });

      const updated = await repo.getUser(target.id);
      expect(updated?.status).toBe('suspended');
      expect(await repo.findSessionByHash('s1')).toBeNull();
      const audit = await repo.listAuditEntries({ targetId: target.id });
      expect(audit.some((e) => e.action === 'user.suspend')).toBe(true);
    });

    it('non-admin cannot suspend', async () => {
      const u = await seedUser('u@example.com');
      const target = await seedUser('t@example.com');
      await expect(
        suspendUser({ repo, actor: u, userId: target.id }),
      ).rejects.toBeInstanceOf(NotAuthorizedError);
    });
  });

  describe('unsuspendUser', () => {
    it('flips status back to active and audits', async () => {
      const admin = await seedAdmin();
      const target = await seedUser('t@example.com');
      await repo.updateUser(target.id, { status: 'suspended' });

      await unsuspendUser({ repo, actor: admin, userId: target.id });
      expect((await repo.getUser(target.id))!.status).toBe('active');
    });
  });

  describe('deleteUser', () => {
    it('hard deletes + audits', async () => {
      const admin = await seedAdmin();
      const target = await seedUser('t@example.com');
      await deleteUser({ repo, actor: admin, userId: target.id });

      expect(await repo.getUser(target.id)).toBeNull();
      const audit = await repo.listAuditEntries({ targetId: target.id });
      expect(audit.some((e) => e.action === 'user.delete')).toBe(true);
    });

    it('admin cannot delete themselves', async () => {
      const admin = await seedAdmin();
      await expect(
        deleteUser({ repo, actor: admin, userId: admin.id }),
      ).rejects.toBeInstanceOf(NotAuthorizedError);
    });
  });

  describe('listAuditLog', () => {
    it('returns recent audit entries', async () => {
      const admin = await seedAdmin();
      await repo.createAuditEntry({ actorId: null, action: 'user.create' }, T0);
      await repo.createAuditEntry({ actorId: null, action: 'team.create' }, T0 + 1);

      const list = await listAuditLog({ repo, actor: admin, limit: 10 });
      expect(list.length).toBeGreaterThanOrEqual(2);
    });

    it('non-admin cannot read audit', async () => {
      const u = await seedUser('u@example.com');
      await expect(
        listAuditLog({ repo, actor: u, limit: 10 }),
      ).rejects.toBeInstanceOf(NotAuthorizedError);
    });
  });
});
