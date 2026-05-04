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
