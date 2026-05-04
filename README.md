# `@mahirick/users-and-teams`

A reusable npm package for self-hosted user accounts and team management. Drops into any Fastify backend with a few lines of config.

## What's in the package

- **Auth:** email magic-link login, opaque sessions in HTTPOnly cookies, env-based admin allowlist.
- **Teams:** create / invite / manage teams with role-based membership.
- **Admin:** list users, suspend, delete, view audit log.
- **UI:** React components (LoginForm, AccountMenu, TeamSwitcher, etc.) themable via CSS variables.
- **Adapters:** SQLite (better-sqlite3) and in-memory; Postgres planned.
- **Email:** console (dev) and Resend (prod); SMTP planned.

## Status

Pre-release. See [`SPEC.md`](./SPEC.md) for design and [`PLAN.md`](./PLAN.md) for the build roadmap.

- 2026-05-04: spec + plan finalized; ready to build.

## Repo layout

- `src/` — package source (auth, teams, admin, UI, adapters, email).
- `demo/backend/` — minimal Fastify app exercising the full package end-to-end.
- `demo/frontend/` — minimal Vite React app rendering the UI components against the demo backend.
- `tests/` — unit + integration tests.

## Quickstart

> Filled in once Stage 6 of `PLAN.md` lands.

For now, see `SPEC.md` "What a consumer does" for the wiring shape.
