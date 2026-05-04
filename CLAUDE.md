# CLAUDE.md — guide for Claude Code working in this repo

This file is for AI agents (Claude Code, Cursor, etc.) about to make changes here. It captures the design rationale, code conventions, and the small set of project-specific rules that aren't obvious from reading the source. Read this before any non-trivial change.

If a rule here conflicts with what the user explicitly asks, follow the user.

## What this is

`@mahirick/users-and-teams` — a self-hosted user / auth / teams / admin package designed to drop into any Fastify backend with a few lines of config. Magic-link auth + opaque sessions + role-based teams + admin audit log + optional React UI. Pluggable storage (SQLite, in-memory, Postgres) and email (console, Resend, SMTP).

It is **not** a service. It is a **library** consumed by other projects. Treat the public API surface (exports from `src/index.ts` and `src/react.ts`, plus BEM class names in `styles.css`) as semver-stable. Currently at **v2.0.0** — the v1→v2 break introduced auto-add team membership, dropped slugs, and renamed roles to Owner/Admin/User (see `docs/superpowers/specs/2026-05-04-team-self-service-and-avatars-design.md`).

## Distribution

The package is **not** on the public npm registry yet. Consumers install from GitHub:

```bash
npm install github:mahirick/users-and-teams#v2.0.0
```

The `prepare` script (in `package.json`) builds `dist/` on the consumer's machine after `npm install` — npm runs `prepare` automatically for git-based deps. The consumer doesn't need to know about `tsc`. The script is a no-op when `dist/` already exists, so it doesn't churn during local development in this repo.

`publishConfig` points at GitHub Packages (`npm.pkg.github.com`, `restricted` access) so we can publish there later without flipping a switch. The public-npm path is wide open whenever we want — bump the version, drop `publishConfig`, run `npm publish`.

When you cut a release: `git tag -a vX.Y.Z -m "…" && git push origin vX.Y.Z`. Consumers pin via `#vX.Y.Z` in their `package.json`.

## Consumer-facing docs

- **`INTEGRATION.md`** (root) — written for the AI agent + dev integrating this package into a downstream app (e.g. ScoreTracker). Has the canonical 8-line skeleton, full backend example, decision tree for storage / email / avatars, conventions consumers should follow, and a snippet they paste into their own CLAUDE.md / AGENTS.md. **Update this file whenever you add a public option, change a default, or alter the install story.** Also listed in `package.json` `files` so it ships in the published tarball.
- **`README.md`** — consumer-facing overview, links to `INTEGRATION.md`.

## Roles (v2)

Three names, two scopes:

| Name | Scope | Field |
|---|---|---|
| **Owner** | System-wide | `User.role = 'owner'`. Cross-team superuser. |
| **Admin** | Per team | `TeamMember.role = 'admin'` and `Team.adminId`. Exactly one per team. |
| **User** | Default everywhere | `User.role = 'user'`, `TeamMember.role = 'user'`. |

System Owners bypass team-permission checks. Each team has exactly one Admin (transferable via `transferAdmin`).

## Membership flow (auto-add, one-click join)

There is no accept/reject. `POST /teams/:id/members` accepts `{ emails: string[] }` (multi-add up to 50 per request, dedup'd case-insensitively). For each email:

- **Existing user** → `addTeamMember` immediately + notification email (`addedToTeamEmail`).
- **Unknown email** → mint a single token, write it to **both** `team_invites` (pending-membership marker, keyed by email) AND `magic_links` (so `/auth/verify` accepts it). Email contains `${siteUrl}/auth/verify?token=…`. One click creates-or-logs-in the user and `consumePendingInvitesForUser` (called from `auth/session.ts`) materializes the membership in the same request. No separate sign-up step.

`resendPendingInvite` rotates the token (deletes the old `team_invites` row, mints a new one in both tables) so the previous email's link stops working immediately.

Per-entry results come back as HTTP 207 with `{ results: Array<{ email, status: 'added' | 'pending_signup' | 'error', code?, message?, userId? }> }`. Auth failures (NotAuthorizedError) abort the whole batch with 403; per-email errors (already-member, invalid email) live in the per-entry result.

"Reject" is "leave" — same code path. Admins must `transferAdmin` before leaving.

## Repo layout

```
src/
├── index.ts                  # server entry — Fastify-side exports
├── react.ts                  # browser-safe entry — React UI exports
├── core/
│   ├── types.ts              # User, Session, Team, etc. shapes
│   ├── repository.ts         # storage interface (no implementation)
│   ├── errors.ts             # typed error classes
│   ├── error-handler.ts      # shared mapUatError() (see "Error handling")
│   ├── audit.ts              # recordAudit + AUDIT_ACTIONS taxonomy
│   └── avatar.ts             # deriveInitials, pickColor, normalizeTeamName
├── adapters/
│   ├── memory.ts             # in-memory Repository (tests, references)
│   ├── sqlite.ts             # better-sqlite3 Repository
│   ├── postgres.ts           # pg-shaped Repository (any pg.Pool/Client client)
│   └── contract.ts           # contract test suite — every adapter must pass
├── auth/
│   ├── tokens.ts             # generateToken (32 random bytes) + hashToken (sha256)
│   ├── magic-link.ts         # requestMagicLink helper
│   ├── session.ts            # verify, sliding-TTL, revoke, revokeAll
│   ├── rate-limit.ts         # in-memory token bucket
│   └── plugin.ts             # Fastify plugin: /auth/*, /me/*, onRequest hook, setErrorHandler
├── teams/
│   ├── permissions.ts        # canEditTeam, canAddMember, canRemoveMember, canTransferAdmin
│   ├── operations.ts         # createTeam, addMember, transferAdmin, deleteTeam, editTeam, …
│   └── plugin.ts             # Fastify plugin: /teams/*
├── admin/
│   ├── operations.ts         # listUsers, suspend, delete, audit log
│   └── plugin.ts             # Fastify plugin: /admin/* (system-Owner gated)
├── avatars/
│   ├── types.ts              # AvatarStore interface, ALLOWED_AVATAR_MIME, MAX_AVATAR_BYTES
│   └── fs.ts                 # createFsAvatarStore — default disk-backed implementation
├── email/
│   ├── types.ts              # EmailTransport interface
│   ├── console.ts            # dev (logs to stdout)
│   ├── resend.ts             # Resend (fetch-based, no SDK dep)
│   ├── smtp.ts               # SMTP (wraps optional `nodemailer` peer)
│   └── templates.ts          # magic-link + addedToTeam + signupAddedToTeam HTML/text (inlined TS)
├── migrations/
│   ├── 001_initial.ts        # users, magic_links, sessions
│   ├── 002_teams.ts          # teams, team_members, team_invites
│   ├── 003_audit.ts          # audit_log
│   ├── 004_membership_v2.ts  # role rename, drop slug, add avatar cols, name_normalized
│   ├── 005_avatar_urls.ts    # avatar_url on users + teams
│   ├── index.ts              # ordered SQLite migration list
│   ├── runner.ts             # SQLite runner: _uat_migrations tracker; idempotent
│   └── postgres/
│       ├── index.ts          # pgMigrations (parallel set, BIGINT/$N flavored)
│       └── runner.ts         # runPostgresMigrations(client) — same _uat_migrations tracker
├── ui/
│   ├── styles.css            # opt-in default theme (--uat-* vars; light + dark via prefers-color-scheme)
│   ├── provider.tsx          # <UsersAndTeamsProvider>, useAuth (incl. updateDisplayName, deleteAccount, uploadAvatar, removeAvatar)
│   ├── provider-internal.ts  # internal context for hooks
│   ├── hooks/
│   │   └── useTeams.ts       # team list + create
│   └── components/
│       ├── Avatar.tsx        # initials or <img> when url present
│       ├── AvatarUploader.tsx# drag-drop, canvas resize+crop, EXIF strip
│       ├── LoginForm.tsx
│       ├── AccountMenu.tsx   # display-name edit, sign out, delete account, avatar uploader
│       ├── VerifyResult.tsx
│       ├── TeamSwitcher.tsx
│       ├── TeamProfile.tsx   # inline rename + team avatar uploader
│       ├── TeamMembersList.tsx # member search, transfer-admin-then-leave
│       ├── PendingInvitesList.tsx # admin-only resend / cancel
│       ├── InviteForm.tsx    # multi-email textarea (`;`-separated, validated)
│       ├── AdminUsersTable.tsx
│       └── AuditLog.tsx      # action / actorId / targetId / limit filters

demo/                          # in-repo demo (Vite alias to src/, fast iteration)
├── backend/index.ts            # Fastify app
└── frontend/                   # Vite + React SPA

uat-test/                       # external-consumer test (file:.. dep, real install)

INTEGRATION.md                  # consumer-facing integration guide (ships in the published tarball)

docs/superpowers/specs/         # approved feature specs (v2 design + security review)

tests/                          # currently empty — all tests live next to source
```

**Tests live next to source** as `*.test.ts` / `*.test.tsx`. The build excludes them. There is no separate `tests/` directory.

## Architecture rules

### Two entry points: `index.ts` and `react.ts`

The package is consumed by both Node (Fastify backends) and browsers (React frontends). Browsers can't `import 'node:crypto'` or `'fastify'`. So:

- **`@mahirick/users-and-teams`** (`src/index.ts`) — server entry. Exports plugins, repositories, email transports, auth helpers, types, errors. Anything that touches `node:crypto`, `fastify`, or `better-sqlite3` lives here.
- **`@mahirick/users-and-teams/react`** (`src/react.ts`) — browser-safe entry. Exports React components, hooks, the Provider, and shared types. Imports nothing Node-specific.

When adding a new export: ask "does a frontend-only consumer need this?" If yes → `react.ts`. If no → `index.ts`. **Never re-export Node-using modules from `react.ts`**, or browser bundlers will crash.

### `fp`-wrapped Fastify plugins

`authPlugin`, `teamsPlugin`, and `adminPlugin` are wrapped with `fastify-plugin` so:
- `request.user` decoration bleeds out to the consumer's routes
- Plugin names are addressable for `dependencies: ['users-and-teams-auth']`

This means encapsulation is removed. `setErrorHandler` is **only** called in `authPlugin` (see "Error handling" below) — calling it again in teams/admin would trigger Fastify's FSTWRN004 warning.

### Repository contract = single source of truth

Every adapter (`memory`, `sqlite`, `postgres`) must satisfy the same contract test suite (`src/adapters/contract.ts`). Adding a new repository method:

1. Add the signature to `src/core/repository.ts`.
2. Add a test case to `src/adapters/contract.ts` that exercises the new behavior.
3. Both adapter test files (`memory.test.ts`, `sqlite.test.ts`) automatically pick it up.
4. Implement in `memory.ts`, `sqlite.ts`, AND `postgres.ts` until contract tests pass.

The Postgres adapter doesn't run the contract suite in CI (would need a live PG or `pg-mem` dep). Manual verification: pipe a real PG into the contract harness with a custom `setup` callback. Until that's wired, treat changes touching `postgres.ts` with extra care — TypeScript catches signature drift, but behavioral parity (e.g. how BIGINT epoch values come back as strings) is on you.

Never special-case in operations — if you need new behavior, push it down to the Repository contract.

### Operations modules vs plugins

Each domain has two layers:

- **Operations module** (`src/teams/operations.ts`, `src/admin/operations.ts`) — pure functions over `Repository` + transport + IDs. No Fastify, no HTTP. Throws typed errors.
- **Plugin** (`src/teams/plugin.ts`, `src/admin/plugin.ts`) — Fastify routes that validate input (zod), call operations, and let the shared error handler map thrown errors to status codes.

When adding a feature: write it as an operation first, test it with the memory repo, then add the route. The route should be ~5 lines: parse, call operation, return.

### Migrations are inline TS, per-driver

Two parallel migration sets live in the repo:

- **SQLite:** `src/migrations/00N_name.ts` exports `{ id, sql }` as TS template strings, registered in `src/migrations/index.ts`, run by `runMigrations(db)`.
- **Postgres:** `src/migrations/postgres/index.ts` exports the same logical migrations as `pgMigrations`, written in PG-flavored SQL (BIGINT, `$N` parameters, `IF NOT EXISTS`, etc.). Run by `runPostgresMigrations(client)`.

**When you add a migration, add it to BOTH sets.** SQLite goes into `migrations/00N_name.ts` + `migrations/index.ts`; Postgres goes into the `pgMigrations` array in `migrations/postgres/index.ts`. The `id` strings must match between the two so consumers using either backend end up at the same logical schema version.

`.sql` files are **never** introduced — the build pipeline doesn't ship non-TS assets except `styles.css`. Inline as TS template strings.

Both runners use `_uat_migrations` as the tracker table (namespaced) so the package can share a database with the consumer's own schema. **Never rename this table.**

Migration `004_membership_v2` had to do a `CREATE teams_v2 / INSERT … SELECT / DROP / RENAME` dance in SQLite because SQLite can't `DROP COLUMN` on a UNIQUE column. Postgres doesn't have that limitation, so the PG version of the same migration uses straight `ALTER TABLE … DROP COLUMN`. Watch for that kind of divergence when writing future schema-changing migrations.

### Error handling

Single `setErrorHandler` registered by `authPlugin`, which calls `mapUatError(err)` from `src/core/error-handler.ts`. Adding a new typed error:

1. Add the error class to `src/core/errors.ts` (extend `UsersAndTeamsError`, set a unique `code`).
2. Add a case to `mapUatError` in `src/core/error-handler.ts`.
3. The plugins automatically pick it up — no per-plugin wiring.

`mapUatError` is also a public export so consumers who set their own `setErrorHandler` can delegate.

### Tokens never live in plaintext

Magic-link and session tokens are 32 bytes of `crypto.randomBytes`, base64url-encoded. Storage always hashes with `sha256`. The raw token is in the cookie or URL (one-time); the database holds only the hash.

If you find yourself storing a raw token, that's a bug.

### Time is injectable

Most operations accept an optional `now: number` parameter. Tests pass fixed timestamps; production uses `Date.now()`. **Never** call `Date.now()` directly inside an operation — accept it as a param. (Adapters and `recordAudit` are the only places where the default-to-`Date.now()` shorthand lives.)

### Configuration is per-plugin, not per-env

Plugins take options at registration. Env vars are conveniences for boot-time wiring (the demo backend reads them; the package itself doesn't). **Never** read `process.env` from inside the package source.

## Build, test, run

```bash
npm install
npm test                  # vitest run (237 tests across 23 files as of v2.0.0)
npm run lint              # tsc --noEmit
npm run build             # tsc + cp styles.css → dist/

# Demo (fast iteration, Vite alias to src/)
npm run demo:backend      # http://127.0.0.1:3000
npm run demo:frontend     # http://localhost:5173
npm run demo:reset        # rm demo SQLite db

# Test as a real external consumer (file:.. dep)
cd uat-test
npm install               # first time
npm run dev:backend       # http://127.0.0.1:3100
npm run dev:frontend      # http://localhost:5273
npm run update            # rebuild package + reinstall after a package edit
npm run reset             # rm test SQLite db
```

### Verifying the GitHub-install path

Before tagging a release, do a clean install from a temp directory to catch missing files in `package.json` `files`, broken `prepare`, or peer-dep regressions:

```bash
SCRATCH=$(mktemp -d) && cd "$SCRATCH"
npm init -y > /dev/null && echo '{"type":"module"}' > package.json
npm install github:mahirick/users-and-teams#main fastify @fastify/cookie better-sqlite3
node --input-type=module -e "import {createMemoryRepository, deriveInitials} from '@mahirick/users-and-teams'; console.log(deriveInitials({displayName:'John Smith'}))"
```

Should print `JS`. If it errors with `Cannot find module 'fastify'` or similar, the consumer side is off (peer-dep instructions in `INTEGRATION.md` are wrong) or `prepare` didn't run. If it prints anything else, the build is broken.

## Conventions

### TypeScript

- `strict: true`, `noUncheckedIndexedAccess: true`. Mistyped accesses are caught.
- `verbatimModuleSyntax: false` — but always import types with `import type` for clarity.
- Imports use `.js` extensions even for `.ts` files (TSC ESM convention).
- Prefer `interface` for public shapes, `type` for unions / mapped types.
- Never `any`. Use `unknown` and narrow.

### Tests

- **TDD per the superpowers rule** — write the failing test first, watch it fail, then implement. The existing test files demonstrate the cadence.
- **Pure functions** get unit tests next to source (`*.test.ts`).
- **Adapter implementations** must satisfy the contract suite (`adapters/contract.ts`). Don't write adapter-specific tests — extend the contract.
- **Plugins** get integration tests using `Fastify.inject` + an in-memory SQLite DB. The auth plugin tests demonstrate the pattern (login flow capturing cookies from Set-Cookie headers).
- **UI components** use `@testing-library/react` with `jsdom`. The `vitest.setup.ts` file wires `cleanup()` between tests; `vitest.config.ts` matches `src/ui/**` to the jsdom environment.
- **Browser smoke tests** are manual via Playwright on the demo or uat-test. Not in CI.

### React

- Function components only.
- BEM class names from the package: `uat-{component}` and `uat-{component}__{element}` (e.g., `.uat-login__input`). These are public API — renames require a major bump.
- Components accept `className?: string` to merge consumer classes.
- Hook deps must be exhaustive. The `useEffect` dep array is non-negotiable — if you need to skip a dep, refactor to remove the dep entirely.

### Imports

Server-side: `import { … } from '@mahirick/users-and-teams'` (or relative `'./foo.js'` inside the package).
Browser-side: `import { … } from '@mahirick/users-and-teams/react'`.

The demo uses Vite aliases to point both to source. The uat-test consumer uses a real `file:..` dep against `dist/`.

### Commit messages

Subject line: stage / feature, ≤ 70 chars. Body: bulleted summary of what shipped, including test counts. Always include the Co-Authored-By trailer for AI-assisted commits.

## Common tasks

### Adding a new typed error

1. `src/core/errors.ts` — declare class, set `code` to `SHOUTING_SNAKE`.
2. `src/core/error-handler.ts` — add the `instanceof` branch in `mapUatError`. Pick the right HTTP status.
3. Throw it from operations as appropriate; the plugin layer picks it up automatically.

### Adding a new Fastify route to teams/admin

1. Implement in the operations module first with a unit test.
2. In the plugin, add a route handler — keep it ≤ 10 lines: zod parse → call op → return.
3. Add a plugin integration test that hits the route via `inject`.

### Adding a new UI component

1. Test file (`*.test.tsx`) using `render` + `@testing-library`. Watch it fail.
2. Implement, using the existing components as a style reference (BEM, `--uat-*` vars, `className?: string` prop).
3. Add corresponding CSS to `src/ui/styles.css`.
4. Export from `src/react.ts`.
5. Use it in the demo (`demo/frontend/App.tsx`) and visually verify.

### Adding a new repository method

1. Add to the `Repository` interface in `src/core/repository.ts`.
2. Add cases to `src/adapters/contract.ts`. Watch them fail.
3. Implement in `src/adapters/memory.ts` until contract tests pass.
4. Implement in `src/adapters/sqlite.ts` until contract tests pass.
5. (If audit-relevant) call `recordAudit` from the operation that uses the new method.

### Adding a new migration

1. Create `src/migrations/0NN_thing.ts` exporting `{ id, sql }`.
2. Append to the array in `src/migrations/index.ts`.
3. Existing test cases in `src/migrations/runner.test.ts` will exercise the runner.
4. **Never modify or reorder existing migrations.** The runner skips ones already in `_uat_migrations`, so changes to existing entries are silently ignored on production databases.

### Adding a new plugin option

1. Add the field to the plugin's options interface (`AuthPluginOptions`, `TeamsPluginOptions`, `AdminPluginOptions`).
2. Apply a default at the top of the plugin function.
3. Update `README.md`'s configuration section.
4. Update `INTEGRATION.md` if the option matters for getting started (storage, email, avatars, theming, owner bootstrap). If it's a niche dev-only flag (`exposeInternalErrors`, custom rate-limit configs), the source comment is enough.

### Cutting a release

1. Bump `version` in `package.json`. Semver: breaking changes → major; new option / feature → minor; bug fix → patch.
2. Run `npm test` and `npm run lint` to confirm clean.
3. Run `npm run build` so `dist/` is fresh — useful for sanity-checking exports, not strictly required since `prepare` rebuilds on consumer install.
4. Commit: `git commit -am "vX.Y.Z — short description"`.
5. Tag: `git tag -a vX.Y.Z -m "vX.Y.Z — short description"`.
6. Push: `git push origin main && git push origin vX.Y.Z`.
7. Verify the GitHub-install path against the new tag (snippet under "Verifying the GitHub-install path" above; substitute `#vX.Y.Z` for `#main`).
8. Update `CLAUDE.md`'s test count + `INTEGRATION.md`'s install snippet if either drifted.

## What NOT to do

- **Don't ship `.sql` or `.html` template files.** Inline as TS template strings. The build pipeline doesn't copy non-TS assets except `styles.css` (which is opt-in via the consumer's `import '@mahirick/users-and-teams/styles.css'`).
- **Don't add `node:crypto` / `fastify` / `better-sqlite3` imports under `src/ui/`.** They poison the browser bundle.
- **Don't `setErrorHandler` in any plugin other than `authPlugin`.** Use `mapUatError` if you need shared mapping in a custom handler.
- **Don't read `process.env` from package source.** Demo + consumer code reads env; plugins take options.
- **Don't bypass the Repository interface.** Operations should never reach into `db` directly. If you need a query, expose it as a Repository method first.
- **Don't reorder or modify shipped migrations.** Add a new one.
- **Don't store raw tokens.** `hashToken(t)` before storing. Always.
- **Don't use class-based React components.** Function components + hooks only.
- **Don't add a CSS framework.** The 16-token `--uat-*` system is the design system.
- **Don't add backward-compat shims.** Break versions, don't accumulate cruft.

## Where to look first

- "How does login actually work?" → `src/auth/magic-link.ts` (request) + `src/auth/session.ts` (verify) + `src/auth/plugin.ts` (HTTP).
- "How does the one-click team-join actually work?" → `addMember` in `src/teams/operations.ts` mints a token written to BOTH `team_invites` and `magic_links`; the email points at `/auth/verify?token=…`. On verify, the standard magic-link path creates-or-logs-in the user, then `consumePendingInvitesForUser` (in `auth/session.ts`) materializes the membership.
- "What does a request hit?" → `onRequest` hook in `src/auth/plugin.ts` populates `request.user`.
- "How is permission checked?" → `src/teams/permissions.ts` for teams; `requireOwner(actor)` in `src/admin/operations.ts` for system Owner gate.
- "Why does X return that status code?" → `src/core/error-handler.ts`. Note: unknown 500s do NOT echo `err.message` by default (security M3) — flip `exposeInternalErrors: true` in dev.
- "How is data stored?" → SQLite migrations in `src/migrations/0NN_*.ts`; PG migrations in `src/migrations/postgres/index.ts`; queries in `src/adapters/{sqlite,postgres}.ts`.
- "How are avatars stored?" → `src/avatars/types.ts` for the `AvatarStore` interface; `src/avatars/fs.ts` for the FS default. Upload routes in `src/auth/plugin.ts` (`/me/avatar`) and `src/teams/plugin.ts` (`/teams/:id/avatar`). Validation (magic bytes + size + MIME) lives in `decodeAvatarDataUrl`.
- "How is the package built?" → `tsconfig.build.json` + `package.json` `build` script. Outputs to `dist/`. Git-installed consumers get a fresh build via the `prepare` script.
- "How are docs maintained?" → `README.md` is the elevator pitch + API reference; `INTEGRATION.md` is the consumer integration guide (read by AI agents in downstream apps); `CLAUDE.md` (this file) is contributor-facing; `docs/superpowers/specs/` holds approved feature specs and the security review; `SPEC.md` + `PLAN.md` are pre-1.0 historical records.

## Historical artifacts

- `SPEC.md` — original (v1) design spec.
- `PLAN.md` — six-stage v1 build plan (commits `Stage 1` through `Stage 6`).
- `docs/superpowers/specs/2026-05-04-team-self-service-and-avatars-design.md` — v2 spec (auto-add membership, role rename, avatars).
- `docs/superpowers/specs/2026-05-04-security-review.md` — security audit. **M1 + M3 resolved**, M2/M4/M5 documented as known limitations.

These are kept for historical reference. New work doesn't update them; it updates `README.md`, `INTEGRATION.md`, and this file.
