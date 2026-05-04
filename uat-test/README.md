# uat-test — local consumer of `@mahirick/users-and-teams`

A scratch project that installs the package via `file:..` (not the Vite alias the in-repo demo uses), so it's a real consumer test. The package's own repo ignores this directory.

## First run

```bash
# In ../ first, build the package once:
cd ..
npm run build
cd uat-test

# Install (reads file:.. → copies the built dist into node_modules)
npm install
```

Then in two terminals:

```bash
npm run dev:backend     # Fastify on :3100
npm run dev:frontend    # Vite + React on :5273
```

Visit `http://localhost:5273`.

## After changes to the package

The `file:..` dependency only sees the **built** `dist/`. After editing the package source:

```bash
npm run update          # rebuilds the package and reinstalls
# Or manually:
# (cd .. && npm run build) && npm install --no-audit --no-fund
```

Then restart `dev:backend` (Vite HMR catches frontend changes automatically once `update` ran).

## Reset DB

```bash
npm run reset
```

## Default admin

`admin@test.local` is in `ADMIN_EMAILS` by default. Sign in with that to see the Admin tab.

## What's here

- `backend/server.ts` — Fastify app registering authPlugin + teamsPlugin + adminPlugin against a SQLite DB at `backend/test.db`. Adds a `/api/whoami` route to prove `request.user` flows through.
- `frontend/main.tsx` + `App.tsx` — wires `<UsersAndTeamsProvider>` and exercises every UI primitive (LoginForm, AccountMenu, TeamSwitcher, TeamMembersList, InviteForm, AcceptInvite, AdminUsersTable, AuditLog, VerifyResult) on dedicated routes.
- `frontend/vite.config.ts` — proxies `/auth`, `/api`, `/teams`, `/admin*` to the backend; dedupes React.
