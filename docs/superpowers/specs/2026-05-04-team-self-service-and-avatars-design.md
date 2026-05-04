# Team self-service + avatars — design

Status: approved 2026-05-04 (autonomous-mode authorization for implementation).

## Goal

Make `@mahirick/users-and-teams` support self-service teams the way Apple iMessage groups work: any signed-in user can create a team, the creator is the team Admin, members get auto-added when invited, and everyone has a recognizable avatar.

## Decisions

### Roles (3 total)

| Name | Scope | Field on the wire |
|---|---|---|
| **Owner** | System-wide superuser. Can do anything anywhere. | `User.role = 'owner'` |
| **Admin** | Team-level admin, the team's creator (transferable to another User). | `TeamMember.role = 'admin'` |
| **User** | Regular team member, also the default system role. | `User.role = 'user'`, `TeamMember.role = 'user'` |

This is a rename of the existing 5-value model. Migration `004_membership_v2.ts` updates field values in place. The existing `User.role='admin'` becomes `'owner'`. `TeamMember.role` collapses `'owner'+'admin'` → `'admin'` (creator/team-admin), `'member'` → `'user'`.

### Teams

- **Any signed-in user** can create a team. (Already true; we keep that.)
- **Team name** is required, unique (case-insensitive, whitespace-collapsed). Stored as `name` (display) and `name_normalized` (`lower(trim(collapse_internal_ws(name)))`, with a unique index).
- **Slug is dropped.** Column gone, API field gone. Lookups use `team.id`.
- **Admin** can rename the team, add members, remove members, delete the team.
- **User** can leave the team. **Admin** must transfer admin to another team member before leaving (existing `transferOwnership` repurposed and renamed `transferAdmin`).

### Membership flow (auto-add, no accept/reject)

- Admin enters an email → `POST /teams/:id/members` with `{ email }`.
  - **If the email matches an existing User:** add them immediately to `team_members` with role `'user'`. Send them a notification email ("You were added to *Team X*").
  - **If the email is unknown:** insert a row into `team_invites` (kept, repurposed as a pending-membership marker), then send a magic-link sign-up email ("You were added to *Team X* on *Site*. Sign in to see it."). On the user's first authenticated session, the auth flow scans `team_invites` for matching emails, creates memberships, and consumes the invites. No accept/reject UI; no `/teams/invites/accept` route.
- **Reject == Leave.** Same UI, same code path. Removed: explicit accept/reject endpoints and AcceptInvite component.

### Avatars

- **Source:** initials + color, derived deterministically.
- **Initials:** up to 2 characters, derived from `displayName` (split on whitespace), falling back to email local-part. ASCII-only after Unicode normalize.
- **Color:** stable hash of the id picks one of 10 named palette colors. Not Apple's iOS Contacts palette specifically — just a small palette of saturated, AA-contrast-with-white-text colors.
- **Shape:** circle. White text on saturated background. Two sizes: `md` (40px) and `lg` (56px). CSS via `--uat-*` tokens, opt-in.
- **Storage:** `users.avatar_color`, `users.avatar_initials`, same on `teams`. Pre-computed at write time, recomputed on rename.
- **No upload in v1.** Schema is forward-compatible — `avatar_url` can be added later without a breaking change.

## Public API impact (semver)

This is a **breaking change**. Bumping to `2.0.0`. The package is consumed only by the in-repo demo and `uat-test/`; external consumers don't exist yet, so we accept the break.

| Removed | Added | Renamed |
|---|---|---|
| `Team.slug` | `Team.nameNormalized`, `Team.avatarColor`, `Team.avatarInitials`, `User.avatarColor`, `User.avatarInitials` | `transferOwnership` → `transferAdmin` |
| `TeamSlugTakenError` | `TeamNameTakenError` | `User.role = 'admin'` → `'owner'` |
| `inviteMember` op + `POST /teams/:id/invites` route | `addMember` op + `POST /teams/:id/members` route | `TeamMember.role`: `'owner'`/`'admin'` → `'admin'`, `'member'` → `'user'` |
| `AcceptInvite` component + `/teams/invites/accept` route | `<Avatar/>` component, `<TeamProfile/>` rename surface | |

`mapUatError` updated to map `TeamNameTakenError` → 409.

## Implementation phases

Each phase is one atomic commit.

1. **Schema + role rename + slug drop + name uniqueness.** Migration 004; update Repository contract + adapters; update types; update permissions.ts; update operations.ts; update plugin (validation + error mapping); update tests; rebuild uat-test DB.
2. **Auto-add invite flow.** New `addMember` op replacing `inviteMember`. New notification email template. Auth plugin: on user upsert, scan + consume pending invites. Drop AcceptInvite component + route. Tests.
3. **Admin transfer-then-leave.** Rename `transferOwnership` → `transferAdmin`. Update permission for self-remove (admin blocked unless lone member triggers team delete). UI shows transfer picker when admin clicks Leave. Tests.
4. **Avatars (data + util).** `src/core/avatar.ts` with `deriveInitials(input)` and `pickColor(id)`. Wire computation into createUser, updateDisplayName, createTeam, editTeam (in operations + adapter inserts). Migration backfill computes for existing rows. Tests.
5. **Avatar UI + UX polish.** `<Avatar/>` React component. Use it in AccountMenu, TeamSwitcher, TeamMembersList, AdminUsersTable. Drop the slug field from the team-create form. Update copy: "Add member by email." Tests for component.
6. **Build + smoke + docs.** Rebuild package, `npm run update` in uat-test, restart backend, click through golden path manually. Update README and CLAUDE.md.

## Test strategy

- Repository contract tests cover the schema/role changes once for both adapters.
- Operations get unit tests as before (auto-add hits both branches: known email, unknown email).
- Plugin integration tests use Fastify.inject to verify the new routes.
- Avatar utility gets a small unit test (deterministic given input).
- Avatar component gets a render test (initials, color class).
- Manual smoke after each phase: build, restart, log in, exercise the changed feature.

## Out of scope (parking lot)

- Photo upload (schema is ready for it).
- Composite team avatars from member photos (Apple iMessage style).
- Team-admin delegation back to multi-tier (would re-introduce a middle role).
- In-app invite inbox (we picked auto-add instead).
