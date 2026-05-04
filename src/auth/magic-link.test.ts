import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepository } from '../adapters/memory.js';
import { consoleTransport, type ConsoleTransport } from '../email/console.js';
import { requestMagicLink } from './magic-link.js';
import { hashToken } from './tokens.js';

describe('requestMagicLink', () => {
  let repo: ReturnType<typeof createMemoryRepository>;
  let transport: ConsoleTransport;

  beforeEach(() => {
    repo = createMemoryRepository();
    transport = consoleTransport({ captureOnly: true });
  });

  it('stores a hashed magic link and emails the link', async () => {
    await requestMagicLink({
      repo,
      email: 'a@example.com',
      transport,
      siteName: 'App',
      siteUrl: 'https://app.example.com',
      magicLinkTtlMin: 15,
      now: 1_000_000,
    });

    expect(transport.captured).toHaveLength(1);
    const message = transport.captured[0]!;
    expect(message.to).toBe('a@example.com');

    // The email body should contain the verify URL with the token
    const match = message.text.match(/auth\/verify\?token=([A-Za-z0-9_-]+)/);
    expect(match).not.toBeNull();
    const token = match![1]!;

    // The DB should contain the hash of that token, not the token itself
    const link = await repo.findMagicLinkByHash(hashToken(token));
    expect(link).not.toBeNull();
    expect(link!.email).toBe('a@example.com');
    expect(link!.expiresAt).toBe(1_000_000 + 15 * 60_000);
    expect(link!.consumedAt).toBeNull();

    // The raw token should NEVER be stored
    expect(await repo.findMagicLinkByHash(token)).toBeNull();
  });

  it('normalizes email to lowercase before storage and email send', async () => {
    await requestMagicLink({
      repo,
      email: 'Alice@Example.com',
      transport,
      siteName: 'App',
      siteUrl: 'https://app.example.com',
      magicLinkTtlMin: 15,
      now: 0,
    });

    expect(transport.captured[0]!.to).toBe('alice@example.com');
  });

  it('returns ok even for unknown email (no enumeration)', async () => {
    const result = await requestMagicLink({
      repo,
      email: 'unknown@example.com',
      transport,
      siteName: 'App',
      siteUrl: 'https://app.example.com',
      magicLinkTtlMin: 15,
      now: 0,
    });

    expect(result.ok).toBe(true);
    // A magic link IS still issued for unknown emails — verifying creates the user
    expect(transport.captured).toHaveLength(1);
  });

  it('throws RateLimitError when the limiter blocks', async () => {
    const { RateLimitError } = await import('../core/errors.js');
    const { createRateLimiter } = await import('./rate-limit.js');
    const limiter = createRateLimiter({ perEmailPerHour: 1, perIpPerHour: 100 });

    await requestMagicLink({
      repo,
      email: 'a@example.com',
      transport,
      siteName: 'App',
      siteUrl: 'https://app.example.com',
      magicLinkTtlMin: 15,
      now: 0,
      ip: '127.0.0.1',
      rateLimiter: limiter,
    });

    await expect(
      requestMagicLink({
        repo,
        email: 'a@example.com',
        transport,
        siteName: 'App',
        siteUrl: 'https://app.example.com',
        magicLinkTtlMin: 15,
        now: 1,
        ip: '127.0.0.1',
        rateLimiter: limiter,
      }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it('rejects malformed email addresses', async () => {
    await expect(
      requestMagicLink({
        repo,
        email: 'not-an-email',
        transport,
        siteName: 'App',
        siteUrl: 'https://app.example.com',
        magicLinkTtlMin: 15,
        now: 0,
      }),
    ).rejects.toThrow(/email/i);
  });
});
