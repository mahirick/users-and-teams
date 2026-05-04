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

async function loginAs(app: FastifyInstance, transport: ConsoleTransport, email: string): Promise<string> {
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

  it('full flow: create team → invite → accept → list members → change role → remove', async () => {
    // Owner signs in
    const ownerCookie = await loginAs(ctx.app, ctx.transport, 'owner@example.com');

    // Create team
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/teams',
      payload: { name: 'Eng', slug: 'eng' },
      headers: { cookie: `sess=${ownerCookie}` },
    });
    expect(createRes.statusCode).toBe(201);
    const team = (createRes.json() as { team: { id: string; slug: string } }).team;
    expect(team.slug).toBe('eng');

    // Owner sees it in /teams
    const myRes = await ctx.app.inject({
      method: 'GET',
      url: '/teams',
      headers: { cookie: `sess=${ownerCookie}` },
    });
    const list = (myRes.json() as { teams: Array<{ team: { id: string }; role: string }> }).teams;
    expect(list).toHaveLength(1);
    expect(list[0]!.role).toBe('owner');

    // Invite a guest
    const inviteRes = await ctx.app.inject({
      method: 'POST',
      url: `/teams/${team.id}/invites`,
      payload: { email: 'guest@example.com', role: 'member' },
      headers: { cookie: `sess=${ownerCookie}` },
    });
    expect(inviteRes.statusCode).toBe(201);
    const inviteEmailMsg = ctx.transport.captured[ctx.transport.captured.length - 1]!;
    const inviteToken = inviteEmailMsg.text.match(
      /invites\/accept\?token=([A-Za-z0-9_-]+)/,
    )![1]!;

    // Guest signs in (creates an account)
    const guestCookie = await loginAs(ctx.app, ctx.transport, 'guest@example.com');

    // Guest accepts the invite
    const acceptRes = await ctx.app.inject({
      method: 'GET',
      url: `/teams/invites/accept?token=${inviteToken}`,
      headers: { cookie: `sess=${guestCookie}` },
    });
    expect(acceptRes.statusCode).toBe(200);

    // Members list now has 2
    const teamRes = await ctx.app.inject({
      method: 'GET',
      url: `/teams/${team.id}`,
      headers: { cookie: `sess=${ownerCookie}` },
    });
    const detail = teamRes.json() as { members: unknown[] };
    expect(detail.members).toHaveLength(2);

    // Owner promotes guest to admin
    const guestUserId = (
      (
        teamRes.json() as { members: Array<{ user: { id: string; email: string } }> }
      ).members.find((m) => m.user.email === 'guest@example.com')!.user.id
    );
    const promoteRes = await ctx.app.inject({
      method: 'PATCH',
      url: `/teams/${team.id}/members/${guestUserId}`,
      payload: { role: 'admin' },
      headers: { cookie: `sess=${ownerCookie}` },
    });
    expect(promoteRes.statusCode).toBe(200);
    expect((promoteRes.json() as { member: { role: string } }).member.role).toBe('admin');

    // Owner removes guest
    const rmRes = await ctx.app.inject({
      method: 'DELETE',
      url: `/teams/${team.id}/members/${guestUserId}`,
      headers: { cookie: `sess=${ownerCookie}` },
    });
    expect(rmRes.statusCode).toBe(200);
  });

  it('returns 401 when not signed in', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/teams' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when a non-member tries to read a team detail', async () => {
    const ownerCookie = await loginAs(ctx.app, ctx.transport, 'owner@example.com');
    const team = (
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/teams',
          payload: { name: 'A', slug: 'a' },
          headers: { cookie: `sess=${ownerCookie}` },
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

  it('returns 409 on duplicate slug', async () => {
    const ownerCookie = await loginAs(ctx.app, ctx.transport, 'owner@example.com');
    await ctx.app.inject({
      method: 'POST',
      url: '/teams',
      payload: { name: 'A', slug: 'taken' },
      headers: { cookie: `sess=${ownerCookie}` },
    });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/teams',
      payload: { name: 'B', slug: 'taken' },
      headers: { cookie: `sess=${ownerCookie}` },
    });
    expect(res.statusCode).toBe(409);
  });

  it('returns 403 when a regular member tries to invite', async () => {
    const ownerCookie = await loginAs(ctx.app, ctx.transport, 'owner@example.com');
    const team = (
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/teams',
          payload: { name: 'A', slug: 'a' },
          headers: { cookie: `sess=${ownerCookie}` },
        })
      ).json() as { team: { id: string } }
    ).team;

    // Add a regular member
    await ctx.app.inject({
      method: 'POST',
      url: `/teams/${team.id}/invites`,
      payload: { email: 'm@example.com', role: 'member' },
      headers: { cookie: `sess=${ownerCookie}` },
    });
    const inviteToken = ctx.transport.captured.at(-1)!.text.match(
      /invites\/accept\?token=([A-Za-z0-9_-]+)/,
    )![1]!;
    const memberCookie = await loginAs(ctx.app, ctx.transport, 'm@example.com');
    await ctx.app.inject({
      method: 'GET',
      url: `/teams/invites/accept?token=${inviteToken}`,
      headers: { cookie: `sess=${memberCookie}` },
    });

    // Member tries to invite someone — denied
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/teams/${team.id}/invites`,
      payload: { email: 'guest@example.com', role: 'member' },
      headers: { cookie: `sess=${memberCookie}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
