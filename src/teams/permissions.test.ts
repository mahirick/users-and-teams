import { describe, expect, it } from 'vitest';
import {
  canAddMember,
  canDeleteTeam,
  canEditTeam,
  canRemoveMember,
  canTransferAdmin,
} from './permissions.js';
import type { Team, TeamMember, User } from '../core/types.js';

const T: Team = {
  id: 'tm',
  name: 'Team',
  nameNormalized: 'team',
  adminId: 'u-admin',
  avatarColor: '#525252',
  avatarInitials: 'T',
  createdAt: 0,
};

const baseUser: User = {
  id: 'u-x',
  email: 'x@x.com',
  displayName: null,
  role: 'user',
  status: 'active',
  avatarColor: '#525252',
  avatarInitials: '?',
  createdAt: 0,
  lastSeenAt: null,
};

const teamAdmin: User = { ...baseUser, id: 'u-admin' };
const regular: User = { ...baseUser, id: 'u-user' };
const stranger: User = { ...baseUser, id: 'u-stranger' };
const sysOwner: User = { ...baseUser, id: 'u-sysowner', role: 'owner' };

const adminMembership: TeamMember = { teamId: T.id, userId: teamAdmin.id, role: 'admin', joinedAt: 0 };
const userMembership: TeamMember = { teamId: T.id, userId: regular.id, role: 'user', joinedAt: 0 };

describe('canEditTeam', () => {
  it('allows the team Admin', () => {
    expect(canEditTeam(T, teamAdmin)).toBe(true);
  });
  it('disallows regular Users', () => {
    expect(canEditTeam(T, regular)).toBe(false);
  });
  it('disallows non-members', () => {
    expect(canEditTeam(T, stranger)).toBe(false);
  });
  it('allows system Owners regardless of membership', () => {
    expect(canEditTeam(T, sysOwner)).toBe(true);
  });
});

describe('canDeleteTeam', () => {
  it('allows team Admin', () => {
    expect(canDeleteTeam(T, teamAdmin)).toBe(true);
  });
  it('disallows Users', () => {
    expect(canDeleteTeam(T, regular)).toBe(false);
  });
  it('allows system Owners', () => {
    expect(canDeleteTeam(T, sysOwner)).toBe(true);
  });
});

describe('canAddMember', () => {
  it('only team Admin and system Owner can add', () => {
    expect(canAddMember(T, teamAdmin)).toBe(true);
    expect(canAddMember(T, sysOwner)).toBe(true);
    expect(canAddMember(T, regular)).toBe(false);
    expect(canAddMember(T, stranger)).toBe(false);
  });
});

describe('canRemoveMember', () => {
  it('User can remove themselves (leave)', () => {
    expect(canRemoveMember(T, regular, userMembership, userMembership)).toBe(true);
  });
  it('Admin cannot remove themselves (must transfer)', () => {
    expect(canRemoveMember(T, teamAdmin, adminMembership, adminMembership)).toBe(false);
  });
  it('Admin can remove a User but not another Admin', () => {
    expect(canRemoveMember(T, teamAdmin, adminMembership, userMembership)).toBe(true);
    const otherAdmin: TeamMember = { ...adminMembership, userId: 'u-other-admin' };
    expect(canRemoveMember(T, teamAdmin, adminMembership, otherAdmin)).toBe(false);
  });
  it('User cannot remove anyone but themselves', () => {
    const otherUser: TeamMember = { ...userMembership, userId: 'u-other' };
    expect(canRemoveMember(T, regular, userMembership, otherUser)).toBe(false);
  });
  it('System Owner can remove anyone, even Admin', () => {
    expect(canRemoveMember(T, sysOwner, null, adminMembership)).toBe(true);
    expect(canRemoveMember(T, sysOwner, null, userMembership)).toBe(true);
  });
});

describe('canTransferAdmin', () => {
  it('only the team Admin can transfer', () => {
    expect(canTransferAdmin(T, teamAdmin)).toBe(true);
    expect(canTransferAdmin(T, regular)).toBe(false);
  });
  it('system Owner can also transfer', () => {
    expect(canTransferAdmin(T, sysOwner)).toBe(true);
  });
});
