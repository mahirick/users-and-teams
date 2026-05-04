// Fastify plugin that wires the auth module into a consumer's app.
// Registers @fastify/cookie, decorates request.user, and exposes:
//   POST /auth/request-link
//   GET  /auth/verify
//   POST /auth/logout
//   POST /auth/logout-all
//   GET  /auth/me

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import fastifyCookie from '@fastify/cookie';
import { z } from 'zod';
import {
  InvalidTokenError,
  RateLimitError,
  TokenAlreadyConsumedError,
  TokenExpiredError,
  UserSuspendedError,
  UsersAndTeamsError,
} from '../core/errors.js';
import { mapUatError } from '../core/error-handler.js';
import type { Repository } from '../core/repository.js';
import type { User } from '../core/types.js';
import type { EmailTransport, RenderedEmail } from '../email/types.js';
import { requestMagicLink } from './magic-link.js';
import { createRateLimiter, type RateLimitConfig, type RateLimiter } from './rate-limit.js';
import {
  revokeAllSessionsForUser,
  revokeSession,
  verifyMagicLinkAndCreateSession,
  verifySession,
} from './session.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
  interface FastifyInstance {
    /** Convenience: throws 401 if request.user is null. */
    requireUser: (req: FastifyRequest) => User;
  }
}

export interface AuthPluginOptions {
  repository: Repository;
  email: EmailTransport;
  siteUrl: string;
  siteName: string;
  adminEmails?: string[];
  cookieName?: string;
  cookieDomain?: string;
  /** Override for tests. Defaults to true in production (set per NODE_ENV). */
  cookieSecure?: boolean;
  cookieSameSite?: 'lax' | 'strict' | 'none';
  sessionTtlDays?: number;
  magicLinkTtlMin?: number;
  rateLimit?: RateLimitConfig | false;
  /** Override the rate limiter (for tests or shared instances). */
  rateLimiter?: RateLimiter;
  /** Optional template overrides. */
  magicLinkTemplate?: (args: {
    siteName: string;
    siteUrl: string;
    link: string;
  }) => RenderedEmail;
  /** Where to redirect after a successful verify. Default: `${siteUrl}/auth/verify-result?status=success`. */
  verifySuccessRedirect?: string;
  /** Where to redirect after a failed verify. Default: `${siteUrl}/auth/verify-result?status=error&reason=<code>`. */
  verifyErrorRedirect?: string;
}

const requestLinkSchema = z.object({
  email: z.string().trim().email(),
});

const verifyQuerySchema = z.object({
  token: z.string().min(1),
});

const authPluginAsync: FastifyPluginAsync<AuthPluginOptions> = async (
  fastify: FastifyInstance,
  options: AuthPluginOptions,
) => {
  const cookieName = options.cookieName ?? 'uat_session';
  const cookieDomain = options.cookieDomain;
  const cookieSecure =
    options.cookieSecure ?? (process.env.NODE_ENV === 'production');
  const cookieSameSite = options.cookieSameSite ?? 'lax';
  const sessionTtlDays = options.sessionTtlDays ?? 90;
  const magicLinkTtlMin = options.magicLinkTtlMin ?? 15;
  const adminEmails = options.adminEmails ?? [];

  // Rate limiter: pass `false` to disable; otherwise build from config.
  const limiter: RateLimiter | undefined =
    options.rateLimit === false
      ? undefined
      : (options.rateLimiter ??
          createRateLimiter(
            options.rateLimit ?? { perEmailPerHour: 5, perIpPerHour: 20 },
          ));

  // ---- @fastify/cookie ----
  // Idempotent — if the consumer already registered, fastify-plugin scopes it.
  await fastify.register(fastifyCookie);

  // ---- shared error handler ----
  // Maps every typed package error to a sensible status code. Set here (not in
  // teams/admin plugins) so there's only one setErrorHandler call per scope —
  // avoids Fastify's FSTWRN004 warning. Consumers who want their own handler
  // can register it AFTER our plugins; Fastify's last-wins behavior lets them
  // override (and they can call mapUatError(err) to delegate package errors).
  fastify.setErrorHandler((err, _req, reply) => {
    const mapped = mapUatError(err);
    if (mapped) {
      reply.code(mapped.statusCode);
      if (mapped.headers) {
        for (const [k, v] of Object.entries(mapped.headers)) reply.header(k, v);
      }
      return mapped.body;
    }
    fastify.log.error(err);
    const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
    const message = err instanceof Error ? err.message : 'Unknown error';
    reply.code(statusCode);
    return { error: 'internal_error', message };
  });

  // ---- preHandler: populate request.user from cookie ----
  fastify.decorateRequest('user', null);
  fastify.addHook('onRequest', async (req) => {
    req.user = null;
    const token = req.cookies[cookieName];
    if (!token) return;

    const user = await verifySession({
      repo: options.repository,
      sessionToken: token,
      sessionTtlDays,
    });
    if (user) {
      req.user = user;
    }
  });

  // Helper for protected routes
  fastify.decorate('requireUser', (req: FastifyRequest): User => {
    if (!req.user) {
      const err: Error & { statusCode?: number } = new Error('Authentication required');
      err.statusCode = 401;
      throw err;
    }
    return req.user;
  });

  // ---- POST /auth/request-link ----
  fastify.post('/auth/request-link', async (req, reply) => {
    const parsed = requestLinkSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_email' };
    }

    try {
      await requestMagicLink({
        repo: options.repository,
        email: parsed.data.email,
        transport: options.email,
        siteName: options.siteName,
        siteUrl: options.siteUrl,
        magicLinkTtlMin,
        rateLimiter: limiter,
        ip: req.ip,
        ...(options.magicLinkTemplate ? { template: options.magicLinkTemplate } : {}),
      });
      return { ok: true };
    } catch (err) {
      if (err instanceof RateLimitError) {
        reply.code(429);
        reply.header('Retry-After', err.retryAfterSeconds.toString());
        return { error: 'rate_limited', retryAfter: err.retryAfterSeconds };
      }
      throw err;
    }
  });

  // ---- GET /auth/verify ----
  fastify.get('/auth/verify', async (req, reply) => {
    const parsed = verifyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const url = errorRedirect(options, 'invalid_request');
      reply.redirect(url, 302);
      return;
    }

    try {
      const result = await verifyMagicLinkAndCreateSession({
        repo: options.repository,
        token: parsed.data.token,
        adminEmails,
        sessionTtlDays,
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      });

      // Set HttpOnly cookie
      reply.setCookie(cookieName, result.sessionToken, {
        path: '/',
        httpOnly: true,
        secure: cookieSecure,
        sameSite: cookieSameSite,
        maxAge: sessionTtlDays * 86_400,
        ...(cookieDomain ? { domain: cookieDomain } : {}),
      });

      reply.redirect(successRedirect(options), 302);
      return;
    } catch (err) {
      const reason = errorReason(err);
      reply.redirect(errorRedirect(options, reason), 302);
      return;
    }
  });

  // ---- POST /auth/logout ----
  fastify.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[cookieName];
    if (token) {
      await revokeSession({ repo: options.repository, sessionToken: token });
    }
    reply.clearCookie(cookieName, {
      path: '/',
      ...(cookieDomain ? { domain: cookieDomain } : {}),
    });
    return { ok: true };
  });

  // ---- POST /auth/logout-all ----
  fastify.post('/auth/logout-all', async (req, reply) => {
    if (!req.user) {
      reply.code(401);
      return { error: 'unauthenticated' };
    }
    await revokeAllSessionsForUser({
      repo: options.repository,
      userId: req.user.id,
    });
    reply.clearCookie(cookieName, {
      path: '/',
      ...(cookieDomain ? { domain: cookieDomain } : {}),
    });
    return { ok: true };
  });

  // ---- GET /auth/me ----
  fastify.get('/auth/me', async (req, reply) => {
    if (!req.user) {
      reply.code(401);
      return { user: null };
    }
    return {
      user: {
        id: req.user.id,
        email: req.user.email,
        displayName: req.user.displayName,
        role: req.user.role,
      },
    };
  });
};

function successRedirect(options: AuthPluginOptions): string {
  if (options.verifySuccessRedirect) return options.verifySuccessRedirect;
  return new URL('/auth/verify-result?status=success', options.siteUrl).toString();
}

function errorRedirect(options: AuthPluginOptions, reason: string): string {
  if (options.verifyErrorRedirect) {
    const url = new URL(options.verifyErrorRedirect);
    url.searchParams.set('reason', reason);
    return url.toString();
  }
  const url = new URL('/auth/verify-result', options.siteUrl);
  url.searchParams.set('status', 'error');
  url.searchParams.set('reason', reason);
  return url.toString();
}

function errorReason(err: unknown): string {
  if (err instanceof InvalidTokenError) return 'invalid_token';
  if (err instanceof TokenAlreadyConsumedError) return 'already_used';
  if (err instanceof TokenExpiredError) return 'expired';
  if (err instanceof UserSuspendedError) return 'suspended';
  if (err instanceof UsersAndTeamsError) return err.code.toLowerCase();
  return 'unknown';
}

export const authPlugin = fp(authPluginAsync, {
  name: 'users-and-teams-auth',
  fastify: '5.x',
});
