# CLAUDE.md — guide for Claude Code working in this repo

This file is for AI agents (Claude Code, Cursor, etc.) about to make changes here. It captures the design rationale, code conventions, and the small set of project-specific rules that aren't obvious from reading the source. Read this before any non-trivial change.

If a rule here conflicts with what the user explicitly asks, follow the user.

## What this is

`@mahirick/users-and-teams` — a self-hosted user / auth / teams / admin package designed to drop into any Fastify backend with a few lines of config. Magic-link auth + opaque sessions + role-based teams + admin audit log + optional React UI. Pluggable storage (SQLite + memory; Postgres planned) and email (console + Resend; SMTP planned).

It is **not** a service. It is a **library** consumed by other projects. Treat the public API surface (exports from `src/index.ts` and `src/react.ts`, plus BEM class names in `styles.css`) as semver-stable from `v1.0.0`.

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
│   └── audit.ts              # recordAudit + AUDIT_ACTIONS taxonomy
├── adapters/
│   ├── memory.ts             # in-memory Repository (tests, references)
│   ├── sqlite.ts             # better-sqlite3 Repository
│   └── contract.ts           # 38-case contract test suite both must pass
├── auth/
│   ├── tokens.ts             # generateToken (32 random bytes) + hashToken (sha256)
│   ├── magic-link.ts         # requestMagicLink helper
│   ├── session.ts            # verify, sliding-TTL, revoke, revokeAll
│   ├── rate-limit.ts         # in-memory token bucket
│   └── plugin.ts             # Fastify plugin: /auth/* + onRequest hook + setErrorHandler
├── teams/
│   ├── permissions.ts        # canEditTeam, canInvite, … (pure predicates)
│   ├── operations.ts         # createTeam, inviteMember, accept, transfer, …
│   └── plugin.ts             # Fastify plugin: /teams/*
├── admin/
│   ├── operations.ts         # listUsers, suspend, delete, audit log
│   └── plugin.ts             # Fastify plugin: /admin/*
├── email/
│   ├── types.ts              # EmailTransport interface
│   ├── console.ts            # dev (logs to stdout)
│   ├── resend.ts             # prod (fetch-based, no SDK dep)
│   └── templates.ts          # magic-link + invite HTML/text (inlined TS)
├── migrations/
│   ├── 001_initial.ts        # users, magic_links, sessions
│   ├── 002_teams.ts          # teams, team_members, team_invites
│   ├── 003_audit.ts          # audit_log
│   ├── index.ts              # ordered migration list
│   └── runner.ts             # _uat_migrations tracker; idempotent
├── ui/
│   ├── styles.css            # opt-in default theme (--uat-* vars)
│   ├── provider.tsx          # <UsersAndTeamsProvider>, useAuth
│   ├── provider-internal.ts  # internal context for hooks
│   ├── hooks/
│   │   └── useTeams.ts       # team list + create
│   └── components/
│       ├── LoginForm.tsx
│       ├── AccountMenu.tsx
│       ├── VerifyResult.tsx
│       ├── TeamSwitcher.tsx
│       ├── TeamMembersList.tsx
│       ├── InviteForm.tsx
│       ├── AcceptInvite.tsx
│       ├── AdminUsersTable.tsx
│       └── AuditLog.tsx

demo/                          # in-repo demo (Vite alias to src/, fast iteration)
├── backend/index.ts            # Fastify app
└── frontend/                   # Vite + React SPA

uat-test/                       # external-consumer test (file:.. dep, real install)
                                # gitignored; only present locally

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

Every adapter (`memory`, `sqlite`, future `postgres`) must satisfy the same contract test suite (`src/adapters/contract.ts`). Adding a new repository method:

1. Add the signature to `src/core/repository.ts`.
2. Add a test case to `src/adapters/contract.ts` that exercises the new behavior.
3. Both adapter test files (`memory.test.ts`, `sqlite.test.ts`) automatically pick it up.
4. Implement in both adapters until tests pass.

Never special-case in operations — if you need new behavior, push it down to the Repository contract.

### Operations modules vs plugins

Each domain has two layers:

- **Operations module** (`src/teams/operations.ts`, `src/admin/operations.ts`) — pure functions over `Repository` + transport + IDs. No Fastify, no HTTP. Throws typed errors.
- **Plugin** (`src/teams/plugin.ts`, `src/admin/plugin.ts`) — Fastify routes that validate input (zod), call operations, and let the shared error handler map thrown errors to status codes.

When adding a feature: write it as an operation first, test it with the memory repo, then add the route. The route should be ~5 lines: parse, call operation, return.

### Migrations are inline TS

`src/migrations/0NN_name.ts` exports `{ id, sql }` as TS template strings, not `.sql` files. This sidesteps asset-copying through the build pipeline. **Never** introduce a `.sql` file — the build won't ship it.

The migration runner uses `_uat_migrations` as its tracker table (namespaced) so the package can share a SQLite database with a consumer's own schema. **Never rename this table.**

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
npm test                  # vitest run (224 tests across 22 files)
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
- **Don't add backward-compat shims.** This package is at v1.0.0 — break versions, don't accumulate cruft.

## Where to look first

- "How does login actually work?" → `src/auth/magic-link.ts` (request) + `src/auth/session.ts` (verify) + `src/auth/plugin.ts` (HTTP).
- "What does a request hit?" → `onRequest` hook in `src/auth/plugin.ts` populates `request.user`.
- "How is permission checked?" → `src/teams/permissions.ts` for teams; `requireAdmin(actor)` in `src/admin/operations.ts` for admin.
- "Why does X return that status code?" → `src/core/error-handler.ts`.
- "How is data stored?" → migrations in `src/migrations/0NN_*.ts`; queries in `src/adapters/sqlite.ts`.
- "How is the package built?" → `tsconfig.build.json` + `package.json` `build` script. Outputs to `dist/`.
- "How are docs maintained?" → `README.md` is consumer-facing; `CLAUDE.md` (this file) is contributor-facing; `SPEC.md` and `PLAN.md` are historical design records.

## Historical artifacts

- `SPEC.md` — original design spec, all 12 open questions resolved 2026-05-04.
- `PLAN.md` — six-stage build plan executed top-to-bottom in commits `Stage 1` through `Stage 6` on `main`.

These are kept for historical reference. New work doesn't update them; it updates `README.md` and this file.
