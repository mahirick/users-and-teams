// Team permission predicates. Pure functions — no IO. Operations module
// composes these to gate mutating actions.
//
// Role hierarchy within a team: owner > admin > member.
// System admins (User.role === 'admin') bypass team checks for every action.

import type { Team, TeamMember, User } from '../core/types.js';

const isSystemAdmin = (user: User): boolean => user.role === 'admin';

export function canEditTeam(_team: Team, user: User, membership: TeamMember | null): boolean {
  if (isSystemAdmin(user)) return true;
  if (!membership) return false;
  return membership.role === 'owner' || membership.role === 'admin';
}

export function canDeleteTeam(_team: Team, user: User, membership: TeamMember | null): boolean {
  if (isSystemAdmin(user)) return true;
  if (!membership) return false;
  return membership.role === 'owner';
}

export function canInvite(_team: Team, user: User, membership: TeamMember | null): boolean {
  if (isSystemAdmin(user)) return true;
  if (!membership) return false;
  return membership.role === 'owner' || membership.role === 'admin';
}

export function canRemoveMember(
  _team: Team,
  actor: User,
  actorMembership: TeamMember | null,
  target: TeamMember,
): boolean {
  if (isSystemAdmin(actor)) return true;
  if (!actorMembership) return false;

  // Self-removal allowed for any member (leave the team), except owners
  // (they must transfer ownership or delete the team first).
  if (actorMembership.userId === target.userId) {
    return actorMembership.role !== 'owner';
  }

  if (actorMembership.role === 'owner') return true;
  if (actorMembership.role === 'admin') {
    // Admin can only remove regular members
    return target.role === 'member';
  }
  return false;
}

export function canUpdateMemberRole(
  _team: Team,
  actor: User,
  actorMembership: TeamMember | null,
): boolean {
  if (isSystemAdmin(actor)) return true;
  return actorMembership?.role === 'owner';
}

export function canTransferOwnership(team: Team, actor: User): boolean {
  if (isSystemAdmin(actor)) return true;
  return team.ownerId === actor.id;
}
