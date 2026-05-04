// Session lifecycle: verify a magic-link token and mint a session, verify
// session tokens on subsequent requests, revoke them on logout. Sliding
// expiry per spec — every authenticated request bumps last_used_at and
// expires_at.
//
// On magic-link verify, after the user is materialized, we run
// consumePendingInvitesForUser to auto-add them to any teams they were added
// to before they had an account.

import {
  InvalidTokenError,
  TokenAlreadyConsumedError,
  TokenExpiredError,
  UserSuspendedError,
} from '../core/errors.js';
import { deriveInitials, pickColor } from '../core/avatar.js';
import type { Repository } from '../core/repository.js';
import type { User } from '../core/types.js';
import { generateToken, hashToken } from './tokens.js';
import { consumePendingInvitesForUser } from '../teams/operations.js';

const DAY_MS = 86_400_000;

export interface VerifyMagicLinkInput {
  repo: Repository;
  token: string;
  ownerEmails: string[];
  sessionTtlDays: number;
  now?: number;
  ip?: string | null;
  userAgent?: string | null;
}

export interface VerifyMagicLinkResult {
  user: User;
  sessionToken: string;
}

export async function verifyMagicLinkAndCreateSession(
  input: VerifyMagicLinkInput,
): Promise<VerifyMagicLinkResult> {
  const now = input.now ?? Date.now();
  const tokenHash = hashToken(input.token);

  const link = await input.repo.findMagicLinkByHash(tokenHash);
  if (!link) throw new InvalidTokenError('Magic link not found');
  if (link.consumedAt !== null) throw new TokenAlreadyConsumedError();
  if (link.expiresAt < now) throw new TokenExpiredError('Magic link expired');

  const ownerSet = new Set(input.ownerEmails.map((e) => e.toLowerCase()));
  const isOwner = ownerSet.has(link.email);

  // Find or create the user
  let user = await input.repo.findUserByEmail(link.email);
  if (!user) {
    const displayName = defaultDisplayName(link.email);
    // Pre-compute avatar from displayName + soon-to-be-assigned id is impossible —
    // adapter generates the id. Use a temporary placeholder, then patch with the
    // real id-derived color after creation.
    user = await input.repo.createUser(
      {
        email: link.email,
        role: isOwner ? 'owner' : 'user',
        displayName,
        avatarColor: '#525252',
        avatarInitials: deriveInitials({ displayName, email: link.email }),
      },
      now,
    );
    user = await input.repo.updateUser(user.id, {
      avatarColor: pickColor(user.id),
    });
  } else if (isOwner && user.role !== 'owner') {
    // Email was added to ownerEmails after the user was created. Promote them.
    user = await input.repo.updateUser(user.id, { role: 'owner' });
  }

  if (user.status === 'suspended' || user.status === 'deleted') {
    throw new UserSuspendedError();
  }

  // Mark the link consumed (single-use)
  await input.repo.consumeMagicLink(tokenHash, now);

  // Materialize any pending team memberships for this user's email.
  await consumePendingInvitesForUser({ repo: input.repo, user, now });

  // Issue session
  const sessionToken = generateToken();
  await input.repo.createSession(
    {
      tokenHash: hashToken(sessionToken),
      userId: user.id,
      expiresAt: now + input.sessionTtlDays * DAY_MS,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    },
    now,
  );

  // Bump last seen
  await input.repo.updateUser(user.id, { lastSeenAt: now });

  return { user, sessionToken };
}

export interface VerifySessionInput {
  repo: Repository;
  sessionToken: string;
  sessionTtlDays: number;
  now?: number;
}

export async function verifySession(
  input: VerifySessionInput,
): Promise<User | null> {
  const now = input.now ?? Date.now();
  const tokenHash = hashToken(input.sessionToken);

  const session = await input.repo.findSessionByHash(tokenHash);
  if (!session) return null;

  if (session.expiresAt < now) {
    await input.repo.deleteSession(tokenHash);
    return null;
  }

  const user = await input.repo.getUser(session.userId);
  if (!user) {
    // Cascade should have removed it, but be defensive
    await input.repo.deleteSession(tokenHash);
    return null;
  }

  if (user.status !== 'active') {
    // Suspended or deleted — clean up sessions and refuse access
    await input.repo.deleteSessionsForUser(user.id);
    return null;
  }

  // Sliding refresh
  const newExpiresAt = now + input.sessionTtlDays * DAY_MS;
  await input.repo.bumpSession(tokenHash, now, newExpiresAt);

  return user;
}

export interface RevokeSessionInput {
  repo: Repository;
  sessionToken: string;
}

export async function revokeSession(input: RevokeSessionInput): Promise<void> {
  await input.repo.deleteSession(hashToken(input.sessionToken));
}

export interface RevokeAllSessionsInput {
  repo: Repository;
  userId: string;
}

export async function revokeAllSessionsForUser(
  input: RevokeAllSessionsInput,
): Promise<number> {
  return input.repo.deleteSessionsForUser(input.userId);
}

function defaultDisplayName(email: string): string {
  const local = email.split('@')[0] ?? '';
  return local.replace(/[._-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}
