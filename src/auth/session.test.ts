import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepository } from '../adapters/memory.js';
import {
  InvalidTokenError,
  TokenAlreadyConsumedError,
  TokenExpiredError,
  UserSuspendedError,
} from '../core/errors.js';
import {
  revokeAllSessionsForUser,
  revokeSession,
  verifyMagicLinkAndCreateSession,
  verifySession,
} from './session.js';
import { generateToken, hashToken } from './tokens.js';

describe('verifyMagicLinkAndCreateSession', () => {
  let repo: ReturnType<typeof createMemoryRepository>;
  const T0 = 1_700_000_000_000;
  const TTL_DAYS = 90;

  beforeEach(() => {
    repo = createMemoryRepository();
  });

  async function seedLink(email: string, opts: { expiresAt?: number; now?: number } = {}) {
    const token = generateToken();
    const now = opts.now ?? T0;
    await repo.createMagicLink(
      {
        tokenHash: hashToken(token),
        email,
        expiresAt: opts.expiresAt ?? now + 15 * 60_000,
      },
      now,
    );
    return token;
  }

  it('creates a new user with role=user when email is not in adminEmails', async () => {
    const token = await seedLink('newbie@example.com');
    const result = await verifyMagicLinkAndCreateSession({
      repo,
      token,
      adminEmails: ['admin@example.com'],
      sessionTtlDays: TTL_DAYS,
      now: T0 + 1000,
    });

    expect(result.user.email).toBe('newbie@example.com');
    expect(result.user.role).toBe('user');
    expect(result.sessionToken).toBeTruthy();
  });

  it('creates a new user with role=admin when email is in adminEmails', async () => {
    const token = await seedLink('admin@example.com');
    const result = await verifyMagicLinkAndCreateSession({
      repo,
      token,
      adminEmails: ['ADMIN@example.com'], // case-insensitive match
      sessionTtlDays: TTL_DAYS,
      now: T0 + 1000,
    });

    expect(result.user.role).toBe('admin');
  });

  it('loads an existing user if the email already has an account', async () => {
    const existing = await repo.createUser(
      { email: 'returning@example.com', displayName: 'Old Name' },
      T0,
    );
    const token = await seedLink('returning@example.com');

    const result = await verifyMagicLinkAndCreateSession({
      repo,
      token,
      adminEmails: [],
      sessionTtlDays: TTL_DAYS,
      now: T0 + 1000,
    });

    expect(result.user.id).toBe(existing.id);
    expect(result.user.displayName).toBe('Old Name');
  });

  it('marks the magic link consumed', async () => {
    const token = await seedLink('a@example.com');
    await verifyMagicLinkAndCreateSession({
      repo,
      token,
      adminEmails: [],
      sessionTtlDays: TTL_DAYS,
      now: T0 + 1000,
    });
    const link = await repo.findMagicLinkByHash(hashToken(token));
    expect(link!.consumedAt).toBe(T0 + 1000);
  });

  it('issues a session with sliding expiry', async () => {
    const token = await seedLink('a@example.com');
    const result = await verifyMagicLinkAndCreateSession({
      repo,
      token,
      adminEmails: [],
      sessionTtlDays: 90,
      now: T0,
    });
    const session = await repo.findSessionByHash(hashToken(result.sessionToken));
    expect(session).not.toBeNull();
    expect(session!.expiresAt).toBe(T0 + 90 * 86_400_000);
  });

  it('throws InvalidTokenError for an unknown token', async () => {
    await expect(
      verifyMagicLinkAndCreateSession({
        repo,
        token: 'never-issued',
        adminEmails: [],
        sessionTtlDays: TTL_DAYS,
        now: T0,
      }),
    ).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('throws TokenAlreadyConsumedError on second use', async () => {
    const token = await seedLink('a@example.com');
    await verifyMagicLinkAndCreateSession({
      repo,
      token,
      adminEmails: [],
      sessionTtlDays: TTL_DAYS,
      now: T0,
    });
    await expect(
      verifyMagicLinkAndCreateSession({
        repo,
        token,
        adminEmails: [],
        sessionTtlDays: TTL_DAYS,
        now: T0 + 1000,
      }),
    ).rejects.toBeInstanceOf(TokenAlreadyConsumedError);
  });

  it('throws TokenExpiredError when the link is past its expiry', async () => {
    const token = await seedLink('a@example.com', { expiresAt: T0 + 1, now: T0 });
    await expect(
      verifyMagicLinkAndCreateSession({
        repo,
        token,
        adminEmails: [],
        sessionTtlDays: TTL_DAYS,
        now: T0 + 100,
      }),
    ).rejects.toBeInstanceOf(TokenExpiredError);
  });

  it('blocks login for suspended users', async () => {
    const u = await repo.createUser({ email: 'sus@example.com' }, T0);
    await repo.updateUser(u.id, { status: 'suspended' });
    const token = await seedLink('sus@example.com');

    await expect(
      verifyMagicLinkAndCreateSession({
        repo,
        token,
        adminEmails: [],
        sessionTtlDays: TTL_DAYS,
        now: T0 + 1000,
      }),
    ).rejects.toBeInstanceOf(UserSuspendedError);
  });
});

describe('verifySession', () => {
  let repo: ReturnType<typeof createMemoryRepository>;
  const T0 = 1_700_000_000_000;

  beforeEach(() => {
    repo = createMemoryRepository();
  });

  it('returns the user and bumps last_used_at + expires_at', async () => {
    const u = await repo.createUser({ email: 'a@example.com' }, T0);
    const sessionToken = generateToken();
    await repo.createSession(
      { tokenHash: hashToken(sessionToken), userId: u.id, expiresAt: T0 + 1_000 },
      T0,
    );

    const verified = await verifySession({
      repo,
      sessionToken,
      sessionTtlDays: 90,
      now: T0 + 500,
    });

    expect(verified!.id).toBe(u.id);

    const session = await repo.findSessionByHash(hashToken(sessionToken));
    expect(session!.lastUsedAt).toBe(T0 + 500);
    expect(session!.expiresAt).toBe(T0 + 500 + 90 * 86_400_000);
  });

  it('returns null and deletes the session if expired', async () => {
    const u = await repo.createUser({ email: 'a@example.com' }, T0);
    const sessionToken = generateToken();
    await repo.createSession(
      { tokenHash: hashToken(sessionToken), userId: u.id, expiresAt: T0 + 1 },
      T0,
    );

    const verified = await verifySession({
      repo,
      sessionToken,
      sessionTtlDays: 90,
      now: T0 + 100,
    });
    expect(verified).toBeNull();
    expect(await repo.findSessionByHash(hashToken(sessionToken))).toBeNull();
  });

  it('returns null for a token that does not match any session', async () => {
    expect(
      await verifySession({
        repo,
        sessionToken: 'never-issued',
        sessionTtlDays: 90,
        now: T0,
      }),
    ).toBeNull();
  });

  it('returns null for a suspended user and deletes their sessions', async () => {
    const u = await repo.createUser({ email: 'sus@example.com' }, T0);
    const sessionToken = generateToken();
    await repo.createSession(
      { tokenHash: hashToken(sessionToken), userId: u.id, expiresAt: T0 + 1_000_000 },
      T0,
    );

    await repo.updateUser(u.id, { status: 'suspended' });

    const verified = await verifySession({
      repo,
      sessionToken,
      sessionTtlDays: 90,
      now: T0 + 100,
    });
    expect(verified).toBeNull();
    expect(await repo.findSessionByHash(hashToken(sessionToken))).toBeNull();
  });
});

describe('revokeSession + revokeAllSessionsForUser', () => {
  let repo: ReturnType<typeof createMemoryRepository>;
  const T0 = 1_700_000_000_000;

  beforeEach(() => {
    repo = createMemoryRepository();
  });

  it('revokeSession deletes that session only', async () => {
    const u = await repo.createUser({ email: 'a@example.com' }, T0);
    const t1 = generateToken();
    const t2 = generateToken();
    await repo.createSession(
      { tokenHash: hashToken(t1), userId: u.id, expiresAt: T0 + 1_000_000 },
      T0,
    );
    await repo.createSession(
      { tokenHash: hashToken(t2), userId: u.id, expiresAt: T0 + 1_000_000 },
      T0,
    );

    await revokeSession({ repo, sessionToken: t1 });
    expect(await repo.findSessionByHash(hashToken(t1))).toBeNull();
    expect(await repo.findSessionByHash(hashToken(t2))).not.toBeNull();
  });

  it('revokeAllSessionsForUser nukes every session', async () => {
    const u = await repo.createUser({ email: 'a@example.com' }, T0);
    for (let i = 0; i < 3; i++) {
      const tok = generateToken();
      await repo.createSession(
        { tokenHash: hashToken(tok), userId: u.id, expiresAt: T0 + 1_000_000 },
        T0,
      );
    }
    const removed = await revokeAllSessionsForUser({ repo, userId: u.id });
    expect(removed).toBe(3);
  });
});
