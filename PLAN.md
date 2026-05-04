# Users & Teams — Build Plan

**Date:** 2026-05-04
**Status:** Ready to execute
**Companion:** `SPEC.md`

Translates the spec into an actionable per-task breakdown across six stages. Each task ends with a verify-this checkpoint so you can ship it and move on without backtracking.

The repo includes a `demo/` app (Fastify backend + Vite React frontend) that exercises the full flow end-to-end. From Stage 2 onward, every verify-this uses the demo app — the package is fully standalone and never assumes a specific consumer.

## Stage 1 — Package skeleton + core types + adapters

**Outcome:** a buildable package with core types, repository interface, SQLite + memory adapters, migrations runner, and email transports.

**Estimate:** 1 day.

### 1.1 — Create the package skeleton

- `git init` in this directory; push to GitHub as `mahirick/users-and-teams` (private).
- `package.json`:
  - `name`: `@mahirick/users-and-teams`
  - `private`: `true` initially (flip to `false` once first published to GitHub Packages)
  - `main`: `dist/index.js`, `types`: `dist/index.d.ts`
  - `peerDependencies`: `fastify@^5`, `better-sqlite3@^11`, `react@>=18`, `react-dom@>=18` (React + DOM only required when using the `ui/` module)
  - `dependencies`: `zod`, `cookie`, `uuidv7` (for time-sortable user/team IDs). Tokens + hashes use `node:crypto` directly — no `nanoid`.
  - `devDependencies`: `typescript@^5`, `vitest`, `tsup` (or plain `tsc`)
  - `scripts`: `build`, `test`, `lint`, `dev` (tsc watch), `demo:backend`, `demo:frontend`
- `tsconfig.json` with `composite: true`, `declaration: true`, target `es2022`.
- `.gitignore`: `node_modules/`, `dist/`, `.env`, `*.tgz`.
- `README.md` already exists — flesh out at end of Stage 6.

**Verify:** `npm install && npm run build` succeeds with empty `src/index.ts`.

### 1.2 — Core types + repository interface

- `src/core/types.ts`: `User`, `Session`, `MagicLink`, `Team`, `TeamMember`, `TeamInvite`, `AuditEntry`, `Role` ('user' | 'admin'), `MemberRole` ('owner' | 'admin' | 'member').
- `src/core/repository.ts`: an `interface Repository` with methods: `findUserByEmail`, `createUser`, `getUser`, `updateUser`, `listUsers`, `createMagicLink`, `consumeMagicLink`, `createSession`, `findSessionByTokenHash`, `bumpSession`, `deleteSession`, `deleteSessionsForUser`, plus team/audit equivalents added later.
- `src/core/errors.ts`: typed errors — `UserNotFoundError`, `SessionExpiredError`, `InvalidTokenError`, `RateLimitError`, etc.

**Verify:** `tsc --noEmit` clean.

### 1.3 — SQLite adapter + initial migration

- `src/migrations/001_initial.ts`: exports `{ id: '001_initial', sql: /* sql */\`...\` }` — `users` + `magic_links` + `sessions` tables only (teams/invites/audit deferred until stages 4-5). Inline TS template strings, not `.sql` files: keeps the build pipeline trivial and sidesteps asset-copy issues across bundlers.
- `src/migrations/index.ts`: `migrations` array of `{ id, sql }` in order. New migrations append.
- `src/adapters/sqlite.ts`: `createSqliteRepository(db: BetterSqlite3.Database)` returns a Repository implementation.
- `src/adapters/memory.ts`: in-memory Map-backed Repository for unit tests.
- `src/migrations/runner.ts`: `runMigrations(db)` iterates the migrations array and applies any not yet recorded. Tracks applied migrations in `_uat_migrations` (namespaced so the package can share a DB with a consumer's own migrations table).

**Verify:** unit test creates an in-memory DB, runs migrations, instantiates sqlite adapter, exercises round-trip create-find-delete on each table.

### 1.4 — Email transport: console + Resend

- `src/email/types.ts`: `EmailTransport` interface — `send({ to, subject, html, text })`.
- `src/email/console.ts`: logs `[email] to=... subject=... link=...` to stdout. Default in dev.
- `src/email/resend.ts`: thin wrapper around Resend SDK. Accepts `apiKey`, `from`, returns transport.
- `src/email/templates.ts`: `magicLinkEmail({ siteName, siteUrl, link })` returning `{ subject, html, text }`. Hardcoded English template per spec, inlined as TS template strings (no separate `.html` files to bundle).

**Verify:** unit test verifies template renders with expected substitutions; a manual `node -e "..."` round-trip via console transport works.

## Stage 2 — Auth module + demo backend

**Outcome:** working auth (request-link → email → verify → cookie → session) demonstrated end-to-end via a minimal Fastify demo app inside the repo.

**Estimate:** 1.5 days.

### 2.1 — Magic-link auth + session middleware

- `src/auth/magic-link.ts`: `requestMagicLink(repo, email, transport, { siteName, siteUrl, ttlMin })`. Generates random 32-byte token, hashes with sha256, stores hash + email + expires_at, sends email. Always returns ok (no email enumeration).
- `src/auth/session.ts`:
  - `verifyMagicLinkAndCreateSession(repo, token, { adminEmails, sessionTtlDays })`. Hashes token, looks up, checks unconsumed + unexpired, marks consumed. If user exists by email → load. If not → create with role determined by `adminEmails` allowlist. Issues random 32-byte session token, hashes, stores. Returns `{ user, sessionToken }`.
  - `verifySession(repo, sessionToken)` → `User | null`. Hashes, looks up, checks not expired. Bumps `last_used_at` and `expires_at` (sliding session per spec).
  - `revokeSession(repo, sessionToken)` deletes the row.
  - `revokeAllSessionsForUser(repo, userId)` for "logout everywhere" + admin suspension cascade.
- `src/auth/middleware.ts`: Fastify `preHandler` that reads cookie (using configured `cookieName`), calls `verifySession`, attaches `request.user`.
- `src/auth/rate-limit.ts`: simple in-memory token bucket. Two buckets: per-email + per-IP. Configurable via plugin options.

**Verify:** unit test with memory repo + console transport: request link → capture token from email → verify → cookie is set → subsequent request reads `request.user`. Rate-limit test confirms 6th request in same hour for same email returns 429.

### 2.2 — Auth Fastify plugin

- `src/auth/plugin.ts`: `authPlugin` registers:
  - `POST /auth/request-link`
  - `GET /auth/verify`
  - `POST /auth/logout`
  - `POST /auth/logout-all`
  - `GET /auth/me`
- Registers the cookie middleware globally so every downstream route gets `request.user`.
- Reads config from plugin options: `repository`, `email`, `cookieName`, `sessionTtlDays`, `magicLinkTtlMin`, `siteUrl`, `siteName`, `adminEmails`, `rateLimit`. No `cookieSecret` — the session cookie is a 256-bit random opaque token, hashed in DB; signing adds nothing on top of that.

**Verify:** `tests/integration.test.ts` spins up a tiny Fastify test app and hits the full flow with a mock email transport that captures links.

### 2.3 — Demo backend

- New folder `demo/backend/`.
- Tiny Fastify app: registers `authPlugin` with `consoleTransport`, opens a SQLite DB at `demo/backend/demo.db`, exposes `/auth/*` and a sample protected route (`GET /api/hello` → `{ message, user }`).
- `demo/backend/index.ts` reads `.env` (sample committed as `.env.example`).
- Cleanup: a `npm run demo:reset` script removes `demo.db` to start fresh.

**Verify:** `npm run demo:backend` starts the server. Then in another terminal:
```
curl -X POST http://localhost:3000/auth/request-link \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com"}'
# => grep stdout for the magic link
curl -i 'http://localhost:3000/auth/verify?token=<paste>'
# => 302 + Set-Cookie
curl http://localhost:3000/auth/me -H 'cookie: <paste>'
# => { user: { id, email, ... } }
```

## Stage 3 — UI module + demo frontend

**Outcome:** package-shipped React components render the auth flow in a browser via the demo frontend. Visual smoke-test confirms everything works without a real consumer.

**Estimate:** 1 day.

### 3.1 — Default `--uat-*` CSS tokens

- `src/ui/styles.css` defines defaults for every `--uat-*` var listed in SPEC.md "Styling strategy" → opinionated dark theme.
- Document each token in a header comment block.
- Configure tsup (or a simple copy script) to emit `dist/styles.css` so consumers can `import '@mahirick/users-and-teams/styles.css'`.

**Verify:** load `dist/styles.css` in a blank HTML file → background dark, accent cyan, mono headers.

### 3.2 — `<UsersAndTeamsProvider>` + useAuth hook

- `src/ui/provider.tsx`: React context exposing `{ apiBase, user, loading, refresh }`. Default `apiBase` is same-origin.
- `src/ui/hooks/useAuth.ts`: returns `{ user, loading, requestLink, logout, logoutAll }`. Calls package API endpoints relative to `apiBase`.

**Verify:** mount Provider in a test harness; useAuth resolves user from `/auth/me`.

### 3.3 — `<LoginForm />`

- `src/ui/components/LoginForm.tsx`: email field + "Send magic link" button + post-submit confirmation + error display.
- Uses `useAuth().requestLink`.
- BEM class names: `.uat-login`, `.uat-login-input`, `.uat-login-button`, `.uat-login-error`, `.uat-login-success`.
- Optional `siteName` and `appearance` props for minor customization.

### 3.4 — `<AccountMenu />`

- `src/ui/components/AccountMenu.tsx`: avatar (initial-circle by default) + dropdown with display name, email, "My Teams" (placeholder until Stage 4), "Sign out", "Sign out everywhere".
- BEM: `.uat-account`, `.uat-account-trigger`, `.uat-account-menu`, etc.
- Renders a "Sign in" link if `user === null`.

### 3.5 — `<VerifyResult />`

- `src/ui/components/VerifyResult.tsx`: rendered at `/auth/verify-result?status=success` or `?status=error&reason=...` after the backend verify redirect.
- Centered card: "Signed in. Redirecting…" or "Link expired. Request a new one."
- Auto-redirects to `/` after 2s on success.

### 3.6 — Demo frontend

- New folder `demo/frontend/` (Vite + React).
- App wraps root in `<UsersAndTeamsProvider apiBase="/" />`.
- Routes: `/` (home — shows `<AccountMenu>` and the protected `/api/hello` response if logged in), `/login` (renders `<LoginForm>`), `/verify-result`.
- Vite dev server proxies `/auth/*` and `/api/*` to the demo backend (`http://localhost:3000`).
- Imports `@mahirick/users-and-teams/styles.css`.

**Verify:** browser end-to-end. `npm run demo:backend` + `npm run demo:frontend`. Visit `http://localhost:5173`, click "Sign in", submit your email, copy magic link from backend stdout, paste into the URL bar, land on `/verify-result?status=success`, redirected to home, see your email in the AccountMenu, "Sign out" works, "Sign out everywhere" works.

## Stage 4 — Teams module

**Outcome:** users can create teams, invite teammates by email, assign roles. Verified end-to-end in the demo app.

**Estimate:** 2 days.

### 4.1 — Schema additions

- `src/migrations/002_teams.sql`: `teams`, `team_members`, `team_invites` tables per spec.
- Repository interface gets team methods. Sqlite + memory adapters implement.

### 4.2 — Teams operations module

- `src/teams/operations.ts`:
  - `createTeam({ name, slug, ownerId })` — creates team + owner row in `team_members`.
  - `inviteMember({ teamId, inviterId, email, role, transport, ttlDays })` — generates token, sends email with link.
  - `acceptInvite({ token, userId })` — validates, creates `team_members` row, marks invite consumed.
  - `listMyTeams(userId)`.
  - `listMembers(teamId)`.
  - `updateMemberRole({ teamId, userId, role, actorId })` — permission check via `permissions.ts`.
  - `removeMember({ teamId, userId, actorId })`.
  - `transferOwnership({ teamId, fromUserId, toUserId })`.
  - `deleteTeam({ teamId, actorId })`.

### 4.3 — Permissions

- `src/teams/permissions.ts`: `canEditTeam(team, user)`, `canInvite(team, user)`, `canRemoveMember(team, user, target)`, etc. Pure functions, easy to unit test.

### 4.4 — Routes plugin

- `src/teams/plugin.ts`: all `/teams/*` routes per spec. Each checks auth + permissions.

### 4.5 — Email template: invite

- `src/email/templates.ts` adds `inviteEmail({ siteName, siteUrl, teamName, inviterName, link })`.

### 4.6 — UI components

- `<TeamSwitcher />` in header (after AccountMenu): dropdown of teams the user belongs to + "Create team" + "Manage teams".
- `<TeamMembersList teamId={...} />`: list of members with role + remove button (gated by permissions).
- `<InviteForm teamId={...} />`: email field + role selector + "Send invite" button.
- `<TeamSettings teamId={...} />`: name + slug edit, owner-only "Delete team" + "Transfer ownership."
- `<AcceptInvite token={...} />`: lands on `/invites/accept?token=...`, prompts login if needed, accepts.
- `useTeams()` hook: `{ teams, activeTeam, switchTeam, createTeam }`.

### 4.7 — Demo app integration

- Demo backend registers `teamsPlugin`.
- Demo frontend gets routes: `/teams`, `/teams/:slug`, `/invites/accept`.
- TeamSwitcher mounted in header next to AccountMenu.

**Verify:** in the demo app, create a team, invite a second email (use a second browser profile), capture invite link from backend stdout, accept, see them in the members list, change their role, remove them.

## Stage 5 — Admin + audit

**Outcome:** an admin user can list all users, suspend/delete, see audit log of significant actions, all through the UI.

**Estimate:** 1 day.

### 5.1 — Schema addition

- `src/migrations/003_audit.sql`: `audit_log` table per spec.

### 5.2 — Audit-write helper

- `src/core/audit.ts`: `recordAudit(repo, { actorId, action, targetId, metadata })`. Called from each operation that mutates user/team/role state.
- Operations to instrument: `user.create`, `user.suspend`, `user.delete`, `user.role.change`, `team.create`, `team.delete`, `team.invite.send`, `team.invite.accept`, `team.member.add`, `team.member.remove`, `team.member.role.change`, `team.transfer`.

### 5.3 — Admin operations module

- `src/admin/operations.ts`:
  - `listUsers({ search, page, pageSize })`.
  - `getUserDetail(userId)` — user + teams + recent audit.
  - `updateUser({ id, displayName?, role?, status? })`.
  - `suspendUser(id, actorId)` — sets status, revokes all sessions.
  - `deleteUser(id, actorId)` — hard delete (cascades).
  - `listAuditLog({ filters, limit })`.

### 5.4 — Admin plugin

- `src/admin/plugin.ts`: routes per spec, all gated on `req.user.role === 'admin'`.

### 5.5 — UI components

- `<AdminUsersTable />`: paginated table with search, role/status badges, actions.
- `<AdminUserDetail userId={...} />`: detail panel with team membership + audit history.
- `<AuditLog />`: filterable list.

### 5.6 — Demo app integration

- Demo backend registers `adminPlugin` with `adminEmails` from `.env`.
- Demo frontend `/admin` route renders `<AdminUsersTable />` + a link to `<AuditLog />` at `/admin/audit`.

**Verify:** as the admin user (whose email is in `ADMIN_EMAILS`), open `/admin`, see all users created during testing, change another user's display name + role, suspend them, see all those actions in the audit log.

## Stage 6 — Publish v1.0.0

**Outcome:** package is installable from GitHub Packages by any other project; README has a full quickstart copy-pasteable into a fresh consumer.

**Estimate:** 0.5 day.

### 6.1 — README quickstart

- Replace the placeholder README with:
  - One-paragraph overview.
  - Install snippet (`npm install @mahirick/users-and-teams`, `.npmrc` for GitHub Packages auth).
  - Fastify backend wire-up (copy from demo/backend).
  - React frontend wire-up (copy from demo/frontend).
  - Configuration reference (env vars + plugin options).
  - Schema reference + the `_uat_migrations` table-conflict note.
  - Theming guide (CSS variables).
  - Link to demo app and SPEC.md / PLAN.md for design rationale.

### 6.2 — Publish flow

- Configure `.npmrc` for `@mahirick` scope on GitHub Packages.
- `prepublishOnly` script runs `npm run build && npm test`.
- Flip `package.json` `private: false`.
- Tag `v1.0.0` and run `npm publish`.

**Verify:** in a fresh sibling directory, `npm init -y && npm install @mahirick/users-and-teams` resolves successfully. Wire-up snippet from the README produces a working auth flow.

## Sequencing notes

- Stages 1 → 2 → 3 must run in order — each builds on the previous.
- Stages 4 and 5 are independent of each other; build in either order after Stage 3.
- Stage 6 (publish) can land before Stages 4 + 5 if you want a v0.x release earlier — auth alone is useful for consumers that don't need teams or admin yet. In that case, retag v0.x for stages 1-3 and v1.0.0 once teams + admin are in.
- Tag the package after each stage (`v0.1.0`, `v0.2.0`, etc.). Treat semver seriously: BEM class names + types are public API from `v0.1.0` onward — renames require a major bump.

## Risk register

- **Resend deliverability** — first-send test might land in spam. Mitigations: SPF/DKIM/DMARC on the sending domain configured by each consumer. Verify in the demo app with a real Resend key before publishing v1.0.0.
- **Cookie scope across consumer projects** — a session cookie set by `app-a.example.com` doesn't apply to `app-b.example.com`. Each consumer gets its own session domain. Cross-project SSO is out of scope for v1.
- **CSS variable name collisions** — if two npm packages both ship `--accent`, hilarity. The `--uat-*` prefix is the firewall. Keep that namespace clean and never let internal styles slip through with non-prefixed vars.
- **better-sqlite3 native binding compatibility** — peer dep on the consumer's installed version. If consumers use different SQLite versions, the adapter compatibility could break. Mitigation: pin a tested range in the package's peer-dep semver.
- **Race condition on user creation** — two simultaneous `/auth/verify` requests for a brand-new email could both try to insert the user row. Solution: `INSERT OR IGNORE` + re-select, then the magic link only consumes once.
- **Migration table conflict with consumer** — if the consumer DB already has a `_migrations` table for their own schema, a generic name would collide. The runner uses `_uat_migrations` and that namespace is reserved.

## What I'm NOT going to build (yet)

- Two-factor / MFA.
- Password support (deliberate — magic link only).
- OAuth providers (Google/GitHub/etc.).
- Mobile / native app integration (separate epic).
- Bulk user import / CSV.
- Account merge (two emails → one user).
- Per-consumer state inside the package (per-user preferences, per-team domain data) — consumers own those tables.

These get their own specs when there's a reason to build them.
