import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepository } from '../adapters/memory.js';
import { consoleTransport, type ConsoleTransport } from '../email/console.js';
import {
  AlreadyTeamMemberError,
  NotAuthorizedError,
  TeamNameTakenError,
  TeamNotFoundError,
} from '../core/errors.js';
import {
  addMember,
  consumePendingInvitesForUser,
  createTeam,
  deleteTeam,
  editTeam,
  listMembers,
  listMyTeams,
  removeMember,
  transferAdmin,
} from './operations.js';

const T0 = 1_700_000_000_000;

describe('teams operations', () => {
  let repo: ReturnType<typeof createMemoryRepository>;
  let transport: ConsoleTransport;

  beforeEach(() => {
    repo = createMemoryRepository();
    transport = consoleTransport({ captureOnly: true });
  });

  async function seedUser(email: string, role: 'user' | 'owner' = 'user') {
    return repo.createUser({ email, role }, T0);
  }

  describe('createTeam', () => {
    it('creates the team and adds the actor as Admin', async () => {
      const u = await seedUser('admin@example.com');
      const team = await createTeam({
        repo,
        actorId: u.id,
        name: 'My Team',
        now: T0,
      });

      expect(team.name).toBe('My Team');
      expect(team.adminId).toBe(u.id);
      expect(team.nameNormalized).toBe('my team');

      const member = await repo.getTeamMember(team.id, u.id);
      expect(member?.role).toBe('admin');
    });

    it('rejects a duplicate normalized name', async () => {
      const u = await seedUser('o@example.com');
      await createTeam({ repo, actorId: u.id, name: 'Taken', now: T0 });
      await expect(
        createTeam({ repo, actorId: u.id, name: '  TAKEN ', now: T0 + 1 }),
      ).rejects.toBeInstanceOf(TeamNameTakenError);
    });

    it('computes avatar fields', async () => {
      const u = await seedUser('o@example.com');
      const team = await createTeam({ repo, actorId: u.id, name: 'Acme Corp', now: T0 });
      expect(team.avatarColor).toMatch(/^#/);
      expect(team.avatarInitials).toBe('AC');
    });
  });

  describe('addMember', () => {
    async function setup() {
      const admin = await seedUser('admin@example.com');
      const team = await createTeam({
        repo,
        actorId: admin.id,
        name: 'Engineering',
        now: T0,
      });
      return { admin, team };
    }

    it('adds an existing user immediately and emails a notification', async () => {
      const { admin, team } = await setup();
      const target = await seedUser('member@example.com');

      const result = await addMember({
        repo,
        actorId: admin.id,
        teamId: team.id,
        email: 'member@example.com',
        transport,
        siteName: 'App',
        siteUrl: 'https://app.example.com',
        inviteTtlDays: 7,
        now: T0 + 1000,
      });

      expect(result.status).toBe('added');
      if (result.status === 'added') {
        expect(result.userId).toBe(target.id);
      }
      expect(transport.captured).toHaveLength(1);
      expect(transport.captured[0]!.to).toBe('member@example.com');
      const member = await repo.getTeamMember(team.id, target.id);
      expect(member?.role).toBe('user');
    });

    it('creates a pending invite + magic-link and emails the verify URL for unknown emails', async () => {
      const { admin, team } = await setup();

      const result = await addMember({
        repo,
        actorId: admin.id,
        teamId: team.id,
        email: 'newcomer@example.com',
        transport,
        siteName: 'App',
        siteUrl: 'https://app.example.com',
        inviteTtlDays: 7,
        now: T0 + 1000,
      });

      expect(result.status).toBe('pending_signup');
      expect(transport.captured[0]!.to).toBe('newcomer@example.com');

      // Email contains the /auth/verify URL — single click signs them in.
      const m = transport.captured[0]!.text.match(
        /\/auth\/verify\?token=([A-Za-z0-9_-]+)/,
      );
      expect(m).not.toBeNull();
      const token = m![1]!;

      // Both the team-invite and the magic-link rows are present, keyed by the
      // same token hash. /auth/verify will consume the magic-link; the
      // team-invite is consumed at signin via consumePendingInvitesForUser.
      const { hashToken } = await import('../auth/tokens.js');
      const tokenHash = hashToken(token);
      const teamInvite = await repo.findTeamInviteByHash(tokenHash);
      expect(teamInvite?.email).toBe('newcomer@example.com');
      const magicLink = await repo.findMagicLinkByHash(tokenHash);
      expect(magicLink?.email).toBe('newcomer@example.com');
    });

    it('rejects a duplicate add for an existing member', async () => {
      const { admin, team } = await setup();
      await seedUser('m@example.com');
      await addMember({
        repo,
        actorId: admin.id,
        teamId: team.id,
        email: 'm@example.com',
        transport,
        siteName: 'App',
        siteUrl: 'https://app.example.com',
        inviteTtlDays: 7,
        now: T0,
      });
      await expect(
        addMember({
          repo,
          actorId: admin.id,
          teamId: team.id,
          email: 'm@example.com',
          transport,
          siteName: 'App',
          siteUrl: 'https://app.example.com',
          inviteTtlDays: 7,
          now: T0 + 1,
        }),
      ).rejects.toBeInstanceOf(AlreadyTeamMemberError);
    });

    it('regular Users cannot add members', async () => {
      const { admin, team } = await setup();
      const u = await seedUser('u@example.com');
      await repo.addTeamMember(team.id, u.id, 'user', T0);

      await expect(
        addMember({
          repo,
          actorId: u.id,
          teamId: team.id,
          email: 'g@example.com',
          transport,
          siteName: 'App',
          siteUrl: 'https://app.example.com',
          inviteTtlDays: 7,
          now: T0,
        }),
      ).rejects.toBeInstanceOf(NotAuthorizedError);
      void admin;
    });
  });

  describe('consumePendingInvitesForUser', () => {
    it('materializes memberships from pending invites and consumes the rows', async () => {
      const admin = await seedUser('admin@example.com');
      const team = await createTeam({ repo, actorId: admin.id, name: 'T', now: T0 });
      // Pending add for an unknown email
      await addMember({
        repo,
        actorId: admin.id,
        teamId: team.id,
        email: 'lazy@example.com',
        transport,
        siteName: 'App',
        siteUrl: 'https://app.example.com',
        inviteTtlDays: 7,
        now: T0,
      });
      // Now they sign up
      const newUser = await seedUser('lazy@example.com');

      const memberships = await consumePendingInvitesForUser({
        repo,
        user: newUser,
        now: T0 + 1000,
      });

      expect(memberships).toHaveLength(1);
      expect(memberships[0]!.teamId).toBe(team.id);
      expect(memberships[0]!.role).toBe('user');

      const stillPending = await repo.findPendingInvitesForEmail(
        'lazy@example.com',
        T0 + 2000,
      );
      expect(stillPending).toHaveLength(0);
    });
  });

  describe('listMyTeams + listMembers', () => {
    it('listMyTeams returns the user\'s team memberships', async () => {
      const u = await seedUser('o@example.com');
      const team = await createTeam({ repo, actorId: u.id, name: 'A', now: T0 });
      const list = await listMyTeams({ repo, userId: u.id });
      expect(list).toHaveLength(1);
      expect(list[0]!.team.id).toBe(team.id);
      expect(list[0]!.role).toBe('admin');
    });

    it('listMembers returns members of the team', async () => {
      const admin = await seedUser('o@example.com');
      const team = await createTeam({ repo, actorId: admin.id, name: 'A', now: T0 });
      const m = await seedUser('m@example.com');
      await repo.addTeamMember(team.id, m.id, 'user', T0);

      const list = await listMembers({ repo, teamId: team.id });
      expect(list).toHaveLength(2);
    });
  });

  describe('removeMember', () => {
    it('Admin can remove a User', async () => {
      const admin = await seedUser('o@example.com');
      const team = await createTeam({ repo, actorId: admin.id, name: 'T', now: T0 });
      const m = await seedUser('m@example.com');
      await repo.addTeamMember(team.id, m.id, 'user', T0);

      await removeMember({ repo, actorId: admin.id, teamId: team.id, userId: m.id });
      expect(await repo.getTeamMember(team.id, m.id)).toBeNull();
    });

    it('User can leave (self-remove)', async () => {
      const admin = await seedUser('o@example.com');
      const team = await createTeam({ repo, actorId: admin.id, name: 'T', now: T0 });
      const m = await seedUser('m@example.com');
      await repo.addTeamMember(team.id, m.id, 'user', T0);

      await removeMember({ repo, actorId: m.id, teamId: team.id, userId: m.id });
      expect(await repo.getTeamMember(team.id, m.id)).toBeNull();
    });

    it('Admin cannot self-remove (must transfer first)', async () => {
      const admin = await seedUser('o@example.com');
      const team = await createTeam({ repo, actorId: admin.id, name: 'T', now: T0 });
      await expect(
        removeMember({ repo, actorId: admin.id, teamId: team.id, userId: admin.id }),
      ).rejects.toBeInstanceOf(NotAuthorizedError);
    });
  });

  describe('transferAdmin', () => {
    it('promotes the new admin and demotes the old admin to user', async () => {
      const admin = await seedUser('o@example.com');
      const team = await createTeam({ repo, actorId: admin.id, name: 'T', now: T0 });
      const m = await seedUser('m@example.com');
      await repo.addTeamMember(team.id, m.id, 'user', T0);

      await transferAdmin({
        repo,
        actorId: admin.id,
        teamId: team.id,
        toUserId: m.id,
      });

      const updated = await repo.getTeam(team.id);
      expect(updated?.adminId).toBe(m.id);
      expect((await repo.getTeamMember(team.id, m.id))!.role).toBe('admin');
      expect((await repo.getTeamMember(team.id, admin.id))!.role).toBe('user');
    });

    it('non-Admin cannot transfer', async () => {
      const admin = await seedUser('o@example.com');
      const team = await createTeam({ repo, actorId: admin.id, name: 'T', now: T0 });
      const m = await seedUser('m@example.com');
      await repo.addTeamMember(team.id, m.id, 'user', T0);

      await expect(
        transferAdmin({ repo, actorId: m.id, teamId: team.id, toUserId: m.id }),
      ).rejects.toBeInstanceOf(NotAuthorizedError);
    });
  });

  describe('deleteTeam', () => {
    it('Admin can delete', async () => {
      const admin = await seedUser('o@example.com');
      const team = await createTeam({ repo, actorId: admin.id, name: 'T', now: T0 });
      await deleteTeam({ repo, actorId: admin.id, teamId: team.id });
      expect(await repo.getTeam(team.id)).toBeNull();
    });

    it('Users cannot delete', async () => {
      const admin = await seedUser('o@example.com');
      const team = await createTeam({ repo, actorId: admin.id, name: 'T', now: T0 });
      const u = await seedUser('a@example.com');
      await repo.addTeamMember(team.id, u.id, 'user', T0);
      await expect(
        deleteTeam({ repo, actorId: u.id, teamId: team.id }),
      ).rejects.toBeInstanceOf(NotAuthorizedError);
    });

    it('throws TeamNotFoundError on unknown team', async () => {
      const admin = await seedUser('o@example.com');
      await expect(
        deleteTeam({ repo, actorId: admin.id, teamId: 'nope' }),
      ).rejects.toBeInstanceOf(TeamNotFoundError);
    });
  });

  describe('editTeam', () => {
    it('renames the team and recomputes initials', async () => {
      const admin = await seedUser('o@example.com');
      const team = await createTeam({ repo, actorId: admin.id, name: 'Old Name', now: T0 });
      const updated = await editTeam({
        repo,
        actorId: admin.id,
        teamId: team.id,
        name: 'New Brand',
      });
      expect(updated.name).toBe('New Brand');
      expect(updated.nameNormalized).toBe('new brand');
      expect(updated.avatarInitials).toBe('NB');
    });

    it('rejects rename to an existing team\'s name', async () => {
      const admin = await seedUser('o@example.com');
      const a = await createTeam({ repo, actorId: admin.id, name: 'A', now: T0 });
      const b = await createTeam({ repo, actorId: admin.id, name: 'B', now: T0 + 1 });
      await expect(
        editTeam({ repo, actorId: admin.id, teamId: b.id, name: 'A' }),
      ).rejects.toBeInstanceOf(TeamNameTakenError);
      void a;
    });

    it('Users cannot rename', async () => {
      const admin = await seedUser('o@example.com');
      const team = await createTeam({ repo, actorId: admin.id, name: 'T', now: T0 });
      const u = await seedUser('u@example.com');
      await repo.addTeamMember(team.id, u.id, 'user', T0);
      await expect(
        editTeam({ repo, actorId: u.id, teamId: team.id, name: 'Hacked' }),
      ).rejects.toBeInstanceOf(NotAuthorizedError);
    });
  });
});
