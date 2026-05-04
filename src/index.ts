// Public barrel export — populated as stages land.
// Stage 1: core types, repository interface, adapters, migrations, email transports.
// Stage 2: auth plugin and helpers.
// Stage 3: UI components, hooks, provider.
// Stage 4: teams plugin and helpers.
// Stage 5: admin plugin and helpers.

export * from './core/types.js';
export * from './core/errors.js';
export type { Repository } from './core/repository.js';

export { createMemoryRepository } from './adapters/memory.js';
export { createSqliteRepository } from './adapters/sqlite.js';
export { runMigrations } from './migrations/runner.js';

export { consoleTransport } from './email/console.js';
export { resendTransport } from './email/resend.js';
export type { EmailTransport, EmailMessage } from './email/types.js';
