// Teams operations: create, addMember, list, transfer, delete, edit. Pure
// functions over a Repository — the Fastify plugin and the demo backend both
// compose these.
//
// v2 model:
//   - Each team has exactly one Admin (Team.adminId, mirrored as
//     team_members.role='admin'). Everyone else is role='user'.
//   - "Inviting" is auto-add. If the email matches an existing User, they are
//     added immediately and emailed a notification. If the email is unknown,
//     a TeamInvite row is recorded as a pending-membership marker, and a
//     magic-link sign-up email is sent. On their first authenticated session,
//     auth/session.consumePendingInvitesForUser materializes the membership.

import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import {
  AlreadyTeamMemberError,
  NotAuthorizedError,
  TeamNameTakenError,
  TeamNotFoundError,
  UserNotFoundError,
} from '../core/errors.js';
import { deriveInitials, normalizeTeamName, pickColor } from '../core/avatar.js';
import type { Repository } from '../core/repository.js';
import type { MemberRole, Team, TeamMember, User } from '../core/types.js';
import { generateToken, hashToken } from '../auth/tokens.js';
import { addedToTeamEmail, signupAddedToTeamEmail } from '../email/templates.js';
import type { EmailTransport, RenderedEmail } from '../email/types.js';
import {
  canAddMember,
  canDeleteTeam,
  canEditTeam,
  canRemoveMember,
  canTransferAdmin,
} from './permissions.js';

const emailSchema = z.string().trim().email();
const nameSchema = z.string().trim().min(1, 'name required').max(120, 'name too long');

async function loadActorAndMembership(
  repo: Repository,
  teamId: string,
  actorId: string,
): Promise<{ actor: User; team: Team; membership: TeamMember | null }> {
  const actor = await repo.getUser(actorId);
  if (!actor) throw new UserNotFoundError(`Actor ${actorId} not found`);
  const team = await repo.getTeam(teamId);
  if (!team) throw new TeamNotFoundError();
  const membership = await repo.getTeamMember(teamId, actorId);
  return { actor, team, membership };
}

// ---- createTeam ----

export interface CreateTeamInput {
  repo: Repository;
  actorId: string;
  name: string;
  now?: number;
}

export async function createTeam(input: CreateTeamInput): Promise<Team> {
  const name = nameSchema.parse(input.name);
  const nameNormalized = normalizeTeamName(name);
  const now = input.now ?? Date.now();

  const actor = await input.repo.getUser(input.actorId);
  if (!actor) throw new UserNotFoundError(`Actor ${input.actorId} not found`);

  const existing = await input.repo.findTeamByNormalizedName(nameNormalized);
  if (existing) throw new TeamNameTakenError(name);

  const id = uuidv7();
  const team = await input.repo.createTeam(
    {
      id,
      name,
      nameNormalized,
      adminId: actor.id,
      avatarColor: pickColor(id),
      avatarInitials: deriveInitials({ displayName: name }),
    },
    now,
  );
  await input.repo.addTeamMember(team.id, actor.id, 'admin', now);
  return team;
}

// ---- addMember (auto-add, no accept/reject) ----

export interface AddMemberInput {
  repo: Repository;
  actorId: string;
  teamId: string;
  email: string;
  transport: EmailTransport;
  siteName: string;
  siteUrl: string;
  /** TTL for the magic-link signup invite (only used when email is unknown). */
  inviteTtlDays: number;
  now?: number;
  /** Optional template overrides. */
  addedTemplate?: typeof addedToTeamEmail;
  signupAddedTemplate?: typeof signupAddedToTeamEmail;
}

export type AddMemberResult =
  | { status: 'added'; userId: string; member: TeamMember }
  | { status: 'pending_signup'; email: string };

export async function addMember(input: AddMemberInput): Promise<AddMemberResult> {
  const email = emailSchema.parse(input.email).toLowerCase();
  const now = input.now ?? Date.now();
  const { actor, team } = await loadActorAndMembership(
    input.repo,
    input.teamId,
    input.actorId,
  );

  if (!canAddMember(team, actor)) {
    throw new NotAuthorizedError('Only the team Admin can add members');
  }

  const existingUser = await input.repo.findUserByEmail(email);

  if (existingUser) {
    const already = await input.repo.getTeamMember(team.id, existingUser.id);
    if (already) throw new AlreadyTeamMemberError();

    const member = await input.repo.addTeamMember(team.id, existingUser.id, 'user', now);

    const rendered = (input.addedTemplate ?? addedToTeamEmail)({
      siteName: input.siteName,
      siteUrl: input.siteUrl,
      teamName: team.name,
      addedByName: actor.displayName,
      addedByEmail: actor.email,
    });
    await input.transport.send({
      to: email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    return { status: 'added', userId: existingUser.id, member };
  }

  // Unknown email — record pending invite and email a magic-link signup.
  const token = generateToken();
  await input.repo.createTeamInvite(
    {
      tokenHash: hashToken(token),
      teamId: team.id,
      inviterId: actor.id,
      email,
      role: 'user',
      expiresAt: now + input.inviteTtlDays * 86_400_000,
    },
    now,
  );

  const signinUrl = new URL('/', input.siteUrl).toString();
  const rendered = (input.signupAddedTemplate ?? signupAddedToTeamEmail)({
    siteName: input.siteName,
    siteUrl: input.siteUrl,
    teamName: team.name,
    addedByName: actor.displayName,
    addedByEmail: actor.email,
    signinUrl,
  });
  await input.transport.send({
    to: email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });

  return { status: 'pending_signup', email };
}

/**
 * Auto-consume any pending TeamInvite rows for this user's email. Called from
 * auth/session.ts on every successful authentication (cheap query, single
 * indexed lookup) so a user added before they signed up materializes their
 * memberships on their first login.
 */
export async function consumePendingInvitesForUser(input: {
  repo: Repository;
  user: User;
  now?: number;
}): Promise<TeamMember[]> {
  const now = input.now ?? Date.now();
  const pending = await input.repo.findPendingInvitesForEmail(input.user.email, now);
  const memberships: TeamMember[] = [];
  for (const inv of pending) {
    const existing = await input.repo.getTeamMember(inv.teamId, input.user.id);
    if (!existing) {
      memberships.push(
        await input.repo.addTeamMember(inv.teamId, input.user.id, inv.role, now),
      );
    }
    await input.repo.consumeTeamInvite(inv.tokenHash, now);
  }
  return memberships;
}

// ---- listMyTeams + listMembers ----

export interface ListMyTeamsInput {
  repo: Repository;
  userId: string;
}

export async function listMyTeams(input: ListMyTeamsInput) {
  return input.repo.listTeamsForUser(input.userId);
}

export interface ListMembersInput {
  repo: Repository;
  teamId: string;
}

export async function listMembers(input: ListMembersInput) {
  return input.repo.listTeamMembers(input.teamId);
}

// ---- removeMember (admin removes someone, or user leaves) ----

export interface RemoveMemberInput {
  repo: Repository;
  actorId: string;
  teamId: string;
  userId: string;
}

export async function removeMember(input: RemoveMemberInput): Promise<void> {
  const { actor, team, membership } = await loadActorAndMembership(
    input.repo, input.teamId, input.actorId,
  );
  const target = await input.repo.getTeamMember(input.teamId, input.userId);
  if (!target) throw new UserNotFoundError('Target is not a member of this team');

  if (!canRemoveMember(team, actor, membership, target)) {
    throw new NotAuthorizedError(
      target.role === 'admin'
        ? 'Admins cannot leave; transfer admin first.'
        : 'Not allowed to remove this member',
    );
  }

  await input.repo.removeTeamMember(input.teamId, input.userId);
}

// ---- transferAdmin ----

export interface TransferAdminInput {
  repo: Repository;
  actorId: string;
  teamId: string;
  toUserId: string;
}

export async function transferAdmin(input: TransferAdminInput): Promise<void> {
  const { actor, team } = await loadActorAndMembership(
    input.repo, input.teamId, input.actorId,
  );

  if (!canTransferAdmin(team, actor)) {
    throw new NotAuthorizedError('Only the current Admin can transfer admin');
  }

  const recipient = await input.repo.getTeamMember(input.teamId, input.toUserId);
  if (!recipient) {
    throw new UserNotFoundError('New admin must be a current team member');
  }

  if (recipient.userId === team.adminId) {
    return; // already admin, nothing to do
  }

  await input.repo.updateTeam(input.teamId, { adminId: input.toUserId });
  await input.repo.updateTeamMemberRole(input.teamId, input.toUserId, 'admin');
  await input.repo.updateTeamMemberRole(input.teamId, actor.id, 'user');
}

// ---- deleteTeam ----

export interface DeleteTeamInput {
  repo: Repository;
  actorId: string;
  teamId: string;
}

export async function deleteTeam(input: DeleteTeamInput): Promise<void> {
  const { actor, team } = await loadActorAndMembership(
    input.repo, input.teamId, input.actorId,
  );
  if (!canDeleteTeam(team, actor)) {
    throw new NotAuthorizedError('Only the team Admin can delete a team');
  }
  await input.repo.deleteTeam(team.id);
}

// ---- editTeam (rename) ----

export interface EditTeamInput {
  repo: Repository;
  actorId: string;
  teamId: string;
  name: string;
}

export async function editTeam(input: EditTeamInput): Promise<Team> {
  const { actor, team } = await loadActorAndMembership(
    input.repo, input.teamId, input.actorId,
  );
  if (!canEditTeam(team, actor)) {
    throw new NotAuthorizedError('Only the team Admin can rename this team');
  }

  const name = nameSchema.parse(input.name);
  const nameNormalized = normalizeTeamName(name);
  if (nameNormalized !== team.nameNormalized) {
    const conflict = await input.repo.findTeamByNormalizedName(nameNormalized);
    if (conflict && conflict.id !== team.id) throw new TeamNameTakenError(name);
  }

  return input.repo.updateTeam(team.id, {
    name,
    nameNormalized,
    avatarInitials: deriveInitials({ displayName: name }),
  });
}

export type { MemberRole };
