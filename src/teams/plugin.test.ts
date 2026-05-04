import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { createSqliteRepository } from '../adapters/sqlite.js';
import { runMigrations } from '../migrations/runner.js';
import { consoleTransport, type ConsoleTransport } from '../email/console.js';
import { authPlugin } from '../auth/plugin.js';
import { teamsPlugin } from './plugin.js';

interface Ctx {
  app: FastifyInstance;
  transport: ConsoleTransport;
}

async function makeApp(): Promise<Ctx> {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  const repo = createSqliteRepository(db);
  const transport = consoleTransport({ captureOnly: true });

  const app = Fastify({ logger: false });
  await app.register(authPlugin, {
    repository: repo,
    email: transport,
    siteUrl: 'https://app.example.com',
    siteName: 'App',
    sessionTtlDays: 90,
    cookieName: 'sess',
    rateLimit: false,
  });
  await app.register(teamsPlugin, {
    repository: repo,
    email: transport,
    siteUrl: 'https://app.example.com',
    siteName: 'App',
    inviteTtlDays: 7,
  });
  await app.ready();
  return { app, transport };
}

async function loginAs(
  app: FastifyInstance,
  transport: ConsoleTransport,
  email: string,
): Promise<string> {
  await app.inject({
    method: 'POST',
    url: '/auth/request-link',
    payload: { email },
  });
  const message = transport.captured[transport.captured.length - 1]!;
  const token = message.text.match(/auth\/verify\?token=([A-Za-z0-9_-]+)/)![1]!;
  const verifyRes = await app.inject({ method: 'GET', url: `/auth/verify?token=${token}` });
  const setCookie = verifyRes.headers['set-cookie'] as string | string[];
  const headers = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const h of headers) {
    const m = h.match(/sess=([^;]+)/);
    if (m) return m[1]!;
  }
  throw new Error('No cookie in response');
}

describe('teamsPlugin', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await makeApp();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('full flow: create team → add existing member → list → remove', async () => {
    const adminCookie = await loginAs(ctx.app, ctx.transport, 'admin@example.com');

    // Create team
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/teams',
      payload: { name: 'Eng' },
      headers: { cookie: `sess=${adminCookie}` },
    });
    expect(createRes.statusCode).toBe(201);
    const team = (createRes.json() as { team: { id: string; name: string; nameNormalized: string } }).team;
    expect(team.nameNormalized).toBe('eng');

    // Admin sees it in /teams as 'admin'
    const myRes = await ctx.app.inject({
      method: 'GET',
      url: '/teams',
      headers: { cookie: `sess=${adminCookie}` },
    });
    const list = (myRes.json() as { teams: Array<{ team: { id: string }; role: string }> }).teams;
    expect(list).toHaveLength(1);
    expect(list[0]!.role).toBe('admin');

    // Pre-create another user (so add becomes immediate)
    await loginAs(ctx.app, ctx.transport, 'guest@example.com');

    const addRes = await ctx.app.inject({
      method: 'POST',
      url: `/teams/${team.id}/members`,
      payload: { emails: ['guest@example.com'] },
      headers: { cookie: `sess=${adminCookie}` },
    });
    expect(addRes.statusCode).toBe(207);
    const addBody = addRes.json() as { results: Array<{ status: string }> };
    expect(addBody.results).toHaveLength(1);
    expect(addBody.results[0]!.status).toBe('added');

    // Members list now has 2
    const teamRes = await ctx.app.inject({
      method: 'GET',
      url: `/teams/${team.id}`,
      headers: { cookie: `sess=${adminCookie}` },
    });
    const detail = teamRes.json() as { members: Array<{ user: { id: string; email: string }; member: { role: string } }> };
    expect(detail.members).toHaveLength(2);
    const guest = detail.members.find((m) => m.user.email === 'guest@example.com')!;
    expect(guest.member.role).toBe('user');

    // Admin removes guest
    const rmRes = await ctx.app.inject({
      method: 'DELETE',
      url: `/teams/${team.id}/members/${guest.user.id}`,
      headers: { cookie: `sess=${adminCookie}` },
    });
    expect(rmRes.statusCode).toBe(200);
  });

  it('add-by-email for an unknown user creates a pending invite (no immediate membership)', async () => {
    const adminCookie = await loginAs(ctx.app, ctx.transport, 'admin@example.com');
    const team = (
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/teams',
          payload: { name: 'Engineering' },
          headers: { cookie: `sess=${adminCookie}` },
        })
      ).json() as { team: { id: string } }
    ).team;

    const addRes = await ctx.app.inject({
      method: 'POST',
      url: `/teams/${team.id}/members`,
      payload: { emails: ['newcomer@example.com'] },
      headers: { cookie: `sess=${adminCookie}` },
    });
    expect(addRes.statusCode).toBe(207);
    const addBody = addRes.json() as { results: Array<{ status: string }> };
    expect(addBody.results[0]!.status).toBe('pending_signup');

    // Newcomer signs in for the first time → membership materializes
    const newcomerCookie = await loginAs(ctx.app, ctx.transport, 'newcomer@example.com');
    const myRes = await ctx.app.inject({
      method: 'GET',
      url: '/teams',
      headers: { cookie: `sess=${newcomerCookie}` },
    });
    const list = (myRes.json() as { teams: Array<{ team: { id: string }; role: string }> }).teams;
    expect(list).toHaveLength(1);
    expect(list[0]!.team.id).toBe(team.id);
    expect(list[0]!.role).toBe('user');
  });

  it('returns 401 when not signed in', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/teams' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when a non-member tries to read a team detail', async () => {
    const adminCookie = await loginAs(ctx.app, ctx.transport, 'admin@example.com');
    const team = (
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/teams',
          payload: { name: 'A' },
          headers: { cookie: `sess=${adminCookie}` },
        })
      ).json() as { team: { id: string } }
    ).team;

    const otherCookie = await loginAs(ctx.app, ctx.transport, 'other@example.com');
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/teams/${team.id}`,
      headers: { cookie: `sess=${otherCookie}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 409 on duplicate team name', async () => {
    const adminCookie = await loginAs(ctx.app, ctx.transport, 'admin@example.com');
    await ctx.app.inject({
      method: 'POST',
      url: '/teams',
      payload: { name: 'Taken' },
      headers: { cookie: `sess=${adminCookie}` },
    });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/teams',
      payload: { name: '  TAKEN ' },
      headers: { cookie: `sess=${adminCookie}` },
    });
    expect(res.statusCode).toBe(409);
  });

  it('returns 403 when a regular User tries to add another member', async () => {
    const adminCookie = await loginAs(ctx.app, ctx.transport, 'admin@example.com');
    const team = (
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/teams',
          payload: { name: 'A' },
          headers: { cookie: `sess=${adminCookie}` },
        })
      ).json() as { team: { id: string } }
    ).team;

    // Pre-create the User and add them
    await loginAs(ctx.app, ctx.transport, 'm@example.com');
    await ctx.app.inject({
      method: 'POST',
      url: `/teams/${team.id}/members`,
      payload: { emails: ['m@example.com'] },
      headers: { cookie: `sess=${adminCookie}` },
    });

    const memberCookie = await loginAs(ctx.app, ctx.transport, 'm@example.com');
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/teams/${team.id}/members`,
      payload: { emails: ['guest@example.com'] },
      headers: { cookie: `sess=${memberCookie}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('multi-add: existing user, unknown email, duplicate, and pre-member in one request', async () => {
    const adminCookie = await loginAs(ctx.app, ctx.transport, 'admin@example.com');
    const team = (
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/teams',
          payload: { name: 'Squad' },
          headers: { cookie: `sess=${adminCookie}` },
        })
      ).json() as { team: { id: string } }
    ).team;
    // Pre-create one user that's already a member, plus another that's just a known user
    await loginAs(ctx.app, ctx.transport, 'already@example.com');
    await ctx.app.inject({
      method: 'POST',
      url: `/teams/${team.id}/members`,
      payload: { emails: ['already@example.com'] },
      headers: { cookie: `sess=${adminCookie}` },
    });
    await loginAs(ctx.app, ctx.transport, 'known@example.com');

    const addRes = await ctx.app.inject({
      method: 'POST',
      url: `/teams/${team.id}/members`,
      payload: {
        emails: [
          'known@example.com',     // existing user → added
          'unknown@example.com',   // pending_signup
          'KNOWN@example.com',     // dedup with known
          'already@example.com',   // ALREADY_MEMBER error
        ],
      },
      headers: { cookie: `sess=${adminCookie}` },
    });
    expect(addRes.statusCode).toBe(207);
    const body = addRes.json() as {
      results: Array<{ email: string; status: string; code?: string }>;
    };
    // Dedup should drop the case-equivalent duplicate
    expect(body.results).toHaveLength(3);
    const byEmail = Object.fromEntries(body.results.map((r) => [r.email, r]));
    expect(byEmail['known@example.com']!.status).toBe('added');
    expect(byEmail['unknown@example.com']!.status).toBe('pending_signup');
    expect(byEmail['already@example.com']!.status).toBe('error');
    expect(byEmail['already@example.com']!.code).toBe('ALREADY_MEMBER');
  });

  it('admin transfer-then-leave: transferAdmin then DELETE self', async () => {
    const adminCookie = await loginAs(ctx.app, ctx.transport, 'admin@example.com');
    const team = (
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/teams',
          payload: { name: 'Acme' },
          headers: { cookie: `sess=${adminCookie}` },
        })
      ).json() as { team: { id: string } }
    ).team;

    // Add a User who can become the new Admin
    await loginAs(ctx.app, ctx.transport, 'heir@example.com');
    await ctx.app.inject({
      method: 'POST',
      url: `/teams/${team.id}/members`,
      payload: { emails: ['heir@example.com'] },
      headers: { cookie: `sess=${adminCookie}` },
    });
    // Find the heir's user id
    const detail = (
      (
        await ctx.app.inject({
          method: 'GET',
          url: `/teams/${team.id}`,
          headers: { cookie: `sess=${adminCookie}` },
        })
      ).json() as { members: Array<{ user: { id: string; email: string } }> }
    );
    const heirId = detail.members.find((m) => m.user.email === 'heir@example.com')!.user.id;

    // Original admin tries to leave → 403
    const adminSelf = (
      (
        await ctx.app.inject({
          method: 'GET',
          url: '/auth/me',
          headers: { cookie: `sess=${adminCookie}` },
        })
      ).json() as { user: { id: string } }
    ).user;
    const cannotLeave = await ctx.app.inject({
      method: 'DELETE',
      url: `/teams/${team.id}/members/${adminSelf.id}`,
      headers: { cookie: `sess=${adminCookie}` },
    });
    expect(cannotLeave.statusCode).toBe(403);

    // Transfer admin to heir
    const transferRes = await ctx.app.inject({
      method: 'POST',
      url: `/teams/${team.id}/transfer-admin`,
      payload: { toUserId: heirId },
      headers: { cookie: `sess=${adminCookie}` },
    });
    expect(transferRes.statusCode).toBe(200);

    // Now original admin can leave (they're a User now)
    const canLeave = await ctx.app.inject({
      method: 'DELETE',
      url: `/teams/${team.id}/members/${adminSelf.id}`,
      headers: { cookie: `sess=${adminCookie}` },
    });
    expect(canLeave.statusCode).toBe(200);
  });
});
