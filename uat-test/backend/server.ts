// Real consumer of @mahirick/users-and-teams. Imports come from npm
// (resolved via the file:.. dep), not from the package source — so this is
// what an external consumer's wire-up actually looks like.

import { resolve } from 'node:path';
import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Database from 'better-sqlite3';
import {
  adminPlugin,
  authPlugin,
  consoleTransport,
  createFsAvatarStore,
  createSqliteRepository,
  resendTransport,
  runMigrations,
  teamsPlugin,
} from '@mahirick/users-and-teams';

const PORT = Number(process.env.PORT ?? 3100);
const SITE_URL = process.env.SITE_URL ?? 'http://localhost:5273';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? 'admin@test.local')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean);

const email =
  process.env.RESEND_API_KEY && process.env.RESEND_FROM
    ? resendTransport({
        apiKey: process.env.RESEND_API_KEY,
        from: process.env.RESEND_FROM,
      })
    : consoleTransport();

const avatarsDir = resolve('./backend/avatars');
const avatarStore = createFsAvatarStore({
  baseDir: avatarsDir,
  urlPrefix: '/avatars',
});

const db = new Database('./backend/test.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
runMigrations(db);

const app = Fastify({ logger: { level: 'info' }, bodyLimit: 4 * 1024 * 1024 });

await app.register(fastifyCors, {
  origin: SITE_URL,
  credentials: true,
});

await app.register(fastifyStatic, {
  root: avatarsDir,
  prefix: '/avatars/',
  decorateReply: false,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'public, max-age=300');
  },
});

await app.register(authPlugin, {
  repository: createSqliteRepository(db),
  email,
  siteUrl: SITE_URL,
  siteName: 'UAT Test',
  ownerEmails: ADMIN_EMAILS,
  cookieName: 'uat_test_session',
  cookieSecure: false,
  verifySuccessRedirect: `${SITE_URL}/verify-result?status=success`,
  verifyErrorRedirect: `${SITE_URL}/verify-result?status=error`,
  avatarStore,
});

await app.register(teamsPlugin, {
  repository: createSqliteRepository(db),
  email,
  siteUrl: SITE_URL,
  siteName: 'UAT Test',
  avatarStore,
});

await app.register(adminPlugin, { repository: createSqliteRepository(db) });

app.get('/api/whoami', async (req) => ({
  message: req.user ? `Hi ${req.user.displayName ?? req.user.email}` : 'You are anonymous',
  user: req.user,
}));

await app.listen({ port: PORT, host: '127.0.0.1' });
console.log(`uat-test backend on http://127.0.0.1:${PORT}`);
console.log(`SITE_URL: ${SITE_URL}`);
console.log(`ADMIN_EMAILS: ${ADMIN_EMAILS.join(', ')}`);
console.log(`Avatars: ${avatarsDir} → /avatars`);
