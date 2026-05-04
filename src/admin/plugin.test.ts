import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { createSqliteRepository } from '../adapters/sqlite.js';
import { runMigrations } from '../migrations/runner.js';
import { consoleTransport, type ConsoleTransport } from '../email/console.js';
import { authPlugin } from '../auth/plugin.js';
import { adminPlugin } from './plugin.js';

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
    cookieName: 'sess',
    rateLimit: false,
    adminEmails: ['admin@example.com'],
  });
  await app.register(adminPlugin, { repository: repo });
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
  throw new Error('No cookie');
}

describe('adminPlugin', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await makeApp();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('admin can list users', async () => {
    const adminCookie = await loginAs(ctx.app, ctx.transport, 'admin@example.com');
    await loginAs(ctx.app, ctx.transport, 'user1@example.com');
    await loginAs(ctx.app, ctx.transport, 'user2@example.com');

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { cookie: `sess=${adminCookie}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { total: number; users: unknown[] };
    expect(body.total).toBe(3);
  });

  it('non-admin gets 403', async () => {
    const userCookie = await loginAs(ctx.app, ctx.transport, 'user@example.com');
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { cookie: `sess=${userCookie}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('unauthenticated gets 401', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/admin/users' });
    expect(res.statusCode).toBe(401);
  });

  it('admin can suspend a user; their session is revoked', async () => {
    const adminCookie = await loginAs(ctx.app, ctx.transport, 'admin@example.com');
    const targetCookie = await loginAs(ctx.app, ctx.transport, 'target@example.com');

    // Find target user id
    const usersRes = await ctx.app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { cookie: `sess=${adminCookie}` },
    });
    const target = (usersRes.json() as { users: Array<{ id: string; email: string }> }).users.find(
      (u) => u.email === 'target@example.com',
    )!;

    const suspendRes = await ctx.app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/suspend`,
      headers: { cookie: `sess=${adminCookie}` },
    });
    expect(suspendRes.statusCode).toBe(200);

    // Target's old cookie no longer authenticates
    const meRes = await ctx.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: `sess=${targetCookie}` },
    });
    expect(meRes.statusCode).toBe(401);
  });

  it('admin can update display name + role', async () => {
    const adminCookie = await loginAs(ctx.app, ctx.transport, 'admin@example.com');
    const targetCookie = await loginAs(ctx.app, ctx.transport, 'target@example.com');
    void targetCookie;

    const usersRes = await ctx.app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { cookie: `sess=${adminCookie}` },
    });
    const target = (usersRes.json() as { users: Array<{ id: string; email: string }> }).users.find(
      (u) => u.email === 'target@example.com',
    )!;

    const patchRes = await ctx.app.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}`,
      payload: { displayName: 'Renamed', role: 'admin' },
      headers: { cookie: `sess=${adminCookie}` },
    });
    expect(patchRes.statusCode).toBe(200);
    const body = patchRes.json() as { user: { displayName: string; role: string } };
    expect(body.user.displayName).toBe('Renamed');
    expect(body.user.role).toBe('admin');
  });

  it('admin sees audit entries for their own actions', async () => {
    const adminCookie = await loginAs(ctx.app, ctx.transport, 'admin@example.com');
    const targetCookie = await loginAs(ctx.app, ctx.transport, 'target@example.com');
    void targetCookie;

    const usersRes = await ctx.app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { cookie: `sess=${adminCookie}` },
    });
    const target = (usersRes.json() as { users: Array<{ id: string; email: string }> }).users.find(
      (u) => u.email === 'target@example.com',
    )!;

    await ctx.app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/suspend`,
      headers: { cookie: `sess=${adminCookie}` },
    });

    const auditRes = await ctx.app.inject({
      method: 'GET',
      url: '/admin/audit-log',
      headers: { cookie: `sess=${adminCookie}` },
    });
    const entries = (auditRes.json() as { entries: Array<{ action: string }> }).entries;
    expect(entries.some((e) => e.action === 'user.suspend')).toBe(true);
  });
});
