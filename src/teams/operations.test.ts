import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepository } from '../adapters/memory.js';
import { consoleTransport, type ConsoleTransport } from '../email/console.js';
import {
  NotAuthorizedError,
  TeamNotFoundError,
  TeamSlugTakenError,
  TokenAlreadyConsumedError,
  TokenExpiredError,
  InvalidTokenError,
} from '../core/errors.js';
import { hashToken } from '../auth/tokens.js';
import {
  acceptInvite,
  createTeam,
  deleteTeam,
  inviteMember,
  listMembers,
  listMyTeams,
  removeMember,
  transferOwnership,
  updateMemberRole,
} from './operations.js';

const T0 = 1_700_000_000_000;

describe('teams operations', () => {
  let repo: ReturnType<typeof createMemoryRepository>;
  let transport: ConsoleTransport;

  beforeEach(() => {
    repo = createMemoryRepository();
    transport = consoleTransport({ captureOnly: true });
  });

  async function seedUser(email: string, role: 'user' | 'admin' = 'user') {
    return repo.createUser({ email, role }, T0);
  }

  describe('createTeam', () => {
    it('creates the team and adds the actor as owner', async () => {
      const u = await seedUser('owner@example.com');
      const team = await createTeam({
        repo,
        actorId: u.id,
        name: 'My Team',
        slug: 'my-team',
        now: T0,
      });

      expect(team.name).toBe('My Team');
      expect(team.slug).toBe('my-team');
      expect(team.ownerId).toBe(u.id);

      const member = await repo.getTeamMember(team.id, u.id);
      expect(member?.role).toBe('owner');
    });

    it('rejects a duplicate slug', async () => {
      const u = await seedUser('o@example.com');
      await createTeam({ repo, actorId: u.id, name: 'A', slug: 'taken', now: T0 });
      await expect(
        createTeam({ repo, actorId: u.id, name: 'B', slug: 'taken', now: T0 }),
      ).rejects.toBeInstanceOf(TeamSlugTakenError);
    });
  });

  describe('inviteMember', () => {
    async function setup() {
      const owner = await seedUser('o@example.com');
      const team = await createTeam({
        repo, actorId: owner.id, name: 'T', slug: 't', now: T0,
      });
      return { owner, team };
    }

    it('owner can invite; emails are sent and stored as hashed tokens', async () => {
      const { owner, team } = await setup();
      await inviteMember({
        repo,
        actorId: owner.id,
        teamId: team.id,
        email: 'guest@example.com',
        role: 'member',
        transport,
        siteName: 'App',
        siteUrl: 'https://app.example.com',
        inviteTtlDays: 7,
        now: T0,
      });

      expect(transport.captured).toHaveLength(1);
      expect(transport.captured[0]!.to).toBe('guest@example.com');
      const match = transport.captured[0]!.text.match(
        /invites\/accept\?token=([A-Za-z0-9_-]+)/,
      );
      expect(match).not.toBeNull();
      const invite = await repo.findTeamInviteByHash(hashToken(match![1]!));
      expect(invite?.email).toBe('guest@example.com');
      expect(invite?.role).toBe('member');
    });

    it('regular members cannot invite', async () => {
      const { owner, team } = await setup();
      const memberUser = await seedUser('m@example.com');
      await repo.addTeamMember(team.id, memberUser.id, 'member', T0);

      await expect(
        inviteMember({
          repo,
          actorId: memberUser.id,
          teamId: team.id,
          email: 'g@example.com',
          role: 'member',
          transport,
          siteName: 'App',
          siteUrl: 'https://app.example.com',
          inviteTtlDays: 7,
          now: T0,
        }),
      ).rejects.toBeInstanceOf(NotAuthorizedError);
      void owner; // owner unused but kept for setup symmetry
    });
  });

  describe('acceptInvite', () => {
    async function setupInvite() {
      const owner = await seedUser('o@example.com');
      const team = await createTeam({
        repo, actorId: owner.id, name: 'T', slug: 't', now: T0,
      });
      const invitee = await seedUser('guest@example.com');
      const token = 'inv-token-1';
      await repo.createTeamInvite(
        {
          tokenHash: hashToken(token),
          teamId: team.id,
          inviterId: owner.id,
          email: 'guest@example.com',
          role: 'admin',
          expiresAt: T0 + 7 * 86_400_000,
        },
        T0,
      );
      return { team, invitee, token };
    }

    it('adds the user to the team with the invited role', async () => {
      const { team, invitee, token } = await setupInvite();
      await acceptInvite({ repo, token, userId: invitee.id, now: T0 + 1000 });

      const member = await repo.getTeamMember(team.id, invitee.id);
      expect(member?.role).toBe('admin');
    });

    it('marks the invite consumed', async () => {
      const { invitee, token } = await setupInvite();
      await acceptInvite({ repo, token, userId: invitee.id, now: T0 + 1000 });

      const invite = await repo.findTeamInviteByHash(hashToken(token));
      expect(invite?.consumedAt).toBe(T0 + 1000);
    });

    it('rejects an already-consumed invite', async () => {
      const { invitee, token } = await setupInvite();
      await acceptInvite({ repo, token, userId: invitee.id, now: T0 + 1000 });
      await expect(
        acceptInvite({ repo, token, userId: invitee.id, now: T0 + 2000 }),
      ).rejects.toBeInstanceOf(TokenAlreadyConsumedError);
    });

    it('rejects an expired invite', async () => {
      const owner = await seedUser('o@example.com');
      const team = await createTeam({ repo, actorId: owner.id, name: 'T', slug: 't', now: T0 });
      const invitee = await seedUser('g@example.com');
      const token = 'expired-token';
      await repo.createTeamInvite(
        {
          tokenHash: hashToken(token),
          teamId: team.id,
          inviterId: owner.id,
          email: 'g@example.com',
          role: 'member',
          expiresAt: T0 + 1,
        },
        T0,
      );
      await expect(
        acceptInvite({ repo, token, userId: invitee.id, now: T0 + 100 }),
      ).rejects.toBeInstanceOf(TokenExpiredError);
    });

    it('rejects unknown tokens', async () => {
      const u = await seedUser('g@example.com');
      await expect(
        acceptInvite({ repo, token: 'never-issued', userId: u.id, now: T0 }),
      ).rejects.toBeInstanceOf(InvalidTokenError);
    });
  });

  describe('listMyTeams + listMembers', () => {
    it('listMyTeams returns the user’s team memberships', async () => {
      const u = await seedUser('o@example.com');
      const team = await createTeam({ repo, actorId: u.id, name: 'A', slug: 'a', now: T0 });
      const list = await listMyTeams({ repo, userId: u.id });
      expect(list).toHaveLength(1);
      expect(list[0]!.team.id).toBe(team.id);
      expect(list[0]!.role).toBe('owner');
    });

    it('listMembers returns members of the team', async () => {
      const owner = await seedUser('o@example.com');
      const team = await createTeam({ repo, actorId: owner.id, name: 'A', slug: 'a', now: T0 });
      const m = await seedUser('m@example.com');
      await repo.addTeamMember(team.id, m.id, 'member', T0);

      const list = await listMembers({ repo, teamId: team.id });
      expect(list).toHaveLength(2);
    });
  });

  describe('updateMemberRole', () => {
    it('owner can promote a member to admin', async () => {
      const owner = await seedUser('o@example.com');
      const team = await createTeam({ repo, actorId: owner.id, name: 'T', slug: 't', now: T0 });
      const m = await seedUser('m@example.com');
      await repo.addTeamMember(team.id, m.id, 'member', T0);

      await updateMemberRole({
        repo,
        actorId: owner.id,
        teamId: team.id,
        userId: m.id,
        role: 'admin',
      });

      const updated = await repo.getTeamMember(team.id, m.id);
      expect(updated?.role).toBe('admin');
    });

    it('admin cannot change roles', async () => {
      const owner = await seedUser('o@example.com');
      const team = await createTeam({ repo, actorId: owner.id, name: 'T', slug: 't', now: T0 });
      const adminUser = await seedUser('a@example.com');
      await repo.addTeamMember(team.id, adminUser.id, 'admin', T0);
      const m = await seedUser('m@example.com');
      await repo.addTeamMember(team.id, m.id, 'member', T0);

      await expect(
        updateMemberRole({
          repo,
          actorId: adminUser.id,
          teamId: team.id,
          userId: m.id,
          role: 'admin',
        }),
      ).rejects.toBeInstanceOf(NotAuthorizedError);
    });
  });

  describe('removeMember', () => {
    it('owner can remove a member', async () => {
      const owner = await seedUser('o@example.com');
      const team = await createTeam({ repo, actorId: owner.id, name: 'T', slug: 't', now: T0 });
      const m = await seedUser('m@example.com');
      await repo.addTeamMember(team.id, m.id, 'member', T0);

      await removeMember({ repo, actorId: owner.id, teamId: team.id, userId: m.id });
      expect(await repo.getTeamMember(team.id, m.id)).toBeNull();
    });

    it('member can leave (self-remove)', async () => {
      const owner = await seedUser('o@example.com');
      const team = await createTeam({ repo, actorId: owner.id, name: 'T', slug: 't', now: T0 });
      const m = await seedUser('m@example.com');
      await repo.addTeamMember(team.id, m.id, 'member', T0);

      await removeMember({ repo, actorId: m.id, teamId: team.id, userId: m.id });
      expect(await repo.getTeamMember(team.id, m.id)).toBeNull();
    });

    it('owner cannot self-remove (must transfer first)', async () => {
      const owner = await seedUser('o@example.com');
      const team = await createTeam({ repo, actorId: owner.id, name: 'T', slug: 't', now: T0 });
      await expect(
        removeMember({ repo, actorId: owner.id, teamId: team.id, userId: owner.id }),
      ).rejects.toBeInstanceOf(NotAuthorizedError);
    });
  });

  describe('transferOwnership', () => {
    it('promotes the new owner and demotes the old owner to admin', async () => {
      const owner = await seedUser('o@example.com');
      const team = await createTeam({ repo, actorId: owner.id, name: 'T', slug: 't', now: T0 });
      const m = await seedUser('m@example.com');
      await repo.addTeamMember(team.id, m.id, 'member', T0);

      await transferOwnership({
        repo,
        actorId: owner.id,
        teamId: team.id,
        toUserId: m.id,
      });

      const updated = await repo.getTeam(team.id);
      expect(updated?.ownerId).toBe(m.id);
      expect((await repo.getTeamMember(team.id, m.id))!.role).toBe('owner');
      expect((await repo.getTeamMember(team.id, owner.id))!.role).toBe('admin');
    });

    it('non-owner cannot transfer', async () => {
      const owner = await seedUser('o@example.com');
      const team = await createTeam({ repo, actorId: owner.id, name: 'T', slug: 't', now: T0 });
      const m = await seedUser('m@example.com');
      await repo.addTeamMember(team.id, m.id, 'member', T0);

      await expect(
        transferOwnership({ repo, actorId: m.id, teamId: team.id, toUserId: m.id }),
      ).rejects.toBeInstanceOf(NotAuthorizedError);
    });
  });

  describe('deleteTeam', () => {
    it('owner can delete', async () => {
      const owner = await seedUser('o@example.com');
      const team = await createTeam({ repo, actorId: owner.id, name: 'T', slug: 't', now: T0 });
      await deleteTeam({ repo, actorId: owner.id, teamId: team.id });
      expect(await repo.getTeam(team.id)).toBeNull();
    });

    it('admin cannot delete', async () => {
      const owner = await seedUser('o@example.com');
      const team = await createTeam({ repo, actorId: owner.id, name: 'T', slug: 't', now: T0 });
      const a = await seedUser('a@example.com');
      await repo.addTeamMember(team.id, a.id, 'admin', T0);
      await expect(
        deleteTeam({ repo, actorId: a.id, teamId: team.id }),
      ).rejects.toBeInstanceOf(NotAuthorizedError);
    });

    it('throws TeamNotFoundError on unknown team', async () => {
      const owner = await seedUser('o@example.com');
      await expect(
        deleteTeam({ repo, actorId: owner.id, teamId: 'nope' }),
      ).rejects.toBeInstanceOf(TeamNotFoundError);
    });
  });
});
