// Magic-link issuance. Generates a one-time token, hashes it for storage,
// emails the raw token in a verify URL, never stores the raw value.

import { z } from 'zod';
import { RateLimitError } from '../core/errors.js';
import type { Repository } from '../core/repository.js';
import { magicLinkEmail } from '../email/templates.js';
import type { EmailTransport, RenderedEmail } from '../email/types.js';
import type { RateLimiter } from './rate-limit.js';
import { generateToken, hashToken } from './tokens.js';

const emailSchema = z.string().trim().email();

export interface RequestMagicLinkInput {
  repo: Repository;
  email: string;
  transport: EmailTransport;
  siteName: string;
  siteUrl: string;
  magicLinkTtlMin: number;
  now?: number;
  ip?: string;
  rateLimiter?: RateLimiter;
  /** Override the email template (e.g., consumer-supplied). */
  template?: (args: { siteName: string; siteUrl: string; link: string }) => RenderedEmail;
}

export interface RequestMagicLinkResult {
  ok: true;
}

export async function requestMagicLink(
  input: RequestMagicLinkInput,
): Promise<RequestMagicLinkResult> {
  const parsed = emailSchema.safeParse(input.email);
  if (!parsed.success) {
    throw new Error(`Invalid email address: ${input.email}`);
  }
  const email = parsed.data.toLowerCase();
  const now = input.now ?? Date.now();

  if (input.rateLimiter) {
    const result = input.rateLimiter.check({
      email,
      ip: input.ip ?? 'unknown',
      now,
    });
    if (!result.ok) {
      throw new RateLimitError(result.retryAfterSeconds);
    }
  }

  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = now + input.magicLinkTtlMin * 60_000;

  await input.repo.createMagicLink({ tokenHash, email, expiresAt }, now);

  const verifyUrl = new URL('/auth/verify', input.siteUrl);
  verifyUrl.searchParams.set('token', token);
  const link = verifyUrl.toString();

  const rendered = (input.template ?? magicLinkEmail)({
    siteName: input.siteName,
    siteUrl: input.siteUrl,
    link,
  });

  await input.transport.send({
    to: email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });

  return { ok: true };
}
