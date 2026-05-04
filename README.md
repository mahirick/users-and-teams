# `@mahirick/users-and-teams`

A reusable npm package for self-hosted user accounts and team management. Drops into any Fastify backend with a few lines of config.

- 🔐 **Magic-link auth** — email-based, opaque session tokens in HttpOnly cookies, no passwords, no JWT.
- 👥 **Teams** — anyone can create one; the creator is the team **Admin**, everyone else is a **User**. Add by email — existing users join immediately, unknown emails get a magic-link signup that auto-adds them on first login (iMessage-style).
- 🛡️ **Owner role** — system-wide superuser with cross-team admin powers, user moderation, and a full audit log.
- 🖼 **Avatars** — Apple-style initials-on-color circles, deterministically derived from id and name. No upload, no binary storage.
- 🎨 **React UI** — drop-in components (`<LoginForm>`, `<AccountMenu>`, `<TeamSwitcher>`, `<TeamMembersList>`, `<Avatar>`, `<AdminUsersTable>`, …) themed via CSS variables.
- 🗄️ **Pluggable storage** — SQLite (`better-sqlite3`) and in-memory adapters; Postgres planned.
- 📨 **Pluggable email** — Console (dev) and Resend (prod) transports; SMTP planned.

## Architecture at a glance

```
┌───────────────────────── consumer Fastify app ─────────────────────────┐
│                                                                        │
│   app.register(authPlugin,  { repository, email, … })                  │
│   app.register(teamsPlugin, { repository, email, … })                  │
│   app.register(adminPlugin, { repository })                            │
│                                                                        │
│   app.get('/api/me/widgets', (req) => …req.user…)   ← consumer route   │
│                                                                        │
└──┬──────────────────────────┬───────────────────────────┬──────────────┘
   │                          │                           │
   ▼                          ▼                           ▼
┌──────────────┐   ┌────────────────────┐    ┌──────────────────────────┐
│  authPlugin  │   │    teamsPlugin     │    │       adminPlugin        │
│              │   │                    │    │                          │
│ /auth/*      │   │ /teams/*           │    │ /admin/*                 │
│ onRequest →  │   │ ops + permissions  │    │ ops + audit instrumented │
│ request.user │   │                    │    │                          │
│ setError­    │   │   (errors thrown,  │    │   (errors thrown,        │
│ Handler      │←──┤    handled by auth │←───┤    handled by auth)      │
└──────┬───────┘   └────────┬───────────┘    └────────────┬─────────────┘
       │                    │                              │
       └────────────────────┼──────────────────────────────┘
                            ▼
              ┌────────────────────────────┐
              │       Repository (IF)      │
              ├────────────────────────────┤
              │  createSqliteRepository    │
              │  createMemoryRepository    │
              └────────────┬───────────────┘
                           │
                  ┌────────▼─────────┐
                  │  better-sqlite3  │      (consumer's chosen DB)
                  │   schema:        │
                  │   users / magic_links / sessions
                  │   teams / team_members / team_invites
                  │   audit_log / _uat_migrations
                  └──────────────────┘
```

Frontend side mirrors this:

```
<UsersAndTeamsProvider apiBase="">
  <LoginForm />            → POST /auth/request-link
  <AccountMenu />          → GET /auth/me, POST /auth/logout(-all)
  <TeamSwitcher />         → GET /teams, POST /teams
  <TeamMembersList />      → GET /teams/:id, DELETE /teams/:id/members/:userId,
                             POST /teams/:id/transfer-admin
  <InviteForm />           → POST /teams/:id/members  (auto-add by email)
  <Avatar />               → presentational; takes initials + color
  <AdminUsersTable />      → GET/PATCH /admin/users[…], POST /admin/users/:id/suspend
  <AuditLog />             → GET /admin/audit-log
  <VerifyResult />         (no API call — landing page after backend redirect)
</UsersAndTeamsProvider>
```

`UsersAndTeamsProvider` exposes `useAuth()` and `useTeams()` for consumer-built UI.

## Install

```bash
npm install @mahirick/users-and-teams better-sqlite3 fastify @fastify/cookie
# Optional, only if you use the React components:
npm install react react-dom
```

The package's `peerDependencies` are all optional, so backends-only or frontend-only consumers don't pay for the other side.

## Backend wire-up

```ts
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import {
  authPlugin,
  teamsPlugin,
  adminPlugin,
  createSqliteRepository,
  resendTransport,
  runMigrations,
} from '@mahirick/users-and-teams';

const db = new Database('./app.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
runMigrations(db);

const repository = createSqliteRepository(db);
const email = resendTransport({
  apiKey: process.env.RESEND_API_KEY!,
  from: 'noreply@yourdomain.com',
});

const app = Fastify();

await app.register(authPlugin, {
  repository,
  email,
  siteUrl: 'https://yourapp.com',
  siteName: 'Your App',
  cookieName: 'app_session',
  sessionTtlDays: 90,
  ownerEmails: (process.env.OWNER_EMAILS ?? '').split(',').filter(Boolean),
});

await app.register(teamsPlugin, { repository, email, siteUrl: 'https://yourapp.com', siteName: 'Your App' });
await app.register(adminPlugin, { repository });

// Your own routes can read request.user (populated by authPlugin's onRequest hook).
app.get('/api/me/widgets', async (req) => {
  if (!req.user) return { widgets: [] };
  return getWidgets(db, req.user.id);
});

await app.listen({ port: 3000 });
```

## Frontend wire-up

```tsx
import { createRoot } from 'react-dom/client';
import {
  UsersAndTeamsProvider,
  LoginForm,
  AccountMenu,
  AdminUsersTable,
} from '@mahirick/users-and-teams/react';
import '@mahirick/users-and-teams/styles.css'; // opt-in default theme

createRoot(document.getElementById('root')!).render(
  <UsersAndTeamsProvider apiBase="">
    <header>
      <AccountMenu signInHref="/login" />
    </header>

    {/* On /login route: */}
    <LoginForm siteName="Your App" />

    {/* On /admin route: */}
    <AdminUsersTable />
  </UsersAndTeamsProvider>,
);
```

The package ships a **browser-safe entry** (`@mahirick/users-and-teams/react`) that doesn't import `node:crypto` or `fastify`, so frontend-only consumers stay lean.

## Theming

Override `--uat-*` CSS custom properties at `:root` in your own stylesheet:

```css
:root {
  --uat-bg-surface: #fff;
  --uat-text-primary: #111;
  --uat-accent: #6366f1;
  --uat-accent-fg: #fff;
}
```

See `src/ui/styles.css` for the full token catalog (16 tokens covering surface, text, border, accent, typography, shape, motion).

## Schema

The package owns these tables in your SQLite database:

- `users` — id (UUID v7), email, display_name, role, status
- `magic_links` — sha256-hashed one-time tokens
- `sessions` — sha256-hashed cookies, sliding 90-day TTL
- `teams`, `team_members`, `team_invites`
- `audit_log`
- `_uat_migrations` — namespaced migration tracker

The migration runner is namespaced as `_uat_migrations`, so it won't collide with a `_migrations` table you maintain for your own schema. Your own data (per-user preferences, per-team domain data) lives in your own tables, keyed by `user_id` / `team_id`.

## API surface

All routes auto-mounted by the plugins:

**auth/**
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/request-link` | `{ email }` — always 200 (no enumeration); 429 on rate limit |
| GET | `/auth/verify` | `?token=…` — 302 with cookie or to verify-result error |
| POST | `/auth/logout` | clears cookie + revokes session |
| POST | `/auth/logout-all` | revokes every session for the user |
| GET | `/auth/me` | `{ user }` or 401 |

**teams/**
| Method | Path | Notes |
|---|---|---|
| GET | `/teams` | mine |
| POST | `/teams` | `{ name }` (creator becomes Admin) |
| GET | `/teams/:id` | members + your role |
| PATCH | `/teams/:id` | `{ name }` (Admin only) |
| DELETE | `/teams/:id` | Admin only |
| POST | `/teams/:id/members` | `{ email }` — adds existing user immediately, or sends magic-link signup for unknown emails |
| DELETE | `/teams/:id/members/:userId` | Admin removes anyone except themselves; User can self-leave |
| POST | `/teams/:id/transfer-admin` | `{ toUserId }` (Admin only) |

**admin/** (require `user.role === 'owner'`)
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/users` | search, page, pageSize |
| GET | `/admin/users/:id` | user + teams + recent audit |
| PATCH | `/admin/users/:id` | displayName, role, status, email |
| POST | `/admin/users/:id/suspend` | also revokes sessions |
| POST | `/admin/users/:id/unsuspend` | |
| DELETE | `/admin/users/:id` | self-delete blocked |
| GET | `/admin/audit-log` | filters: action, actorId, targetId, limit |

## Configuration

All plugin options have sensible defaults. Common overrides:

```ts
authPlugin({
  cookieName: 'app_session',          // default: 'uat_session'
  sessionTtlDays: 90,                 // default: 90
  magicLinkTtlMin: 15,                // default: 15
  cookieSameSite: 'lax',              // default: 'lax'
  cookieSecure: true,                 // default: NODE_ENV === 'production'
  cookieDomain: '.yourapp.com',       // default: undefined (host-only)
  rateLimit: { perEmailPerHour: 5, perIpPerHour: 20 },  // false to disable
  verifySuccessRedirect: '/',
  verifyErrorRedirect: '/login',
  magicLinkTemplate: (args) => ({ subject, html, text }),  // override email
})
```

## Demo

The repo ships a `demo/` app exercising the full flow end-to-end:

```bash
npm install
npm run demo:backend     # Fastify on :3000
npm run demo:frontend    # Vite + React on :5173
```

Visit `http://localhost:5173`. The demo uses the console email transport — magic links and invite links are logged to the backend's stdout.

The demo imports the package via Vite alias to `src/`, so source changes reload instantly. Use it for fast iteration.

## Testing as a real consumer (`uat-test/`)

For higher-fidelity testing, the repo also ships a `uat-test/` directory that installs the package via a real `file:..` npm dependency — it goes through `dist/` and the package's `exports` map exactly like an external consumer would.

```bash
cd uat-test
npm install
npm run dev:backend      # Fastify on :3100
npm run dev:frontend     # Vite + React on :5273

# After editing the package, reinstall:
npm run update           # rebuilds the package + reinstalls
```

Set `OWNER_EMAILS` (comma-separated) in `uat-test/backend/.env` and sign in with one of those emails to see the Admin tab.

## Customizing error handling

The package's `authPlugin` registers a `setErrorHandler` that maps every typed error (`NotAuthorizedError`, `RateLimitError`, `TeamNotFoundError`, …) to the right HTTP status. To override with your own handler while keeping the package's mappings:

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
  reply.code(500);
  return { error: 'oops' };
});
```

Last-set-wins per Fastify scope rules.

## Why this design

- **Magic-link only** — passwords are a liability. Email is the universal identifier.
- **Opaque tokens, not JWTs** — revocation is a `DELETE` on a session row, not a key-rotation epic.
- **`request.user` populated by middleware** — every consumer route gets the same auth context with no boilerplate.
- **Pluggable adapters** — start on SQLite, swap to Postgres without touching any business logic.
- **CSS variables for theming** — `npm update` never overwrites your overrides.
- **No JWT, no MFA, no OAuth in v1** — these are explicit non-goals (see [`SPEC.md`](./SPEC.md)). Adding them later is straightforward; carrying their complexity from day one is not.

## Repository docs

| File | Purpose |
|------|---------|
| [`README.md`](./README.md) | This file. Consumer-facing quickstart + reference. |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Dev setup, workflow, test strategy, release process. Start here if you're contributing. |
| [`CLAUDE.md`](./CLAUDE.md) | AI-agent / contributor deep-dive. Architecture rules, conventions, common tasks, what NOT to do. **Read before any non-trivial change.** |
| [`SPEC.md`](./SPEC.md) | Original design spec with all open questions resolved. Historical. |
| [`PLAN.md`](./PLAN.md) | Six-stage build plan. Each stage maps to one commit on `main`. Historical. |
| [`uat-test/README.md`](./uat-test/README.md) | How to run the external-consumer test app (real `file:..` install). |

## License

MIT
