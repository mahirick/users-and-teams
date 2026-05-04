// Public barrel export — server-side only. Browser-safe React UI lives at
// @mahirick/users-and-teams/react.

export * from './core/types.js';
export * from './core/errors.js';
export { mapUatError, type MappedError } from './core/error-handler.js';
export type { Repository } from './core/repository.js';
export {
  deriveInitials,
  pickColor,
  normalizeTeamName,
  AVATAR_PALETTE,
} from './core/avatar.js';

export { createMemoryRepository } from './adapters/memory.js';
export { createSqliteRepository } from './adapters/sqlite.js';
export { runMigrations } from './migrations/runner.js';

export { consoleTransport } from './email/console.js';
export { resendTransport } from './email/resend.js';
export type { EmailTransport, EmailMessage } from './email/types.js';
export {
  magicLinkEmail,
  addedToTeamEmail,
  signupAddedToTeamEmail,
} from './email/templates.js';

// Auth module
export { authPlugin, type AuthPluginOptions } from './auth/plugin.js';
export { requestMagicLink, type RequestMagicLinkInput } from './auth/magic-link.js';
export {
  verifyMagicLinkAndCreateSession,
  verifySession,
  revokeSession,
  revokeAllSessionsForUser,
} from './auth/session.js';
export {
  createRateLimiter,
  type RateLimiter,
  type RateLimitConfig,
  type RateLimitResult,
} from './auth/rate-limit.js';
export { generateToken, hashToken } from './auth/tokens.js';

// Teams module
export { teamsPlugin, type TeamsPluginOptions } from './teams/plugin.js';
export {
  createTeam,
  addMember,
  consumePendingInvitesForUser,
  listMyTeams,
  listMembers,
  removeMember,
  transferAdmin,
  deleteTeam,
  editTeam,
} from './teams/operations.js';
export {
  canDeleteTeam,
  canEditTeam,
  canAddMember,
  canRemoveMember,
  canTransferAdmin,
} from './teams/permissions.js';

// Admin module (system-Owner cross-team operations)
export { adminPlugin, type AdminPluginOptions } from './admin/plugin.js';
export {
  listUsers,
  getUserDetail,
  updateUser,
  suspendUser,
  unsuspendUser,
  deleteUser,
  listAuditLog,
  type UserDetail,
} from './admin/operations.js';

// Audit
export { recordAudit, AUDIT_ACTIONS, type AuditAction } from './core/audit.js';
