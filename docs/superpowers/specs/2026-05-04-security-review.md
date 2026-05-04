# Security review — `@mahirick/users-and-teams` v2.0

Date: 2026-05-04
Scope: server-side package code (`src/`), email transports, avatar uploads, the uat-test consumer wiring. Review against OWASP Top 10 (2021) plus library-specific surfaces.

## TL;DR

No high-severity findings. M1 (avatar processing hook) and M3 (error-message echo stripping) **resolved** in the follow-up commit; M2/M4/M5 remain open as documented limitations. The package's overall security posture is solid: parameterized queries throughout, opaque session tokens hashed at rest, single shared error mapper, and a magic-link auth flow with rate limiting.

`npm audit --omit dev` reports **0 vulnerabilities** in production dependencies. Five moderate findings exist in dev-only deps (vite / vitest chain) that don't ship.

## Findings

### ✅ A03:2021 — Injection

**Status: clean.**

- All SQL queries use parameter binding (`?` for SQLite, `$N` for Postgres). Grepped for any string-concatenated SQL — no occurrences of `\${…}` in `db.prepare(`…`)` or `client.query(`…`)`. The only dynamic SQL is column-list generation in `updateUser` / `updateTeam` patches, where column names are not user-controlled.
- HTML email templates escape user-controllable fields (`siteName`, `teamName`, `inviterName`/`addedByName`, `addedByEmail`) via `escapeHtml`.
- React renders all user-controlled strings safely.

### ✅ A01:2021 — Broken Access Control

**Status: clean.**

- Every team-mutating route checks `canAddMember` / `canRemoveMember` / `canTransferAdmin` / `canEditTeam` before acting. Predicates are pure functions — easy to audit.
- Admin (system Owner) routes gated by `requireOwner(actor)` (`src/admin/operations.ts`).
- `/me` routes scoped to `req.user.id` only — no impersonation surface.
- Owner self-deletion blocked (`OWNER_SELF_DELETE`) so the only Owner can't lock the consumer out of their own admin panel.
- Team Admin self-removal blocked unless they `transferAdmin` first.

### ✅ A02:2021 — Cryptographic Failures

**Status: clean.**

- Magic-link and session tokens: 32 bytes from `crypto.randomBytes`, base64url-encoded. Stored as `sha256(token)` only. Raw token only ever lives in the cookie or magic-link URL, never in the DB.
- Cookies: `HttpOnly`, `SameSite=lax`, `Secure` toggled by `cookieSecure` option (defaults to `process.env.NODE_ENV === 'production'`).
- No password storage. No JWTs (and therefore no signing-key rotation hazard).

### ✅ A07:2021 — Authentication Failures

**Status: clean.**

- Magic links: single-use (`consumed_at`), TTL 15 min by default, rate-limited at 5/email/hour and 20/IP/hour.
- Sessions: sliding 90-day TTL by default, revocable individually (`/auth/logout`) or wholesale (`/auth/logout-all`).
- Suspended-user check (`UserSuspendedError`) blocks login + nukes existing sessions.

### ✅ A05:2021 — Security Misconfiguration

**Status: clean (defaults are conservative).**

- `setErrorHandler` returns mapped errors with stable `code` values; unknown errors return generic `{ error: 'internal_error', message }` and the message is the `Error.message` text (see `M3` below).
- The auto-add invite flow does not enumerate users — `addMember` returns the same shape (`pending_signup`) regardless of whether the email is valid format-wise.
- `/auth/request-link` returns 200 for unknown emails (no enumeration).

### ✅ A09:2021 — Security Logging and Monitoring

**Status: adequate for a library.**

- Audit log records every state-changing admin action with actor, target, action, and structured metadata (`src/core/audit.ts`).
- Consumer is responsible for shipping logs / setting up alerting on the audit table.

### ✅ CSRF

**Status: clean.**

- All authenticated state-changing endpoints (POST/PATCH/DELETE) rely on a `SameSite=lax` cookie. Cross-site POST/PATCH/DELETE won't send the cookie, so CSRF via fetch/form is blocked.
- The only authenticated GET that mutates state is `/auth/verify` — but that consumes a single-use token from the URL, not the cookie, so a cross-site link click is the *intended* flow and there's no other-user-account-mutation risk.

### ✅ M1 — Avatar processing hook (resolved)

**Resolved 2026-05-04 (commit follows this doc).** `AuthPluginOptions.processAvatar` and `TeamsPluginOptions.processAvatar` accept an `(bytes, contentType) → Promise<{bytes, contentType}>` callback. The route runs it between `decodeAvatarDataUrl` and `AvatarStore.put`. Throwing from the processor returns a clean 400 (`invalid_image`) and the original error goes to `fastify.log.error`.

Recommended consumer wiring with `sharp`:

```ts
import sharp from 'sharp';

await app.register(authPlugin, {
  // …
  processAvatar: async (bytes) => ({
    bytes: await sharp(bytes).resize(512, 512, { fit: 'cover' }).webp({ quality: 85 }).toBuffer(),
    contentType: 'image/webp',
  }),
});
```

The package itself still doesn't take `sharp` as a dep — the 80MB native binary stays a consumer choice.

### ⚠ M2 — `requireUser` 401 returns "internal_error" status word

**Where:** `src/teams/plugin.ts:requireUser`, `src/admin/plugin.ts:requireOwnerUser`.
**Risk:** Low/Cosmetic. The function throws a plain `Error` with `statusCode = 401`. The shared error handler (`mapUatError`) only matches `instanceof UsersAndTeamsError` subclasses, so this falls through to the generic branch and returns `{ error: 'internal_error', message: 'Authentication required' }`. Misleading code label; status is correct.
**Recommendation:** Introduce `UnauthenticatedError extends UsersAndTeamsError` and map to 401 in `mapUatError`. Replace the raw `throw err` calls.

### ✅ M3 — Error-handler message echo (resolved)

**Resolved 2026-05-04 (commit follows this doc).** Default behaviour now returns `{ error: 'internal_error' }` for unknown 500s — no `message` field. Original error goes to `fastify.log.error(err)`. 401s return a stable label `{ error: 'UNAUTHENTICATED', message: 'Authentication required' }` so the UI can render a sign-in prompt without echoing internals.

Consumers can opt back in for development with `AuthPluginOptions.exposeInternalErrors: true`. Tests cover both branches (`src/auth/plugin.test.ts` › `error-handler hardening`).

### ⚠ M4 — No rate limiting on team/member mutations

**Where:** `src/teams/plugin.ts`.
**Risk:** Low/Medium. A signed-in user could spam team creation, multi-add invites (capped at 50 emails per request, but no per-user-per-hour limit), or rename teams in a tight loop to enumerate which names are taken.
**Recommendation:** Apply the existing `rateLimiter` to team-mutation routes — e.g. 50 team creations / day / user, 100 member-adds / day / team.

### ⚠ M5 — `AvatarStore` URLs trusted by `<img src>` without scheme check

**Where:** `src/ui/components/Avatar.tsx`.
**Risk:** Medium for consumers that implement custom `AvatarStore` returning user-controlled URLs.
**Mitigation in place:** The default `createFsAvatarStore` builds URLs from a fixed `urlPrefix` and a sanitized key, so the URL is always `<urlPrefix>/users/<uuid>.jpg?v=…`. No scheme injection.
**Recommendation:** Document that custom `AvatarStore` implementations MUST return URLs starting with `https://`, `http://`, or `/`. Add a runtime check on the way *out* of `AvatarStore.put` in the plugin layer that rejects `javascript:` / `data:` schemes (server-side belt-and-braces).

## Smaller notes (good-to-do)

- **N1** — `decodeAvatarDataUrl` regex matches data URLs case-insensitively for the mime — good. But it doesn't strip whitespace from base64 (some clients pretty-print). Browsers don't, so low impact; can normalize.
- **N2** — `team_invites` rows are not deleted on team deletion via the auto-add flow. We rely on the `ON DELETE CASCADE` from `teams(id)`. Verified in migration 002.
- **N3** — Repository's `deleteUser` cascades sessions and memberships via SQL FK + memory adapter loops, but **does not delete pending magic links** for that user's email. Stale magic links time out, so impact is bounded by `magicLinkTtlMin`.
- **N4** — We have no global "unsubscribe email link" or "I didn't request this" flow. For users added by an admin, the only escape is to log in and Leave. Acceptable for a minimal library; flag for future work if abuse becomes a real issue.

## Pre-merge checklist

`M1` and `M3` are resolved. `M2`, `M4`, and `M5` are documented limitations that ship with v2 as-is.

---

Reviewer: Claude (Opus 4.7), assisted code review pass against OWASP Top 10 + library-specific risk surface. Not a substitute for a third-party penetration test before any consumer goes live with PII at scale.
