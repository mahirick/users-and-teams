// Teams operations: create, invite, accept, list, role/membership management,
// transfer, delete. Each operation is a pure function over a Repository — the
// Fastify plugin and the demo backend both compose these.

import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import {
  InvalidTokenError,
  NotAuthorizedError,
  TeamNotFoundError,
  TeamSlugTakenError,
  TokenAlreadyConsumedError,
  TokenExpiredError,
  UserNotFoundError,
} from '../core/errors.js';
import type { Repository } from '../core/repository.js';
import type { MemberRole, Team, TeamMember, User } from '../core/types.js';
import { generateToken, hashToken } from '../auth/tokens.js';
import { inviteEmail } from '../email/templates.js';
import type { EmailTransport, RenderedEmail } from '../email/types.js';
import {
  canDeleteTeam,
  canEditTeam,
  canInvite,
  canRemoveMember,
  canTransferOwnership,
  canUpdateMemberRole,
} from './permissions.js';

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'slug required')
  .max(64, 'slug too long')
  .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric or hyphens');

const emailSchema = z.string().trim().email();

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
  slug: string;
  now?: number;
}

export async function createTeam(input: CreateTeamInput): Promise<Team> {
  const slug = slugSchema.parse(input.slug);
  const now = input.now ?? Date.now();

  const actor = await input.repo.getUser(input.actorId);
  if (!actor) throw new UserNotFoundError(`Actor ${input.actorId} not found`);

  const existing = await input.repo.findTeamBySlug(slug);
  if (existing) throw new TeamSlugTakenError(slug);

  const team = await input.repo.createTeam(
    { id: uuidv7(), name: input.name.trim(), slug, ownerId: actor.id },
    now,
  );
  await input.repo.addTeamMember(team.id, actor.id, 'owner', now);
  return team;
}

// ---- inviteMember ----

export interface InviteMemberInput {
  repo: Repository;
  actorId: string;
  teamId: string;
  email: string;
  role: MemberRole;
  transport: EmailTransport;
  siteName: string;
  siteUrl: string;
  inviteTtlDays: number;
  now?: number;
  template?: (args: {
    siteName: string;
    siteUrl: string;
    teamName: string;
    inviterName: string | null;
    inviterEmail?: string;
    link: string;
  }) => RenderedEmail;
}

export interface InviteMemberResult {
  ok: true;
  email: string;
}

export async function inviteMember(input: InviteMemberInput): Promise<InviteMemberResult> {
  const email = emailSchema.parse(input.email).toLowerCase();
  if (input.role === 'owner') {
    throw new Error('Cannot invite directly as owner; use transferOwnership.');
  }

  const now = input.now ?? Date.now();
  const { actor, team, membership } = await loadActorAndMembership(
    input.repo,
    input.teamId,
    input.actorId,
  );

  if (!canInvite(team, actor, membership)) {
    throw new NotAuthorizedError('Not allowed to invite to this team');
  }

  const token = generateToken();
  await input.repo.createTeamInvite(
    {
      tokenHash: hashToken(token),
      teamId: team.id,
      inviterId: actor.id,
      email,
      role: input.role,
      expiresAt: now + input.inviteTtlDays * 86_400_000,
    },
    now,
  );

  const link = new URL('/invites/accept', input.siteUrl);
  link.searchParams.set('token', token);

  const rendered = (input.template ?? inviteEmail)({
    siteName: input.siteName,
    siteUrl: input.siteUrl,
    teamName: team.name,
    inviterName: actor.displayName,
    inviterEmail: actor.email,
    link: link.toString(),
  });

  await input.transport.send({
    to: email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });

  return { ok: true, email };
}

// ---- acceptInvite ----

export interface AcceptInviteInput {
  repo: Repository;
  token: string;
  userId: string;
  now?: number;
}

export async function acceptInvite(input: AcceptInviteInput): Promise<TeamMember> {
  const now = input.now ?? Date.now();
  const tokenHash = hashToken(input.token);
  const invite = await input.repo.findTeamInviteByHash(tokenHash);
  if (!invite) throw new InvalidTokenError('Invite not found');
  if (invite.consumedAt !== null) throw new TokenAlreadyConsumedError();
  if (invite.expiresAt < now) throw new TokenExpiredError('Invite expired');

  const user = await input.repo.getUser(input.userId);
  if (!user) throw new UserNotFoundError();

  // The invite was issued to a specific email — only that user can accept.
  if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
    throw new NotAuthorizedError(
      `Invite was issued to ${invite.email}, not ${user.email}`,
    );
  }

  await input.repo.consumeTeamInvite(tokenHash, now);

  const existing = await input.repo.getTeamMember(invite.teamId, user.id);
  if (existing) {
    // Already a member — return current membership without changing role
    return existing;
  }

  return input.repo.addTeamMember(invite.teamId, user.id, invite.role, now);
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

// ---- updateMemberRole ----

export interface UpdateMemberRoleInput {
  repo: Repository;
  actorId: string;
  teamId: string;
  userId: string;
  role: MemberRole;
}

export async function updateMemberRole(input: UpdateMemberRoleInput): Promise<TeamMember> {
  if (input.role === 'owner') {
    throw new Error('Use transferOwnership to grant ownership.');
  }
  const { actor, team, membership } = await loadActorAndMembership(
    input.repo, input.teamId, input.actorId,
  );
  if (!canUpdateMemberRole(team, actor, membership)) {
    throw new NotAuthorizedError('Not allowed to change roles in this team');
  }
  const target = await input.repo.getTeamMember(input.teamId, input.userId);
  if (!target) throw new UserNotFoundError('Target is not a member of this team');
  if (target.role === 'owner') {
    throw new Error('Cannot change the owner role via updateMemberRole.');
  }
  return input.repo.updateTeamMemberRole(input.teamId, input.userId, input.role);
}

// ---- removeMember ----

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
      target.role === 'owner'
        ? 'Owners cannot be removed; transfer ownership first.'
        : 'Not allowed to remove this member',
    );
  }

  await input.repo.removeTeamMember(input.teamId, input.userId);
}

// ---- transferOwnership ----

export interface TransferOwnershipInput {
  repo: Repository;
  actorId: string;
  teamId: string;
  toUserId: string;
}

export async function transferOwnership(input: TransferOwnershipInput): Promise<void> {
  const { actor, team } = await loadActorAndMembership(
    input.repo, input.teamId, input.actorId,
  );

  if (!canTransferOwnership(team, actor)) {
    throw new NotAuthorizedError('Only the current owner can transfer ownership');
  }

  // Recipient must already be a member of the team.
  const recipient = await input.repo.getTeamMember(input.teamId, input.toUserId);
  if (!recipient) {
    throw new UserNotFoundError('New owner must be a current team member');
  }

  // Update team owner_id, promote recipient to owner, demote previous owner to admin.
  await input.repo.updateTeam(input.teamId, { ownerId: input.toUserId });
  await input.repo.updateTeamMemberRole(input.teamId, input.toUserId, 'owner');
  await input.repo.updateTeamMemberRole(input.teamId, actor.id, 'admin');
}

// ---- deleteTeam ----

export interface DeleteTeamInput {
  repo: Repository;
  actorId: string;
  teamId: string;
}

export async function deleteTeam(input: DeleteTeamInput): Promise<void> {
  const { actor, team, membership } = await loadActorAndMembership(
    input.repo, input.teamId, input.actorId,
  );
  if (!canDeleteTeam(team, actor, membership)) {
    throw new NotAuthorizedError('Only the owner can delete a team');
  }
  await input.repo.deleteTeam(team.id);
}

// ---- editTeam (name/slug) ----

export interface EditTeamInput {
  repo: Repository;
  actorId: string;
  teamId: string;
  name?: string;
  slug?: string;
}

export async function editTeam(input: EditTeamInput): Promise<Team> {
  const { actor, team, membership } = await loadActorAndMembership(
    input.repo, input.teamId, input.actorId,
  );
  if (!canEditTeam(team, actor, membership)) {
    throw new NotAuthorizedError('Not allowed to edit this team');
  }

  const patch: { name?: string; slug?: string } = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.slug !== undefined) {
    const newSlug = slugSchema.parse(input.slug);
    if (newSlug !== team.slug) {
      const conflict = await input.repo.findTeamBySlug(newSlug);
      if (conflict) throw new TeamSlugTakenError(newSlug);
      patch.slug = newSlug;
    }
  }
  return input.repo.updateTeam(team.id, patch);
}
