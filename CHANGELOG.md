# Changelog

All notable changes to `@mahirick/users-and-teams` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
the project follows [Semantic Versioning](https://semver.org/).

---

## [v2.0.1] — 2026-05-04

### Added
- `LICENSE` (MIT) at the repo root.
- `CHANGELOG.md` (this file).
- `INTEGRATION.md` — SHA-pin install recipe and a "Migrating from a password gate" recipe for consumers swapping out a localStorage-style admin lock.

### Notes
No code changes. This is a packaging-only release so consumers can pin to a SHA that ships the LICENSE and the install docs they need.

---

## [v2.0.0] — 2026-05-04

### Added
- **One-click team join.** Adding an unknown email mints a single token written to *both* `team_invites` (pending-membership marker) and `magic_links` (so `/auth/verify` accepts it). The email is a verify URL; one click creates-or-logs-in the user and `consumePendingInvitesForUser` materializes the membership in the same request. No separate sign-up step.
- **Multi-add invites.** `POST /teams/:id/members` accepts `{ emails: string[] }` (up to 50, dedup'd case-insensitively). Returns HTTP 207 with `{ results: Array<{ email, status, code?, message? }> }`.
- **Pending-invite admin tools.** `GET /teams/:id/pending-invites`, `DELETE /…/:tokenHash` (cancel), `POST /…/:tokenHash/resend` (rotates token). React: `<PendingInvitesList />`.
- **Photo avatars.** Pluggable `AvatarStore` interface with a default `createFsAvatarStore`. Routes `POST/DELETE /me/avatar` and `POST/DELETE /teams/:id/avatar`. Server validates magic bytes + size + content type. Optional `processAvatar` hook lets consumers re-encode via `sharp` (security M1). React: `<Avatar />` (renders `<img>` when `url` is set, falls back to initials), `<AvatarUploader />` (drag-drop, canvas resize+crop, EXIF strip).
- **Postgres adapter.** `createPostgresRepository(client)` accepts any `pg.Pool`/`pg.Client`-shaped client. PG-flavored migration set + `runPostgresMigrations(client)`.
- **SMTP transport.** `smtpTransport({ host, port, from, auth })` wraps optional `nodemailer` peer.
- **Self-serve profile management.** `PATCH /me { displayName }` and `DELETE /me`. Owner self-deletion blocked. React: edit-name + delete-account flows in `<AccountMenu />`.
- **Team rename UI** via `<TeamProfile />`. Inline edit hits `PATCH /teams/:id`.
- **Member search** in `<TeamMembersList />`.
- **Audit log filters.** Action dropdown, actor/target id search, limit selector — pushed to the server query.
- **Light theme.** Auto-switches via `prefers-color-scheme`; force with `.uat-theme-light` class.
- **Initials avatars** for users and teams (deterministic from id; up to 2 ASCII chars derived from displayName/email/teamname).
- `INTEGRATION.md` — consumer-facing integration guide for AI agents and devs wiring the package into a downstream app.
- `prepare` script in `package.json` so git-based installs (`npm install github:mahirick/users-and-teams#…`) build `dist/` automatically.

### Changed (BREAKING)
- **Roles renamed and consolidated.** Three roles total:
  - `User.role: 'admin'` → **`'owner'`** (system-wide superuser).
  - `TeamMember.role: 'owner' | 'admin'` → **`'admin'`** (single per team, transferable).
  - `TeamMember.role: 'member'` → **`'user'`**.
  - Migration `004_membership_v2` updates values in place.
- **Team slug dropped.** `Team.slug` and `findTeamBySlug` removed. Lookups now use `team.id` (UUID) or `findTeamByNormalizedName`. Migration rebuilds the `teams` table.
- **Unique team names** (case-insensitive, whitespace-collapsed) via `name_normalized` column.
- **`Team.ownerId` → `Team.adminId`** for vocab consistency with the new role model.
- **`AuthPluginOptions.adminEmails` → `ownerEmails`**. Bootstrap email list for the system-Owner role.
- **`/teams/:id/transfer-ownership` → `/teams/:id/transfer-admin`**, plus operations rename: `transferOwnership` → `transferAdmin`.
- **`POST /teams/:id/invites` removed.** Replaced by **`POST /teams/:id/members`** with auto-add semantics. There is no accept/reject — "reject" is "leave."
- **`AcceptInvite` React component removed.** No longer needed; the magic-link verify flow handles it.
- **`TeamSlugTakenError` → `TeamNameTakenError`** (still 409).
- **Error responses no longer leak `err.message` for unknown 500s** (security M3). Default returns `{ error: 'internal_error' }`; original error goes to `fastify.log.error`. 401s now return `{ error: 'UNAUTHENTICATED', message: 'Authentication required' }`. Opt back in for dev with `AuthPluginOptions.exposeInternalErrors: true`.
- **Avatar-related fields added to `User` and `Team`:** `avatarColor`, `avatarInitials`, `avatarUrl`. The `useAuth().user` shape gained these too.

### Fixed
- `TeamSwitcher` dropdown no longer floats off-screen — the wrapper div now has `position: relative` (matches `AccountMenu`).
- `FSTWRN004` warning: `setErrorHandler` is registered only by `authPlugin`, so the teams/admin plugins don't double-set.

---

## [v1.0.0] — 2026-05-04

Initial release. Magic-link auth, sessions, teams (with the v1 owner/admin/member role model), audit log, React UI, SQLite + memory adapters, Console + Resend email transports.
