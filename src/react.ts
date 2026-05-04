// Browser-safe entry. Only the React UI module is exported here; nothing
// touches node:crypto, fastify, or better-sqlite3. Consumers import their
// frontend bits from `@mahirick/users-and-teams/react`.

export {
  UsersAndTeamsProvider,
  useAuth,
  type AuthContextValue,
  type PublicUser,
  type UsersAndTeamsProviderProps,
} from './ui/provider.js';
export { LoginForm, type LoginFormProps } from './ui/components/LoginForm.js';
export { AccountMenu, type AccountMenuProps } from './ui/components/AccountMenu.js';
export { VerifyResult, type VerifyResultProps } from './ui/components/VerifyResult.js';
export { TeamSwitcher, type TeamSwitcherProps } from './ui/components/TeamSwitcher.js';
export { InviteForm, type InviteFormProps } from './ui/components/InviteForm.js';
export { TeamMembersList, type TeamMembersListProps } from './ui/components/TeamMembersList.js';
export { AcceptInvite, type AcceptInviteProps } from './ui/components/AcceptInvite.js';
export { useTeams, type TeamMembership, type PublicTeam, type UseTeamsResult } from './ui/hooks/useTeams.js';
export { AdminUsersTable, type AdminUsersTableProps } from './ui/components/AdminUsersTable.js';
export { AuditLog, type AuditLogProps } from './ui/components/AuditLog.js';
