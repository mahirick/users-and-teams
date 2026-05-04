// Team permission predicates. Pure functions — no IO. Operations module
// composes these to gate mutating actions.
//
// Per team there is exactly one Admin (the team's adminId, mirrored as
// team_members.role='admin'). All other team members have role='user'.
// System Owners (User.role === 'owner') bypass team checks for every action.

import type { Team, TeamMember, User } from '../core/types.js';

const isSystemOwner = (user: User): boolean => user.role === 'owner';

export function canEditTeam(team: Team, user: User): boolean {
  if (isSystemOwner(user)) return true;
  return team.adminId === user.id;
}

export function canDeleteTeam(team: Team, user: User): boolean {
  if (isSystemOwner(user)) return true;
  return team.adminId === user.id;
}

export function canAddMember(team: Team, user: User): boolean {
  if (isSystemOwner(user)) return true;
  return team.adminId === user.id;
}

export function canRemoveMember(
  team: Team,
  actor: User,
  actorMembership: TeamMember | null,
  target: TeamMember,
): boolean {
  if (isSystemOwner(actor)) return true;
  if (!actorMembership) return false;

  // Self-removal (leaving) — Users can leave; Admins must transfer first.
  if (actorMembership.userId === target.userId) {
    return target.role !== 'admin';
  }

  // Other-removal — only the team Admin can remove other members.
  return team.adminId === actor.id && target.role !== 'admin';
}

export function canTransferAdmin(team: Team, actor: User): boolean {
  if (isSystemOwner(actor)) return true;
  return team.adminId === actor.id;
}
