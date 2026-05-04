# Contributing

Thanks for taking a look. This is a small library that aims to stay small. Before opening a PR, check that your change fits the project's scope and conventions.

For deep technical context (architecture rules, what NOT to do, common task recipes), read [`CLAUDE.md`](./CLAUDE.md). It's written for Claude Code agents but is the most thorough developer doc in the repo.

## Dev setup

```bash
git clone https://github.com/mahirick/users-and-teams.git
cd users-and-teams
npm install
npm test                  # 224 tests should pass
```

You're ready to work.

## Workflow

1. **Read [`CLAUDE.md`](./CLAUDE.md)** — especially "Architecture rules" and "What NOT to do".
2. **Pick a stage** — feature work fits one of the six stages from [`PLAN.md`](./PLAN.md). New stages need a discussion first.
3. **Write the failing test first.** TDD is non-negotiable for new behavior. The existing test files demonstrate the cadence.
4. **Implement** until tests pass.
5. **Verify type-check + build:** `npm run lint && npm run build`.
6. **Smoke-test in `uat-test/`** if your change affects the public API surface (entries, route shapes, exported helpers).
7. **Commit** with a clear subject + bulleted body. AI-assisted commits include the `Co-Authored-By: Claude …` trailer.

## Test strategy

| Layer | Approach | Where |
|-------|----------|-------|
| Pure functions | Unit tests next to source | `src/**/*.test.ts` |
| Repository implementations | Shared 38-case contract suite | `src/adapters/contract.ts` |
| Auth / teams / admin operations | Pure-function unit tests with memory repo | `src/{auth,teams,admin}/operations.test.ts` |
| Fastify plugins | Integration tests via `Fastify.inject` | `src/{auth,teams,admin}/plugin.test.ts` |
| React UI components | `@testing-library/react` + jsdom | `src/ui/**/*.test.tsx` |
| Full browser smoke-test | Manual via Playwright on demo / uat-test | n/a |

When you add a new repository method, **add it to the contract** — not adapter-specific tests. Both adapters must satisfy the same contract.

## Two ways to test changes locally

**Fast iteration: in-repo demo (Vite alias to `src/`).**

```bash
npm run demo:backend
npm run demo:frontend
# http://localhost:5173 — changes to src/ hot-reload
```

**High-fidelity: `uat-test/` (real `file:..` npm install).**

```bash
cd uat-test
npm install                  # first time
npm run dev:backend
npm run dev:frontend
# http://localhost:5273
# After editing the package:
npm run update               # rebuild + reinstall
```

`uat-test/` exercises the package via `dist/` + `exports` map, the same way an external consumer does. Run it before merging changes that touch the public API surface.

## Coding conventions

- **TypeScript strict.** No `any`. Use `unknown` and narrow.
- **Function components** in React, hooks only.
- **BEM class names** in UI components: `.uat-{component}` and `.uat-{component}__{element}`. Public API — renames need a major bump.
- **`import type`** for type-only imports.
- **`.js` extensions** in imports even for `.ts` files (TSC ESM convention).
- **No `process.env` reads inside `src/`.** Plugins take options; consumers wire env vars at boot.
- **No `Date.now()` calls inside operations.** Accept `now: number` as a parameter so tests can pass fixed timestamps.
- **No raw tokens in storage.** Hash with `hashToken(t)` before persisting.
- **No `setErrorHandler` outside `authPlugin`.** Use `mapUatError(err)` if you want shared mapping in custom handlers.
- **No `.sql` or `.html` template files.** Inline as TS template strings.

## Public API surface

These are semver-stable from `v1.0.0`. Renames or signature changes require a major version bump:

- Exports from `src/index.ts` (`@mahirick/users-and-teams`)
- Exports from `src/react.ts` (`@mahirick/users-and-teams/react`)
- BEM class names in `src/ui/styles.css`
- Plugin route paths and request/response shapes
- Database schema (the migration files, not the runner)

When changing any of these, ask: would this break a consumer who's already on the previous version? If yes, it's a major bump.

## Running the demo flow end-to-end (browser)

```bash
# Terminal 1
npm run demo:backend

# Terminal 2
npm run demo:frontend
```

Visit `http://localhost:5173`. Click Sign in, submit any email. The magic link is printed in the backend's stdout — copy and paste it into the browser. You'll land back on `/` logged in. Then:

- Click the **Teams ▼** dropdown → Create team → fill in name + slug → Create
- On `/my-teams`, invite another email (the invite link is also in the backend log)
- For admin-only views, restart the backend with `ADMIN_EMAILS=you@example.com` in `demo/backend/.env`, sign in as that email, and visit `/admin-panel`

## Releasing

The package targets GitHub Packages under the `@mahirick` scope.

1. Bump `version` in `package.json`.
2. `npm test && npm run build` (the `prepublishOnly` hook does this anyway).
3. `git tag -a vX.Y.Z -m "vX.Y.Z — short summary"`.
4. `git push origin main vX.Y.Z`.
5. `npm login --scope=@mahirick --registry=https://npm.pkg.github.com`.
6. `npm publish`.

The `prepublishOnly` script gates publish on a clean test run + build.

## Asking questions / proposing changes

For anything bigger than a bug fix, open an issue on GitHub first. For one-line typos, just open a PR.

When in doubt, check [`CLAUDE.md`](./CLAUDE.md) or [`SPEC.md`](./SPEC.md). The spec records the design decisions; CLAUDE.md records the rules that enforce them.
