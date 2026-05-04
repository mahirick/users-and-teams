# Integrating `@mahirick/users-and-teams`

> **Audience:** AI coding agents (Claude Code, Cursor, Codex, etc.) and the developers driving them, integrating this package into a new or existing app — e.g. ScoreTracker, an internal tool, or a side project. If that's you: read this top to bottom before writing wiring code. The whole document is < 10 minutes.
>
> **What this package gives you:** a self-hosted user/auth/teams/admin backend that drops into Fastify, plus a React UI. After integration, your app has working sign-in, team membership, role-based access, audit logging, and avatars — without you writing any of it.

---

## TL;DR — the 8-line backend skeleton

```ts
// src/server.ts (or wherever your Fastify app lives)
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import {
  authPlugin, teamsPlugin, adminPlugin,
  createSqliteRepository, runMigrations,
  consoleTransport,           // dev; swap for resendTransport / smtpTransport in prod
} from '@mahirick/users-and-teams';

const db = new Database('./app.db');
db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
runMigrations(db);

const repository = createSqliteRepository(db);
const app = Fastify();

await app.register(authPlugin,  { repository, email: consoleTransport(), siteUrl: 'http://localhost:3000', siteName: 'My App', ownerEmails: ['me@example.com'] });
await app.register(teamsPlugin, { repository, email: consoleTransport(), siteUrl: 'http://localhost:3000', siteName: 'My App' });
await app.register(adminPlugin, { repository });

await app.listen({ port: 3000 });
```

Your app now has `/auth/*`, `/teams/*`, `/admin/*`, plus `request.user` decorated on every handler you write afterward.

---

## Install

The package isn't on the public npm registry yet. Install directly from GitHub — npm clones the repo, runs the `prepare` script which builds `dist/` on your machine, and you're set.

### Production (recommended): pin to a commit SHA

```bash
# Pin to the v2.0.2 commit (canonical pin format — never moves)
npm install \
  github:mahirick/users-and-teams#<v2.0.2-commit-sha> \
  fastify @fastify/cookie better-sqlite3
```

> Replace `<v2.0.2-commit-sha>` with the output of `git ls-remote https://github.com/mahirick/users-and-teams refs/tags/v2.0.2^{}` (the `^{}` deref gets the commit, not the tag object). The latest published SHA is recorded in `CHANGELOG.md`.

Why a commit SHA and not a tag? Tags are mutable — anyone with push access can move them. A commit SHA is content-addressed and can never silently change. `npm install` against a tag does record the resolved SHA in `package-lock.json`, so a `npm ci` install is reproducible — but a fresh `npm install` (e.g. a Docker image rebuild that loses the lock) will re-resolve the tag and could pull a different commit if the tag was rewritten. Pinning the SHA in `package.json` removes that class of trust assumption.

### Local dev: pin to a tag (fine — rebuilding from scratch is rare)

```bash
npm install \
  github:mahirick/users-and-teams#v2.0.2 \
  fastify @fastify/cookie better-sqlite3
```

### Track main (cutting-edge, only do this if you're working alongside the package)

```bash
npm install github:mahirick/users-and-teams fastify @fastify/cookie better-sqlite3
```

Your `package.json` ends up with one of:

```json
"@mahirick/users-and-teams": "github:mahirick/users-and-teams#<sha>"
"@mahirick/users-and-teams": "github:mahirick/users-and-teams#v2.0.2"
"@mahirick/users-and-teams": "github:mahirick/users-and-teams"
```

The first install takes ~30s the first time (clone + tsc build); subsequent installs are cached. To upgrade later, bump the ref and `npm install` again.

> Once the package is published to npm, `npm install @mahirick/users-and-teams` will be the canonical path. The wiring below works identically.

Then install the **peer dependencies you actually use**. They're all marked optional, so you only pay for what you need:

| You're using… | Install also |
|---|---|
| Backend (always) | `fastify @fastify/cookie` |
| SQLite storage | `better-sqlite3` |
| Postgres storage | `pg` |
| SMTP email | `nodemailer` |
| Filesystem avatar serving | `@fastify/static` |
| React UI | `react react-dom` |

If a peer is missing, you get a clear runtime error pointing at the install command (not a cryptic `Cannot find module`).

If you need the optional default theme stylesheet:
```ts
import '@mahirick/users-and-teams/styles.css';
```

---

## Decision tree — picking the right plug-ins

Run through this once before wiring. Each row produces a copy-paste config below.

### Storage

| Question | Pick |
|---|---|
| Do you already have a Postgres instance? | `createPostgresRepository(pool)` + `runPostgresMigrations(pool)` |
| Do you want the simplest possible setup, single file on disk? | `createSqliteRepository(db)` + `runMigrations(db)` |
| Are you writing tests or a quick prototype? | `createMemoryRepository()` (no persistence; resets every restart) |

### Email transport

| Need | Pick | Notes |
|---|---|---|
| Local dev — no real email | `consoleTransport()` | logs the magic-link URL to stdout |
| Production with Resend | `resendTransport({ apiKey, from })` | uses fetch; no SDK |
| Production with your own SMTP | `smtpTransport({ host, port, from, auth })` | wraps `nodemailer` |

### Avatars

| Need | Pick |
|---|---|
| Initials only (no photo upload) | Don't pass `avatarStore`. `<Avatar>` falls back to initials automatically. |
| Photo upload, FS storage | `createFsAvatarStore({ baseDir, urlPrefix })` + register `@fastify/static` to serve `baseDir` at `urlPrefix` |
| Photo upload, S3/R2/CDN | Implement the `AvatarStore` interface (`put` + `delete` returning a public URL); pass it to both plugins |
| Re-encode + EXIF strip server-side | Add `processAvatar` callback to both plugins (commonly wrapping `sharp`) |

### Owner bootstrap

There's no "first admin" wizard. List your bootstrap email(s) in `authPlugin.ownerEmails` — the first time someone signs in with one of those, they're created with `role: 'owner'` (system-wide superuser). Anyone else gets `role: 'user'`. After that, Owners can promote others via `PATCH /admin/users/:id`.

```ts
ownerEmails: (process.env.OWNER_EMAILS ?? '').split(',').filter(Boolean),
```

---

## Canonical full backend (with everything)

This is what to copy as a starting point for ScoreTracker / similar. Save as `src/server.ts`:

```ts
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
  type EmailTransport,
} from '@mahirick/users-and-teams';
import '@mahirick/users-and-teams/styles.css'; // only needed in the frontend bundle

const PORT = Number(process.env.PORT ?? 3000);
const SITE_URL = process.env.SITE_URL ?? 'http://localhost:5173';
const OWNER_EMAILS = (process.env.OWNER_EMAILS ?? '').split(',').map((e) => e.trim()).filter(Boolean);

const email: EmailTransport =
  process.env.RESEND_API_KEY && process.env.EMAIL_FROM
    ? resendTransport({ apiKey: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM })
    : consoleTransport();

const avatarsDir = resolve('./data/avatars');
const avatarStore = createFsAvatarStore({ baseDir: avatarsDir, urlPrefix: '/avatars' });

const db = new Database('./data/app.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
runMigrations(db);

const repository = createSqliteRepository(db);
const app = Fastify({ logger: { level: 'info' }, bodyLimit: 4 * 1024 * 1024 });

await app.register(fastifyCors, { origin: SITE_URL, credentials: true });
await app.register(fastifyStatic, {
  root: avatarsDir,
  prefix: '/avatars/',
  decorateReply: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=300'),
});

await app.register(authPlugin, {
  repository,
  email,
  siteUrl: SITE_URL,
  siteName: 'My App',
  ownerEmails: OWNER_EMAILS,
  cookieName: 'app_session',
  cookieSecure: process.env.NODE_ENV === 'production',
  sessionTtlDays: 90,
  avatarStore,
});

await app.register(teamsPlugin, { repository, email, siteUrl: SITE_URL, siteName: 'My App', avatarStore });
await app.register(adminPlugin, { repository });

// Your own routes get `request.user` populated automatically.
app.get('/api/scores', async (req) => {
  if (!req.user) return { scores: [] };
  return { scores: await fetchScoresFor(req.user.id) };
});

await app.listen({ port: PORT, host: '0.0.0.0' });
```

---

## Canonical React frontend

```tsx
// src/main.tsx
import { createRoot } from 'react-dom/client';
import {
  UsersAndTeamsProvider,
  AccountMenu, LoginForm, VerifyResult,
  TeamSwitcher, TeamProfile, TeamMembersList, InviteForm, PendingInvitesList,
  AdminUsersTable, AuditLog,
  useAuth,
} from '@mahirick/users-and-teams/react';
import '@mahirick/users-and-teams/styles.css';

function App() {
  const { user } = useAuth();
  return (
    <>
      <header><AccountMenu signInHref="/login" /></header>
      {user && <YourAppContent userId={user.id} />}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <UsersAndTeamsProvider apiBase="">
    <App />
  </UsersAndTeamsProvider>,
);
```

If your frontend is on a different port from your backend (Vite dev usually is), proxy `/auth`, `/me`, `/teams`, `/admin`, `/avatars`, and your own `/api` paths to the backend in `vite.config.ts`. See `uat-test/frontend/vite.config.ts` in this repo for the pattern.

---

## Conventions to follow when extending the consumer app

Anything below is **highly recommended for AI agents**, since these patterns will keep your app forward-compatible with future versions of the package.

### 1. Read `request.user`, don't reach into `req.cookies` or sessions yourself

The auth plugin's `onRequest` hook decorates every request. After registering it:

```ts
app.get('/api/whatever', async (req) => {
  if (!req.user) return { error: 'sign in' };
  // req.user is User | null. id, email, displayName, role, avatarColor, avatarInitials, avatarUrl.
});
```

Or use the `requireUser` helper:

```ts
app.get('/api/protected', async (req) => {
  const user = app.requireUser(req); // throws 401 if missing
  return doStuffFor(user.id);
});
```

### 2. Don't write your own `setErrorHandler` unless you really need it

`authPlugin` registers one that maps every typed package error (`NotAuthorizedError`, `RateLimitError`, etc.) to the right HTTP status. If you do need your own, delegate to `mapUatError`:

```ts
import { mapUatError } from '@mahirick/users-and-teams';

app.setErrorHandler((err, req, reply) => {
  const mapped = mapUatError(err);
  if (mapped) {
    reply.code(mapped.statusCode);
    if (mapped.headers) for (const [k, v] of Object.entries(mapped.headers)) reply.header(k, v);
    return mapped.body;
  }
  // your own handling for non-package errors
});
```

### 3. Don't reach into the package's tables directly from your queries

The package owns these tables: `users`, `magic_links`, `sessions`, `teams`, `team_members`, `team_invites`, `audit_log`, `_uat_migrations`. Treat them as opaque. If you need to look up users, go through the `Repository` interface or `request.user`. Schema may evolve in major versions; your app shouldn't break on every bump.

If you genuinely need joins (e.g., "show every score with the user's display name"), define the FK to `users.id` in your own table and join in your queries — that part is stable.

### 4. Audit your own actions

`recordAudit` is exported. Use it for material state changes in your own domain — same audit log shows up in `<AuditLog />`:

```ts
import { recordAudit } from '@mahirick/users-and-teams';

await recordAudit(repository, {
  actorId: req.user.id,
  action: 'score.publish',
  targetId: score.id,
  metadata: { value: score.value },
});
```

### 5. UI components are tokenized; theme via CSS variables

Don't override BEM class internals. Override `--uat-*` variables on `:root` (or any ancestor) to retheme:

```css
:root {
  --uat-accent: #ec4899;        /* your brand pink */
  --uat-accent-fg: #ffffff;
  --uat-radius: 14px;
}
```

### 6. The package has 3 roles. Use these exact names everywhere

| Code value | UI label | Scope | Who can do |
|---|---|---|---|
| `User.role = 'owner'` | "Owner" | system | anything anywhere |
| `TeamMember.role = 'admin'` | "Admin" | per team | rename / delete the team, add/remove members, transfer admin |
| `User.role = 'user'` + `TeamMember.role = 'user'` | "User" | per team | leave the team |

If you need finer-grained permissions inside a team, build them on top of `team.adminId === user.id` checks. Don't add a fourth tier — keep the model.

### 7. Migrations are append-only

If you add your own tables alongside the package's, put them in your own `your_app_*_migrations.ts` files. Never edit the package's migrations or share the `_uat_migrations` tracker. Run package migrations first (`runMigrations(db)`), then your own.

---

## Snippet to paste into your consumer repo's CLAUDE.md / AGENTS.md

```md
## User accounts, auth, and teams

We use `@mahirick/users-and-teams` for all of this. Don't roll your own.

- Auth state: read `request.user` (server) or `useAuth()` (React). Both populated automatically once the provider/plugin is registered at the app root.
- Permissions: three roles — Owner (system superuser), Admin (per team, one per team), User. See team-permission predicates in the package: `canEditTeam`, `canAddMember`, `canRemoveMember`, `canTransferAdmin`.
- Adding a team feature: write your op as a pure function that takes a `Repository`, validates input with zod, throws a typed error from the package, and registers a Fastify route ≤10 lines that delegates. Mirror the pattern of `src/teams/` in the package if unsure.
- Don't read package tables directly. Use `Repository` methods or `request.user`. Schema is owned by the package.
- Audit material changes via `recordAudit(repo, { actorId, action: 'your.namespace.verb', targetId, metadata })`.
- Don't import anything that touches `node:crypto`, `fastify`, or `better-sqlite3` from frontend code. Use `@mahirick/users-and-teams/react` for UI imports — it's the browser-safe entry point.
- See node_modules/@mahirick/users-and-teams/INTEGRATION.md for the full integration guide.
```

---

## Common gotchas

| Symptom | Likely cause | Fix |
|---|---|---|
| `Cannot find module 'fastify'` at boot | Forgot the peer | `npm install fastify @fastify/cookie` |
| `Authentication required` on every request | `authPlugin` not registered, or registered after the route | Always `await app.register(authPlugin, …)` BEFORE other route definitions |
| `request.user` is always null | Cookie not being sent (CORS, different origin, missing `credentials: 'include'`) | Set `cookieName`, register CORS with `credentials: true`, fetch with `credentials: 'include'` |
| Magic-link email never arrives | Using `consoleTransport`, link is in stdout | Look at backend logs |
| Resend send fails | `from` address not on a verified domain in Resend | Verify the domain or use `onboarding@resend.dev` (sandbox sender, only delivers to your account email) |
| 409 on team rename | Name collides case-insensitively | Pick a different name |
| Avatars upload but don't display | Forgot `@fastify/static` registration, or `urlPrefix` doesn't match the static `prefix` | Make `urlPrefix` and `prefix` identical (e.g. both `/avatars`) |
| 500 with `{ error: 'internal_error' }` and no message | Default behavior — message is in `fastify.log.error(err)`, not the response | Pass `exposeInternalErrors: true` to `authPlugin` in dev |
| Two-factor / WebAuthn? | Not in the package | Bring your own; the package's session model is just a cookie + opaque token, easy to gate behind another factor at the app level |

---

## Where to look in the package source

| Question | File |
|---|---|
| What does login actually do? | `src/auth/magic-link.ts` (request) + `src/auth/session.ts` (verify) + `src/auth/plugin.ts` (HTTP) |
| Why does X return that status code? | `src/core/error-handler.ts` |
| What permissions does a team-Admin have? | `src/teams/permissions.ts` |
| What schema does the package own? | `src/migrations/00N_*.ts` (SQLite) + `src/migrations/postgres/index.ts` (Postgres) |
| What avatar formats are accepted? | `src/auth/plugin.ts` → `decodeAvatarDataUrl` + `src/avatars/types.ts` |
| What audit actions exist? | `src/core/audit.ts` → `AUDIT_ACTIONS` |
| End-to-end consumer example | `uat-test/backend/server.ts` + `uat-test/frontend/App.tsx` (in this repo) |

---

## Migrating from a password gate

If your app currently has a single shared admin password (`POST /api/admin/auth` checking a hash, with the frontend persisting an `app:adminUnlocked = "true"` flag in `localStorage`), here's the canonical migration:

### Backend

1. **Register `authPlugin`** with your bootstrap email in `ownerEmails`:
   ```ts
   await app.register(authPlugin, {
     repository, email, siteUrl, siteName,
     ownerEmails: ['you@example.com'],
   });
   ```
   First time you sign in with that email, you become a system Owner.

2. **Don't delete `/api/admin/auth` immediately.** Make it return `410 Gone`:
   ```ts
   app.post('/api/admin/auth', async (_req, reply) => {
     reply.code(410);
     return { error: 'gone', message: 'Admin auth moved. Sign in via /login.' };
   });
   ```
   This is for one release cycle, to give cached frontends a clear failure mode instead of a 404 mystery. Drop it after consumers have rolled forward.

3. **Replace permission checks** in your existing routes:
   ```ts
   // Before: cookie-blob check, or always-allow because the gate was on the frontend
   app.post('/api/admin/scores/reset', async (req, reply) => { /* … */ });

   // After: gate on Owner role (or your own narrower predicate)
   app.post('/api/admin/scores/reset', async (req, reply) => {
     const user = app.requireUser(req);                 // throws 401
     if (user.role !== 'owner') {                       // 403
       reply.code(403);
       return { error: 'NOT_AUTHORIZED' };
     }
     // …
   });
   ```

   Or use the package's typed error so the shared error handler maps it for you:
   ```ts
   import { NotAuthorizedError } from '@mahirick/users-and-teams';
   if (user.role !== 'owner') throw new NotAuthorizedError();
   ```

4. **Anonymous browsing keeps working.** Routes that don't call `requireUser` still serve unauthenticated traffic. `request.user` is `null`, not an error.

### Frontend

1. **Wrap the app in `<UsersAndTeamsProvider>`.** It auto-fetches `/auth/me` on mount.

2. **Replace the gate check.** Old:
   ```tsx
   const isAdmin = localStorage.getItem('app:adminUnlocked') === 'true';
   if (isAdmin) <AdminPanel />
   ```
   New:
   ```tsx
   import { useAuth } from '@mahirick/users-and-teams/react';
   const { user } = useAuth();
   const isAdmin = user?.role === 'owner';
   if (isAdmin) <AdminPanel />
   ```

3. **Drop the localStorage write.** The cookie is HttpOnly and managed by the server — there's no client-side state to set or clear.

4. **Add a sign-in entrypoint.** `<LoginForm siteName="My App" />` is the easy path. The magic-link flow then bounces them through `/auth/verify?token=…` and back to `verifySuccessRedirect`.

5. **Sign out.** `useAuth().logout()` clears the session cookie. If you want a "sign out everywhere" option (kills every session for the user across devices), use `logoutAll()`.

### Cookie scope (rustfish-style multi-subdomain setup)

If your app might end up on `tracka.rustfish.com` today and `admin.rustfish.com` tomorrow and you want a single sign-in to cover both, set `cookieDomain` to the parent domain at registration time:

```ts
await app.register(authPlugin, {
  // …
  cookieName: 'rustfish_session',
  cookieDomain: process.env.NODE_ENV === 'production' ? '.rustfish.com' : undefined,
});
```

The cookie then applies to every subdomain. Verified that the `cookieDomain` option exists and is honored — see `src/auth/plugin.ts` (`cookieDomain` flows into both `setCookie` and `clearCookie`).

### Quick rollback plan

If you discover a broken assumption mid-migration, the cleanest rollback is:
1. Don't deregister `authPlugin` — leave it. Cookies are HttpOnly + scoped, they don't break anything.
2. Re-mount the old `/api/admin/auth` route alongside the new auth.
3. Revert the frontend's gate check.

The auth tables (`users`, `sessions`, etc.) coexist with your existing schema; they don't interfere.

---

## When NOT to use this package

- You need SAML / OIDC / OAuth — this is magic-link only.
- You need 2FA / WebAuthn — bring your own gate; we don't ship one.
- You need invite-only signup with admin approval — auto-add doesn't fit; you'd fight the model.
- You need teams to nest hierarchically — flat structure only.
- You need real-time presence ("who's online right now") — out of scope.

For everything else: this package is the right call.
