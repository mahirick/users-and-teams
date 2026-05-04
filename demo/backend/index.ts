// Tiny Fastify backend for the demo app. Exercises the package end-to-end.
//
// Run: npm run demo:backend
//
// Configure via demo/backend/.env (copy from .env.example).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import Database from 'better-sqlite3';
import {
  adminPlugin,
  authPlugin,
  consoleTransport,
  createSqliteRepository,
  resendTransport,
  runMigrations,
  teamsPlugin,
  type EmailTransport,
} from '../../src/index.js';

// Minimal .env loader so demo doesn't need dotenv as a dep.
function loadEnv(path: string): void {
  try {
    const text = readFileSync(path, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // No .env — fall through to defaults
  }
}

loadEnv(resolve(process.cwd(), 'demo/backend/.env'));

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const dbPath = process.env.DB_PATH ?? './demo/backend/demo.db';
const siteUrl = process.env.SITE_URL ?? 'http://localhost:5173';
const siteName = process.env.SITE_NAME ?? 'Demo App';
const ownerEmails = (process.env.OWNER_EMAILS ?? process.env.ADMIN_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean);
const cookieName = process.env.COOKIE_NAME ?? 'uat_demo_session';

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
runMigrations(db);

const repository = createSqliteRepository(db);

let email: EmailTransport;
if (process.env.EMAIL_TRANSPORT === 'resend') {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    throw new Error('EMAIL_TRANSPORT=resend requires RESEND_API_KEY and EMAIL_FROM');
  }
  email = resendTransport({
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM,
  });
} else {
  // Default: console transport. Logs the verify link so you can paste it into the browser.
  email = consoleTransport();
}

const app = Fastify({ logger: { level: 'info' } });

await app.register(fastifyCors, {
  origin: siteUrl, // The Vite dev server origin
  credentials: true, // Allow cookies cross-origin (Vite is on a different port)
});

await app.register(authPlugin, {
  repository,
  email,
  siteUrl,
  siteName,
  ownerEmails,
  cookieName,
  cookieSecure: false, // dev only — flip to true in production
  // After verify, redirect back to the SPA's verify-result route
  verifySuccessRedirect: `${siteUrl}/verify-result?status=success`,
  verifyErrorRedirect: `${siteUrl}/verify-result?status=error`,
});

await app.register(teamsPlugin, {
  repository,
  email,
  siteUrl,
  siteName,
  inviteTtlDays: 7,
});

await app.register(adminPlugin, { repository });

// Sample protected route — proves request.user works in consumer-defined routes.
app.get('/api/hello', async (req) => ({
  message: req.user ? `Hello, ${req.user.displayName ?? req.user.email}!` : 'Hello, stranger.',
  user: req.user,
}));

await app.listen({ port, host });
console.log(`Demo backend listening on http://${host}:${port}`);
console.log(`Site URL: ${siteUrl}`);
console.log(`Owner emails: ${ownerEmails.length ? ownerEmails.join(', ') : '(none)'}`);
