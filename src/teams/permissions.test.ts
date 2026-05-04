import { describe, expect, it } from 'vitest';
import {
  canDeleteTeam,
  canEditTeam,
  canInvite,
  canRemoveMember,
  canTransferOwnership,
  canUpdateMemberRole,
} from './permissions.js';
import type { Team, TeamMember, User } from '../core/types.js';

const T: Team = { id: 'tm', name: 'Team', slug: 'tm', ownerId: 'u-owner', createdAt: 0 };

const owner: User = {
  id: 'u-owner', email: 'o@x.com', displayName: null, role: 'user',
  status: 'active', createdAt: 0, lastSeenAt: null,
};
const admin: User = { ...owner, id: 'u-admin', email: 'a@x.com' };
const member: User = { ...owner, id: 'u-member', email: 'm@x.com' };
const stranger: User = { ...owner, id: 'u-stranger', email: 's@x.com' };
const sysAdmin: User = { ...owner, id: 'u-sysa', email: 'sa@x.com', role: 'admin' };

const ownerMember: TeamMember = { teamId: T.id, userId: owner.id, role: 'owner', joinedAt: 0 };
const adminMember: TeamMember = { teamId: T.id, userId: admin.id, role: 'admin', joinedAt: 0 };
const memberMember: TeamMember = { teamId: T.id, userId: member.id, role: 'member', joinedAt: 0 };

describe('canEditTeam (name/slug)', () => {
  it('allows owner', () => {
    expect(canEditTeam(T, owner, ownerMember)).toBe(true);
  });
  it('allows admin members', () => {
    expect(canEditTeam(T, admin, adminMember)).toBe(true);
  });
  it('disallows regular members', () => {
    expect(canEditTeam(T, member, memberMember)).toBe(false);
  });
  it('disallows non-members', () => {
    expect(canEditTeam(T, stranger, null)).toBe(false);
  });
  it('allows system admins regardless of membership', () => {
    expect(canEditTeam(T, sysAdmin, null)).toBe(true);
  });
});

describe('canDeleteTeam', () => {
  it('allows owner', () => {
    expect(canDeleteTeam(T, owner, ownerMember)).toBe(true);
  });
  it('disallows team admin', () => {
    expect(canDeleteTeam(T, admin, adminMember)).toBe(false);
  });
  it('allows system admins', () => {
    expect(canDeleteTeam(T, sysAdmin, null)).toBe(true);
  });
});

describe('canInvite', () => {
  it('allows owner and team admin', () => {
    expect(canInvite(T, owner, ownerMember)).toBe(true);
    expect(canInvite(T, admin, adminMember)).toBe(true);
  });
  it('disallows regular members', () => {
    expect(canInvite(T, member, memberMember)).toBe(false);
  });
});

describe('canRemoveMember', () => {
  it('owner can remove anyone except themselves', () => {
    expect(canRemoveMember(T, owner, ownerMember, memberMember)).toBe(true);
    expect(canRemoveMember(T, owner, ownerMember, adminMember)).toBe(true);
    // owner cannot remove self via removeMember (use deleteTeam or transfer first)
    expect(canRemoveMember(T, owner, ownerMember, ownerMember)).toBe(false);
  });
  it('admin can remove regular members but not owner or other admins', () => {
    expect(canRemoveMember(T, admin, adminMember, memberMember)).toBe(true);
    expect(canRemoveMember(T, admin, adminMember, ownerMember)).toBe(false);
    const otherAdmin: TeamMember = { ...adminMember, userId: 'u-admin2' };
    expect(canRemoveMember(T, admin, adminMember, otherAdmin)).toBe(false);
  });
  it('member can leave themselves', () => {
    expect(canRemoveMember(T, member, memberMember, memberMember)).toBe(true);
  });
  it('member cannot remove others', () => {
    const otherMember: TeamMember = { ...memberMember, userId: 'u-other' };
    expect(canRemoveMember(T, member, memberMember, otherMember)).toBe(false);
  });
});

describe('canUpdateMemberRole', () => {
  it('only owner can change member roles', () => {
    expect(canUpdateMemberRole(T, owner, ownerMember)).toBe(true);
    expect(canUpdateMemberRole(T, admin, adminMember)).toBe(false);
    expect(canUpdateMemberRole(T, member, memberMember)).toBe(false);
  });
  it('system admin can change member roles', () => {
    expect(canUpdateMemberRole(T, sysAdmin, null)).toBe(true);
  });
});

describe('canTransferOwnership', () => {
  it('only owner can transfer', () => {
    expect(canTransferOwnership(T, owner)).toBe(true);
    expect(canTransferOwnership(T, admin)).toBe(false);
  });
});
