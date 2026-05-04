// Repository contract test suite. Both memory and sqlite adapters run through
// this same set of tests — the contract tells us they are interchangeable.

import { describe, expect, it, beforeEach } from 'vitest';
import type { Repository } from '../core/repository.js';

export interface ContractContext {
  repo: Repository;
}

export function repositoryContract(
  label: string,
  setup: () => Promise<Repository>,
): void {
  describe(`Repository contract: ${label}`, () => {
    let repo: Repository;
    const T0 = 1_700_000_000_000; // fixed "now" for deterministic tests

    beforeEach(async () => {
      repo = await setup();
    });

    // ---- users ----
    describe('users', () => {
      it('createUser stores a user with defaults', async () => {
        const user = await repo.createUser({ email: 'alice@example.com' }, T0);

        expect(user.email).toBe('alice@example.com');
        expect(user.role).toBe('user');
        expect(user.status).toBe('active');
        expect(user.createdAt).toBe(T0);
        expect(user.lastSeenAt).toBeNull();
        expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
      });

      it('createUser respects role override', async () => {
        const user = await repo.createUser(
          { email: 'owner@example.com', role: 'owner' },
          T0,
        );
        expect(user.role).toBe('owner');
      });

      it('createUser fills avatar columns with placeholders when omitted', async () => {
        const user = await repo.createUser({ email: 'p@example.com' }, T0);
        expect(user.avatarColor).toMatch(/^#/);
        expect(user.avatarInitials).toBeTypeOf('string');
      });

      it('createUser stores avatar columns when provided', async () => {
        const user = await repo.createUser(
          {
            email: 'a@example.com',
            avatarColor: '#0EA5E9',
            avatarInitials: 'AB',
          },
          T0,
        );
        expect(user.avatarColor).toBe('#0EA5E9');
        expect(user.avatarInitials).toBe('AB');
      });

      it('createUser sets displayName when provided', async () => {
        const user = await repo.createUser(
          { email: 'a@example.com', displayName: 'Alice' },
          T0,
        );
        expect(user.displayName).toBe('Alice');
      });

      it('getUser returns null for unknown id', async () => {
        const got = await repo.getUser('does-not-exist');
        expect(got).toBeNull();
      });

      it('getUser round-trips a created user', async () => {
        const created = await repo.createUser({ email: 'a@example.com' }, T0);
        const fetched = await repo.getUser(created.id);
        expect(fetched).toEqual(created);
      });

      it('findUserByEmail is case-sensitive on the stored value (caller normalizes)', async () => {
        const created = await repo.createUser({ email: 'a@example.com' }, T0);
        expect(await repo.findUserByEmail('a@example.com')).toEqual(created);
        expect(await repo.findUserByEmail('A@example.com')).toBeNull();
      });

      it('findUserByEmail returns null for unknown email', async () => {
        expect(await repo.findUserByEmail('nope@example.com')).toBeNull();
      });

      it('updateUser patches displayName, role, status, lastSeenAt', async () => {
        const u = await repo.createUser({ email: 'a@example.com' }, T0);
        const updated = await repo.updateUser(u.id, {
          displayName: 'Alice',
          role: 'owner',
          status: 'suspended',
          lastSeenAt: T0 + 1000,
        });
        expect(updated.displayName).toBe('Alice');
        expect(updated.role).toBe('owner');
        expect(updated.status).toBe('suspended');
        expect(updated.lastSeenAt).toBe(T0 + 1000);
      });

      it('updateUser patches avatar fields', async () => {
        const u = await repo.createUser({ email: 'a@example.com' }, T0);
        const updated = await repo.updateUser(u.id, {
          avatarColor: '#34C759',
          avatarInitials: 'AA',
        });
        expect(updated.avatarColor).toBe('#34C759');
        expect(updated.avatarInitials).toBe('AA');
      });

      it('updateUser can change email', async () => {
        const u = await repo.createUser({ email: 'old@example.com' }, T0);
        const updated = await repo.updateUser(u.id, { email: 'new@example.com' });
        expect(updated.email).toBe('new@example.com');
        expect(await repo.findUserByEmail('new@example.com')).toEqual(updated);
        expect(await repo.findUserByEmail('old@example.com')).toBeNull();
      });

      it('deleteUser removes the user', async () => {
        const u = await repo.createUser({ email: 'a@example.com' }, T0);
        await repo.deleteUser(u.id);
        expect(await repo.getUser(u.id)).toBeNull();
      });

      it('listUsers paginates and filters by search', async () => {
        await repo.createUser({ email: 'alice@example.com' }, T0);
        await repo.createUser({ email: 'bob@example.com' }, T0 + 1);
        await repo.createUser({ email: 'carol@example.com' }, T0 + 2);

        const all = await repo.listUsers({});
        expect(all.total).toBe(3);
        expect(all.users).toHaveLength(3);

        const aOnly = await repo.listUsers({ search: 'alice' });
        expect(aOnly.users).toHaveLength(1);
        expect(aOnly.users[0]!.email).toBe('alice@example.com');

        const page = await repo.listUsers({ page: 1, pageSize: 2 });
        expect(page.users).toHaveLength(2);
        const page2 = await repo.listUsers({ page: 2, pageSize: 2 });
        expect(page2.users).toHaveLength(1);
      });
    });

    // ---- magic links ----
    describe('magic links', () => {
      it('createMagicLink + findMagicLinkByHash round-trip', async () => {
        await repo.createMagicLink(
          { tokenHash: 'h1', email: 'a@example.com', expiresAt: T0 + 60_000 },
          T0,
        );
        const link = await repo.findMagicLinkByHash('h1');
        expect(link).not.toBeNull();
        expect(link!.email).toBe('a@example.com');
        expect(link!.expiresAt).toBe(T0 + 60_000);
        expect(link!.consumedAt).toBeNull();
      });

      it('findMagicLinkByHash returns null for unknown', async () => {
        expect(await repo.findMagicLinkByHash('nope')).toBeNull();
      });

      it('consumeMagicLink sets consumedAt', async () => {
        await repo.createMagicLink(
          { tokenHash: 'h2', email: 'a@example.com', expiresAt: T0 + 60_000 },
          T0,
        );
        await repo.consumeMagicLink('h2', T0 + 1_000);
        const link = await repo.findMagicLinkByHash('h2');
        expect(link!.consumedAt).toBe(T0 + 1_000);
      });

      it('countMagicLinksForEmailSince returns count of recent issues', async () => {
        await repo.createMagicLink(
          { tokenHash: 'a', email: 'x@example.com', expiresAt: T0 + 60_000 },
          T0 - 1_000_000,
        );
        await repo.createMagicLink(
          { tokenHash: 'b', email: 'x@example.com', expiresAt: T0 + 60_000 },
          T0 - 100,
        );
        await repo.createMagicLink(
          { tokenHash: 'c', email: 'x@example.com', expiresAt: T0 + 60_000 },
          T0,
        );
        // Different email — should not be counted
        await repo.createMagicLink(
          { tokenHash: 'd', email: 'y@example.com', expiresAt: T0 + 60_000 },
          T0,
        );

        expect(
          await repo.countMagicLinksForEmailSince('x@example.com', T0 - 1_000),
        ).toBe(2);
      });
    });

    // ---- sessions ----
    describe('sessions', () => {
      async function makeUser() {
        return repo.createUser({ email: 'sess@example.com' }, T0);
      }

      it('createSession stores and returns the session', async () => {
        const u = await makeUser();
        const s = await repo.createSession(
          { tokenHash: 's1', userId: u.id, expiresAt: T0 + 90 * 86_400_000 },
          T0,
        );
        expect(s.tokenHash).toBe('s1');
        expect(s.userId).toBe(u.id);
        expect(s.createdAt).toBe(T0);
        expect(s.lastUsedAt).toBe(T0);
      });

      it('findSessionByHash returns null for unknown', async () => {
        expect(await repo.findSessionByHash('missing')).toBeNull();
      });

      it('bumpSession updates last-used and expires-at', async () => {
        const u = await makeUser();
        await repo.createSession(
          { tokenHash: 's2', userId: u.id, expiresAt: T0 + 1000 },
          T0,
        );
        await repo.bumpSession('s2', T0 + 500, T0 + 5000);
        const s = await repo.findSessionByHash('s2');
        expect(s!.lastUsedAt).toBe(T0 + 500);
        expect(s!.expiresAt).toBe(T0 + 5000);
      });

      it('deleteSession removes the row', async () => {
        const u = await makeUser();
        await repo.createSession(
          { tokenHash: 's3', userId: u.id, expiresAt: T0 + 1000 },
          T0,
        );
        await repo.deleteSession('s3');
        expect(await repo.findSessionByHash('s3')).toBeNull();
      });

      it('deleteSessionsForUser clears all sessions for that user', async () => {
        const a = await repo.createUser({ email: 'a@example.com' }, T0);
        const b = await repo.createUser({ email: 'b@example.com' }, T0);
        await repo.createSession({ tokenHash: 's-a1', userId: a.id, expiresAt: T0 + 1 }, T0);
        await repo.createSession({ tokenHash: 's-a2', userId: a.id, expiresAt: T0 + 1 }, T0);
        await repo.createSession({ tokenHash: 's-b1', userId: b.id, expiresAt: T0 + 1 }, T0);

        const removed = await repo.deleteSessionsForUser(a.id);
        expect(removed).toBe(2);
        expect(await repo.findSessionByHash('s-a1')).toBeNull();
        expect(await repo.findSessionByHash('s-a2')).toBeNull();
        expect(await repo.findSessionByHash('s-b1')).not.toBeNull();
      });

      it('deleting a user cascades to their sessions', async () => {
        const u = await makeUser();
        await repo.createSession({ tokenHash: 's-c', userId: u.id, expiresAt: T0 + 1 }, T0);
        await repo.deleteUser(u.id);
        expect(await repo.findSessionByHash('s-c')).toBeNull();
      });
    });

    // ---- teams ----
    describe('teams', () => {
      async function makeOwner() {
        return repo.createUser({ email: 'owner@example.com' }, T0);
      }

      it('createTeam round-trips', async () => {
        const owner = await makeOwner();
        const team = await repo.createTeam(
          { id: 'team-1', name: 'Team One', adminId: owner.id },
          T0,
        );
        expect(team.id).toBe('team-1');
        expect(team.name).toBe('Team One');
        expect(team.adminId).toBe(owner.id);
        expect(team.nameNormalized).toBe('team one');

        const fetched = await repo.getTeam('team-1');
        expect(fetched).toEqual(team);
      });

      it('findTeamByNormalizedName returns the team', async () => {
        const owner = await makeOwner();
        await repo.createTeam(
          { id: 'team-2', name: 'Two', nameNormalized: 'two', adminId: owner.id },
          T0,
        );
        const t = await repo.findTeamByNormalizedName('two');
        expect(t!.id).toBe('team-2');
      });

      it('updateTeam patches name and nameNormalized', async () => {
        const owner = await makeOwner();
        await repo.createTeam(
          { id: 'team-3', name: 'Old', nameNormalized: 'old', adminId: owner.id },
          T0,
        );
        const updated = await repo.updateTeam('team-3', {
          name: 'New',
          nameNormalized: 'new',
        });
        expect(updated.name).toBe('New');
        expect(updated.nameNormalized).toBe('new');
      });

      it('deleteTeam removes it', async () => {
        const owner = await makeOwner();
        await repo.createTeam(
          { id: 'team-4', name: 'Z', adminId: owner.id },
          T0,
        );
        await repo.deleteTeam('team-4');
        expect(await repo.getTeam('team-4')).toBeNull();
      });

      it('listTeamsForUser returns teams the user is a member of', async () => {
        const owner = await makeOwner();
        const teamA = await repo.createTeam(
          { id: 'a', name: 'A', nameNormalized: 'a', adminId: owner.id },
          T0,
        );
        const teamB = await repo.createTeam(
          { id: 'b', name: 'B', nameNormalized: 'b', adminId: owner.id },
          T0,
        );
        await repo.addTeamMember(teamA.id, owner.id, 'admin', T0);
        await repo.addTeamMember(teamB.id, owner.id, 'user', T0);

        const teams = await repo.listTeamsForUser(owner.id);
        expect(teams).toHaveLength(2);
        const ids = teams.map((t) => t.team.id).sort();
        expect(ids).toEqual(['a', 'b']);
      });
    });

    // ---- team members ----
    describe('team members', () => {
      it('addTeamMember + getTeamMember round-trip', async () => {
        const owner = await repo.createUser({ email: 'o@example.com' }, T0);
        const member = await repo.createUser({ email: 'm@example.com' }, T0);
        await repo.createTeam(
          { id: 'tm', name: 'TM', adminId: owner.id },
          T0,
        );
        const tm = await repo.addTeamMember('tm', member.id, 'admin', T0 + 5);
        expect(tm.role).toBe('admin');
        expect(tm.joinedAt).toBe(T0 + 5);
        expect(await repo.getTeamMember('tm', member.id)).toEqual(tm);
      });

      it('listTeamMembers returns members with their user objects', async () => {
        const owner = await repo.createUser({ email: 'o2@example.com' }, T0);
        const m = await repo.createUser({ email: 'm2@example.com' }, T0);
        await repo.createTeam(
          { id: 'tm2', name: 'TM2', adminId: owner.id },
          T0,
        );
        await repo.addTeamMember('tm2', owner.id, 'admin', T0);
        await repo.addTeamMember('tm2', m.id, 'user', T0);

        const list = await repo.listTeamMembers('tm2');
        expect(list).toHaveLength(2);
        const emails = list.map((row) => row.user.email).sort();
        expect(emails).toEqual(['m2@example.com', 'o2@example.com']);
      });

      it('updateTeamMemberRole changes the role', async () => {
        const owner = await repo.createUser({ email: 'o3@example.com' }, T0);
        const m = await repo.createUser({ email: 'm3@example.com' }, T0);
        await repo.createTeam(
          { id: 'tm3', name: 'TM3', adminId: owner.id },
          T0,
        );
        await repo.addTeamMember('tm3', m.id, 'user', T0);
        await repo.updateTeamMemberRole('tm3', m.id, 'admin');
        const tm = await repo.getTeamMember('tm3', m.id);
        expect(tm!.role).toBe('admin');
      });

      it('removeTeamMember deletes the row', async () => {
        const owner = await repo.createUser({ email: 'o4@example.com' }, T0);
        const m = await repo.createUser({ email: 'm4@example.com' }, T0);
        await repo.createTeam(
          { id: 'tm4', name: 'TM4', adminId: owner.id },
          T0,
        );
        await repo.addTeamMember('tm4', m.id, 'user', T0);
        await repo.removeTeamMember('tm4', m.id);
        expect(await repo.getTeamMember('tm4', m.id)).toBeNull();
      });

      it('deleting a team cascades to members', async () => {
        const owner = await repo.createUser({ email: 'o5@example.com' }, T0);
        await repo.createTeam(
          { id: 'tm5', name: 'TM5', adminId: owner.id },
          T0,
        );
        await repo.addTeamMember('tm5', owner.id, 'admin', T0);
        await repo.deleteTeam('tm5');
        expect(await repo.getTeamMember('tm5', owner.id)).toBeNull();
      });
    });

    // ---- team invites ----
    describe('team invites', () => {
      async function setup() {
        const owner = await repo.createUser({ email: `inv-${Math.random()}@x.com` }, T0);
        const team = await repo.createTeam(
          { id: `inv-team-${Math.random()}`, name: `Inv-${Math.random()}`, adminId: owner.id },
          T0,
        );
        return { owner, team };
      }

      it('createTeamInvite + findTeamInviteByHash round-trip', async () => {
        const { owner, team } = await setup();
        await repo.createTeamInvite(
          {
            tokenHash: 'inv-1',
            teamId: team.id,
            inviterId: owner.id,
            email: 'guest@example.com',
            role: 'user',
            expiresAt: T0 + 7 * 86_400_000,
          },
          T0,
        );
        const invite = await repo.findTeamInviteByHash('inv-1');
        expect(invite!.email).toBe('guest@example.com');
        expect(invite!.role).toBe('user');
      });

      it('consumeTeamInvite marks consumedAt', async () => {
        const { owner, team } = await setup();
        await repo.createTeamInvite(
          {
            tokenHash: 'inv-2',
            teamId: team.id,
            inviterId: owner.id,
            email: 'g@example.com',
            role: 'user',
            expiresAt: T0 + 1000,
          },
          T0,
        );
        await repo.consumeTeamInvite('inv-2', T0 + 1);
        const invite = await repo.findTeamInviteByHash('inv-2');
        expect(invite!.consumedAt).toBe(T0 + 1);
      });

      it('listTeamInvites returns the team’s invites', async () => {
        const { owner, team } = await setup();
        await repo.createTeamInvite(
          {
            tokenHash: 'inv-3',
            teamId: team.id,
            inviterId: owner.id,
            email: 'a@example.com',
            role: 'user',
            expiresAt: T0 + 1000,
          },
          T0,
        );
        await repo.createTeamInvite(
          {
            tokenHash: 'inv-4',
            teamId: team.id,
            inviterId: owner.id,
            email: 'b@example.com',
            role: 'admin',
            expiresAt: T0 + 1000,
          },
          T0,
        );
        const invites = await repo.listTeamInvites(team.id);
        expect(invites).toHaveLength(2);
      });

      it('findPendingInvitesForEmail filters by email + un-consumed + un-expired', async () => {
        const { owner, team } = await setup();
        // pending
        await repo.createTeamInvite(
          {
            tokenHash: 'inv-pending',
            teamId: team.id,
            inviterId: owner.id,
            email: 'pending@example.com',
            role: 'user',
            expiresAt: T0 + 60_000,
          },
          T0,
        );
        // consumed
        await repo.createTeamInvite(
          {
            tokenHash: 'inv-consumed',
            teamId: team.id,
            inviterId: owner.id,
            email: 'pending@example.com',
            role: 'user',
            expiresAt: T0 + 60_000,
          },
          T0,
        );
        await repo.consumeTeamInvite('inv-consumed', T0);
        // expired
        await repo.createTeamInvite(
          {
            tokenHash: 'inv-expired',
            teamId: team.id,
            inviterId: owner.id,
            email: 'pending@example.com',
            role: 'user',
            expiresAt: T0 - 1,
          },
          T0,
        );
        // wrong email
        await repo.createTeamInvite(
          {
            tokenHash: 'inv-other',
            teamId: team.id,
            inviterId: owner.id,
            email: 'other@example.com',
            role: 'user',
            expiresAt: T0 + 60_000,
          },
          T0,
        );

        const pending = await repo.findPendingInvitesForEmail('pending@example.com', T0);
        expect(pending).toHaveLength(1);
        expect(pending[0]!.tokenHash).toBe('inv-pending');
      });
    });

    // ---- audit ----
    describe('audit', () => {
      it('createAuditEntry stores and returns', async () => {
        const e = await repo.createAuditEntry(
          {
            actorId: null,
            action: 'user.create',
            targetId: 'user-1',
            metadata: { email: 'a@example.com' },
          },
          T0,
        );
        expect(e.action).toBe('user.create');
        expect(e.targetId).toBe('user-1');
        expect(e.createdAt).toBe(T0);
        expect(JSON.parse(e.metadataJson!)).toEqual({ email: 'a@example.com' });
      });

      it('listAuditEntries filters by action', async () => {
        await repo.createAuditEntry({ actorId: null, action: 'user.create' }, T0);
        await repo.createAuditEntry({ actorId: null, action: 'user.suspend' }, T0 + 1);
        await repo.createAuditEntry({ actorId: null, action: 'team.create' }, T0 + 2);

        const onlyUser = await repo.listAuditEntries({ action: 'user.create' });
        expect(onlyUser).toHaveLength(1);
        expect(onlyUser[0]!.action).toBe('user.create');
      });

      it('listAuditEntries filters by actorId and targetId', async () => {
        await repo.createAuditEntry(
          { actorId: 'a-1', action: 'user.role.change', targetId: 't-1' },
          T0,
        );
        await repo.createAuditEntry(
          { actorId: 'a-1', action: 'user.role.change', targetId: 't-2' },
          T0 + 1,
        );
        await repo.createAuditEntry(
          { actorId: 'a-2', action: 'user.role.change', targetId: 't-1' },
          T0 + 2,
        );

        const byActor = await repo.listAuditEntries({ actorId: 'a-1' });
        expect(byActor).toHaveLength(2);

        const byTarget = await repo.listAuditEntries({ targetId: 't-1' });
        expect(byTarget).toHaveLength(2);
      });

      it('listAuditEntries respects limit and orders newest first', async () => {
        await repo.createAuditEntry({ actorId: null, action: 'a' }, T0);
        await repo.createAuditEntry({ actorId: null, action: 'b' }, T0 + 1);
        await repo.createAuditEntry({ actorId: null, action: 'c' }, T0 + 2);

        const lastTwo = await repo.listAuditEntries({ limit: 2 });
        expect(lastTwo).toHaveLength(2);
        expect(lastTwo[0]!.action).toBe('c');
        expect(lastTwo[1]!.action).toBe('b');
      });
    });
  });
}
