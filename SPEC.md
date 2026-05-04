# Users & Teams — High-Level Spec

**Date:** 2026-05-04
**Status:** Draft — open questions resolved 2026-05-04 (see "Resolved decisions" below).
**Scope:** A reusable npm package (`@mahirick/users-and-teams`) providing self-hosted user accounts, magic-link auth, sessions, teams, admin, and optional React UI components. Drops into any Fastify backend.

## Goals

- Persist user identity and per-user session state.
- Group users into teams with role-based membership and email invites.
- **Self-hosted, no third-party auth provider** (no Clerk, no Auth0, no Cloudflare Access).
- Pluggable into any project without duplicating auth code.
- v1 auth: **email magic link** + **long-lived opaque session token** (HTTPOnly cookie). No password support, no SSO.
- Admin can list users, see team membership, suspend/delete users, audit invites.
- Optional React UI components shipped in the package, themable via CSS variables.

## Non-Goals (v1)

- Passwords, MFA, social SSO, SAML, SCIM.
- Real-time presence, online/offline indicators (separate concern).
- GDPR full-suite (right-to-export, right-to-erasure beyond simple delete) — capture as TODO.
- Billing / quotas / per-team feature flags.
- Consumer-specific state (per-app user preferences, per-team domain data) — consumers own their own tables. The package is laser-focused on identity.

## Package Layout

Single flat npm package — no monorepo, no workspaces. `npm link` for local dev, GitHub Packages registry once stable.

```
usersAndTeamsP5/
├── src/
│   ├── core/                  # shared types + repository interface
│   │   ├── types.ts            # User, Session, Team, Membership, Invite, Role
│   │   ├── repository.ts       # storage interface (no implementation)
│   │   └── errors.ts           # typed error classes
│   ├── auth/                  # magic-link login + sessions
│   │   ├── plugin.ts           # Fastify plugin: /auth/* routes
│   │   ├── magic-link.ts       # token generation, email send, verify
│   │   ├── session.ts          # cookie issuance, token validation
│   │   ├── middleware.ts       # request.user populated by cookie
│   │   └── rate-limit.ts       # in-memory token bucket for /auth/request-link
│   ├── admin/                 # operator-facing user management
│   │   ├── plugin.ts           # /admin/users/* routes (requires role=admin)
│   │   └── operations.ts       # listUsers, suspend, delete, audit
│   ├── teams/                 # team CRUD + invites + roles
│   │   ├── plugin.ts           # /teams/* routes
│   │   ├── operations.ts       # createTeam, inviteMember, acceptInvite, etc.
│   │   └── permissions.ts      # canEditTeam, canRemoveMember, etc.
│   ├── adapters/
│   │   ├── sqlite.ts           # better-sqlite3 repository
│   │   ├── memory.ts           # in-memory repository (for tests)
│   │   └── postgres.ts         # (future) pg repository — stub for now
│   ├── email/
│   │   ├── resend.ts           # Resend.com transport (default for prod)
│   │   ├── console.ts          # logs link to stdout (default for dev)
│   │   └── smtp.ts             # (future) nodemailer SMTP — stub for now
│   ├── ui/                    # React components (web)
│   │   ├── components/
│   │   │   ├── LoginForm.tsx
│   │   │   ├── VerifyResult.tsx
│   │   │   ├── AccountMenu.tsx
│   │   │   ├── TeamSwitcher.tsx
│   │   │   ├── TeamMembersList.tsx
│   │   │   ├── InviteForm.tsx
│   │   │   └── AdminUsersTable.tsx
│   │   ├── hooks/
│   │   │   ├── useAuth.ts        # current user, login/logout helpers
│   │   │   └── useTeams.ts       # current user's teams + active team
│   │   ├── provider.tsx          # <UsersAndTeamsProvider> — apiBase + auth context
│   │   └── styles.css            # opt-in stylesheet driven by --uat-* CSS vars
│   ├── migrations/             # SQL files for schema setup (sqlite first)
│   │   └── 001_initial.sql
│   └── index.ts                # barrel exports — auth/admin/teams plugins, UI components, types
├── demo/
│   ├── backend/                # tiny Fastify app exercising the full package
│   └── frontend/               # tiny Vite React app rendering the UI components
├── tests/
│   ├── auth.test.ts
│   ├── teams.test.ts
│   └── admin.test.ts
├── README.md                   # quickstart + copy-paste wiring example
├── package.json                # name: @mahirick/users-and-teams
└── tsconfig.json               # composite: true for nice TS DX in consumers
```

**Why pluggable transports:** one consumer might wire SQLite + Resend; another Postgres + SMTP. Same package, swap adapter wiring at boot.

**Why a `demo/` app:** the package is standalone, so verify-this checkpoints can't depend on a real consumer. The demo app is the visual + functional smoke-test for every stage.

## What a consumer does

1. `npm install @mahirick/users-and-teams`
2. Wire it into Fastify boot:
   ```ts
   await app.register(authPlugin, {
     repository: sqliteRepository(db),
     email: resendTransport({ apiKey: env.resendKey, from: env.emailFrom }),
     cookieName: 'app_session',     // configurable per consumer
     sessionTtlDays: 90,
     siteUrl: 'https://app.example.com',
     siteName: 'My App',
     adminEmails: ['admin@example.com'],
   });
   await app.register(adminPlugin, { requireRole: 'admin' });
   await app.register(teamsPlugin);
   ```
3. The consumer's own routes use `request.user` (populated by middleware) to scope their own data:
   ```ts
   app.get('/api/me/widgets', async (req) => {
     if (!req.user) return { widgets: [] };
     return getMyWidgets(db, req.user.id);
   });
   ```
4. Consumer's frontend either uses the package's React components (`<LoginForm>`, `<AccountMenu>`, etc.) or builds its own UI against the package's API endpoints.

## Auth Flow (v1: email magic link)

**Request flow:**
```
1. POST /auth/request-link    { email }
   → Backend issues a one-time short-lived token (15 min TTL)
   → Stores hash in `magic_links` table
   → Sends email: "Click to sign in: {siteUrl}/auth/verify?token={token}"
   → Returns 200 (always, even for unknown emails — prevents enumeration)

2. GET /auth/verify?token=...
   → Backend looks up token by hash, checks not-expired, not-consumed
   → Marks token consumed
   → If email is new → creates user row
   → If email exists → loads user
   → Issues session: random 256-bit opaque token
   → Stores session row with user_id, expires_at = now + 90d, hashed_token
   → Sets cookie: {cookieName}={token}; HttpOnly; Secure; SameSite=Lax; Max-Age=90d
   → Redirects to {siteUrl}/

3. (subsequent requests)
   → Middleware reads cookie, looks up session by hashed token
   → If found + not expired → request.user = { id, email, role, teams }
   → If not → request.user = null (anonymous; some routes still allow)

4. POST /auth/logout
   → Deletes session row, clears cookie
```

**Token shape:** opaque, not JWT. Reasoning: revocable (delete row in DB), trivially short, no signing-key rotation pain. Cost: every request hits the session table — fine at small/medium scale, can add an in-memory LRU cache later if needed.

**Why long-lived:** "set it and forget it." 90-day cookie matches Slack, Linear, GitHub default behavior.

**Token storage:** never store the raw token. Hash it with SHA-256 (no salt needed since the token itself is 256 bits of entropy). Verify on lookup by hashing the supplied cookie and selecting where stored hash matches.

**No cookie signing.** The cookie value is already a 256-bit cryptographic random; an attacker can't guess one and can't forge one (no matching DB hash). Adding a signing secret would protect a strong credential with a weaker one for no real win. If a future consumer needs defense-in-depth against DB exfiltration, an optional `tokenPepper` plugin option can switch the storage hash to HMAC-SHA256(token, pepper). Not shipping in v1.

## Schema (SQLite)

```sql
CREATE TABLE users (
  id              TEXT PRIMARY KEY,        -- UUID v7 (sortable by creation time)
  email           TEXT NOT NULL UNIQUE,    -- normalized lowercase
  display_name    TEXT,                    -- pulled from email local-part by default
  role            TEXT NOT NULL DEFAULT 'user', -- 'user' | 'admin'
  status          TEXT NOT NULL DEFAULT 'active', -- 'active' | 'suspended' | 'deleted'
  created_at      INTEGER NOT NULL,        -- epoch ms
  last_seen_at    INTEGER
);

CREATE TABLE magic_links (
  token_hash      TEXT PRIMARY KEY,        -- sha256(token)
  email           TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,        -- created_at + 15min
  consumed_at     INTEGER                  -- null until clicked
);

CREATE TABLE sessions (
  token_hash      TEXT PRIMARY KEY,        -- sha256(cookie)
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  last_used_at    INTEGER NOT NULL,
  ip              TEXT,                    -- optional: for audit / "sign out other devices"
  user_agent      TEXT
);

CREATE TABLE teams (
  id              TEXT PRIMARY KEY,        -- UUID v7
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  owner_id        TEXT NOT NULL REFERENCES users(id),
  created_at      INTEGER NOT NULL
);

CREATE TABLE team_members (
  team_id         TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'member', -- 'owner' | 'admin' | 'member'
  joined_at       INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE team_invites (
  token_hash      TEXT PRIMARY KEY,
  team_id         TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  inviter_id      TEXT NOT NULL REFERENCES users(id),
  email           TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'member',
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,        -- typical: 7d
  consumed_at     INTEGER
);

CREATE TABLE audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id        TEXT REFERENCES users(id),
  action          TEXT NOT NULL,           -- 'user.create' | 'team.invite' | 'user.suspend' | ...
  target_id       TEXT,                    -- user_id, team_id, etc — depends on action
  metadata_json   TEXT,                    -- free-form JSON for action-specific context
  created_at      INTEGER NOT NULL
);
```

Indexes: `users(email)`, `sessions(user_id)`, `team_members(user_id)`, `magic_links(expires_at)` for cleanup.

The migration runner uses a namespaced tracker table (`_uat_migrations`) so the package can share a SQLite database with a consumer's own schema without colliding on a generic `_migrations` table.

## API Surface (per module)

### auth/

| Method | Path | Body / Query | Response |
|---|---|---|---|
| POST | `/auth/request-link` | `{ email }` | `200 { ok: true }` always |
| GET  | `/auth/verify` | `?token=...` | `302 → /` + sets cookie |
| POST | `/auth/logout` | — | `200 { ok: true }` clears cookie |
| POST | `/auth/logout-all` | — | `200 { ok: true }` revokes all sessions for user |
| GET  | `/auth/me` | — | `{ user: { id, email, displayName, role } }` or `401` |

### admin/

All routes require `request.user.role === 'admin'`.

| Method | Path | Purpose |
|---|---|---|
| GET    | `/admin/users` | List all users with pagination + search |
| GET    | `/admin/users/:id` | Single user with team memberships |
| PATCH  | `/admin/users/:id` | Update display name, role, status |
| POST   | `/admin/users/:id/suspend` | Soft suspend (revokes sessions) |
| DELETE | `/admin/users/:id` | Hard delete (cascades to memberships) |
| GET    | `/admin/audit-log` | Last N audit entries with filters |

### teams/

| Method | Path | Purpose |
|---|---|---|
| GET    | `/teams` | Teams the current user belongs to |
| POST   | `/teams` | Create team; current user becomes owner |
| GET    | `/teams/:id` | Team detail (members, role, invites) |
| PATCH  | `/teams/:id` | Update team name/slug (owner+admin only) |
| DELETE | `/teams/:id` | Delete team (owner only) |
| POST   | `/teams/:id/invites` | Send email invite (owner+admin only) |
| GET    | `/teams/invites/accept` | `?token=...` accept an invite |
| DELETE | `/teams/:id/members/:userId` | Remove member (owner+admin only) |
| PATCH  | `/teams/:id/members/:userId` | Change role (owner only) |
| POST   | `/teams/:id/transfer-ownership` | `{ toUserId }` (owner only) |

## React UI (`ui/` module)

The package ships React components and hooks. Consumers can mount them directly, or use only the hooks and build custom UI against the API.

**Components:**
- `<LoginForm />` — email field + "Send magic link" button + post-submit confirmation + error display.
- `<VerifyResult />` — landing page after backend `/auth/verify` redirect (success / error reasons).
- `<AccountMenu />` — avatar (initial-circle by default) + dropdown (display name, "My Teams", "Sign out", "Sign out everywhere").
- `<TeamSwitcher />` — dropdown of teams + create + manage.
- `<TeamMembersList />` — members with roles + remove buttons (gated by permissions).
- `<InviteForm />` — email + role + send.
- `<TeamSettings />` — name/slug edit, transfer ownership, delete.
- `<AcceptInvite />` — invite landing page; prompts login if needed.
- `<AdminUsersTable />`, `<AdminUserDetail />`, `<AuditLog />` — admin views.

**Hooks:**
- `useAuth()` → `{ user, loading, requestLink, logout, logoutAll }`.
- `useTeams()` → `{ teams, activeTeam, switchTeam, createTeam }`.

**Provider:**
- `<UsersAndTeamsProvider apiBase="..." />` configures the API base URL and surfaces auth context. Mount once at the app root.

## Configuration knobs

| Env var | Purpose | Default |
|---|---|---|
| `SESSION_TTL_DAYS` | Long-lived cookie TTL | `90` |
| `MAGIC_LINK_TTL_MIN` | Magic link validity | `15` |
| `INVITE_TTL_DAYS` | Team invite validity | `7` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Email transport | local dev → console transport |
| `EMAIL_FROM` | Sender address | required for non-console transport |
| `ADMIN_EMAILS` | Comma-separated email allowlist; matching users get `role='admin'` on signup | none |
| `ALLOW_SIGNUP` | If false, only emails matching invite tokens or admin-created accounts can log in | `true` |
| `RESEND_API_KEY` | Resend.com API key (only when email transport = resend) | required for `resend` transport |
| `RATE_LIMIT_REQUEST_LINK_PER_EMAIL` | Magic-link requests per hour per email | `5` |
| `RATE_LIMIT_REQUEST_LINK_PER_IP` | Magic-link requests per hour per IP | `20` |

Consumers may override any of these via plugin options at registration time; env vars are conveniences for boot-time wiring.

## Resolved decisions (2026-05-04)

1. **Email transport: Resend** as the default production option (3k free/mo, dead-simple API). SMTP and other transports added when a consumer needs them.
2. **`ALLOW_SIGNUP=true` by default.** Open-signup feel. Rate limit per email + per IP on `/auth/request-link` (5/hr/email, 20/hr/IP — in-memory token bucket; Cloudflare Turnstile or similar later if abused).
3. **Library name: `@mahirick/users-and-teams`.**
4. **Repo layout:** single flat package. `npm link` during dev, GitHub Packages registry once stable.
5. **Consumer state stays in the consumer.** The package owns `users`, `magic_links`, `sessions`, `teams`, `team_members`, `team_invites`, `audit_log`. Anything else (per-user preferences, per-team domain data) is the consumer's table, keyed by `user_id` / `team_id`.
6. **Admin role assignment: env-based email allowlist.** `ADMIN_EMAILS=a@x.com,b@y.com` (comma-separated, case-insensitive). On user creation, if email matches → role = `admin`. List-based so multi-admin doesn't require DB poking.
7. **Email templates: hard-coded English HTML.** Single template per email type with `siteName` + `siteUrl` interpolated. No theming, no localization in v1. Override path = fork the package or pass a custom `templates` option.
8. **Session refresh: sliding.** Each authenticated request bumps `last_used_at` and `expires_at = now + ttl`. Users never log in again unless silent for 90 days.
9. **Logout-all-devices in v1.** "Sign out everywhere" button on account page nukes all `sessions` rows for that user. Trivial now, painful to retrofit.
10. **Email change flow: admin-only in v1.** Self-serve email change deferred. Admin can edit email via `/admin/users/:id`.
11. **Account deletion: admin-only in v1.** Self-serve deletion deferred.
12. **Package ships React UI components (`ui/` module).** Login form, account menu, team switcher, team members list, admin users table — all themable via CSS variables. Consumers may use them or skip and build their own UI against the API.

## Styling strategy (UI module)

To keep the package neutral while shipping a production-quality default look:

- **Components ship semantic BEM-style class names** — `.uat-login`, `.uat-card`, `.uat-button`, `.uat-input`, etc. (`uat` = users-and-teams). Stable across versions (treated as public API; renames require major bump).
- **One opt-in stylesheet:** `import '@mahirick/users-and-teams/styles.css'`. Pulls every visual property from CSS custom properties (`--uat-bg-surface`, `--uat-accent`, `--uat-font-primary`, etc.). Defaults are an opinionated dark theme with mono-style headings and a cyan accent — tasteful out of the box, fully overridable.
- **Consumer overrides happen at `:root`** in their own CSS — never touched by `npm update`. CSS-var resolution always picks up the consumer's redefinition because it lives later in the cascade than the package's defaults.
- **Escape hatches:** consumer can skip importing `styles.css` (write CSS from scratch against the same class names), or pass `className` to any component to merge custom classes alongside defaults.
- **Token list to expose** (initial): `--uat-bg-surface`, `--uat-bg-deep`, `--uat-bg-secondary`, `--uat-bg-hover`, `--uat-border`, `--uat-border-light`, `--uat-text-primary`, `--uat-text-muted`, `--uat-text-dim`, `--uat-accent`, `--uat-error`, `--uat-success`, `--uat-font-primary`, `--uat-font-mono`, `--uat-radius`, `--uat-transition-fast`.

## Estimated effort

- **Stage 1** (skeleton + core types + adapters): ~1 day.
- **Stage 2** (auth module + demo backend): ~1.5 days.
- **Stage 3** (UI module + demo frontend): ~1 day.
- **Stage 4** (teams module): ~2 days.
- **Stage 5** (admin module + audit): ~1 day.
- **Stage 6** (publish v1.0.0 + README): ~0.5 day.
- **Total**: ~6-7 days of focused work.

Reusing this in another project after Stage 2 / first publish: drop-in, ~30 min to wire up.

## What this spec is NOT

- A code-level design. No file-by-file or function-by-function breakdown. The companion plan doc (`PLAN.md`) translates this into a per-task todo list.
- A frontend visual design spec. UI components ship with default styling (an opinionated dark theme); consumers theme via CSS variables.

## Next step

The companion plan doc (`PLAN.md`) breaks the stages into actionable tasks:

- Stage 1: bootstrap the package, schema, sqlite + memory adapters, migrations runner.
- Stage 2: auth module (magic-link, sessions, plugin) + demo backend for end-to-end verify.
- Stage 3: UI module (LoginForm, AccountMenu, useAuth, Provider) + demo frontend for visual verify.
- Stage 4: teams module + invites + role management + UI components.
- Stage 5: admin module + audit log + UI components.
- Stage 6: README quickstart + publish v1.0.0 to GitHub Packages.
