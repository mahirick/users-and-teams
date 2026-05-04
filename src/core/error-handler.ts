// Shared error-to-status mapping. authPlugin uses this as its setErrorHandler,
// so teamsPlugin and adminPlugin don't need their own (avoiding Fastify's
// FSTWRN004 "overriding errorHandler in the same scope" warning).
//
// Consumers who want custom handling can either:
//   1. Skip setting their own handler and rely on this one (default), or
//   2. Set their own and call mapUatError(err) to delegate package errors:
//
//      import { mapUatError } from '@mahirick/users-and-teams';
//      app.setErrorHandler((err, req, reply) => {
//        const mapped = mapUatError(err);
//        if (mapped) {
//          reply.code(mapped.statusCode);
//          if (mapped.headers) for (const [k, v] of Object.entries(mapped.headers)) reply.header(k, v);
//          return mapped.body;
//        }
//        // your own handling…
//      });

import {
  AlreadyTeamMemberError,
  InvalidTokenError,
  NotAuthorizedError,
  RateLimitError,
  TeamNameTakenError,
  TeamNotFoundError,
  TokenAlreadyConsumedError,
  TokenExpiredError,
  UserNotFoundError,
  UserSuspendedError,
  UsersAndTeamsError,
} from './errors.js';

export interface MappedError {
  statusCode: number;
  body: { error: string; message: string; retryAfter?: number };
  headers?: Record<string, string>;
}

/**
 * Map a thrown value to an HTTP status + body if it is a known package error.
 * Returns null for unknown errors (the consumer should fall through to their
 * own handler / Fastify's default).
 */
export function mapUatError(err: unknown): MappedError | null {
  if (err instanceof RateLimitError) {
    return {
      statusCode: 429,
      body: { error: err.code, message: err.message, retryAfter: err.retryAfterSeconds },
      headers: { 'Retry-After': err.retryAfterSeconds.toString() },
    };
  }
  if (err instanceof NotAuthorizedError) {
    return { statusCode: 403, body: { error: err.code, message: err.message } };
  }
  if (err instanceof UserNotFoundError || err instanceof TeamNotFoundError) {
    return { statusCode: 404, body: { error: err.code, message: err.message } };
  }
  if (err instanceof TeamNameTakenError || err instanceof AlreadyTeamMemberError) {
    return { statusCode: 409, body: { error: err.code, message: err.message } };
  }
  if (
    err instanceof InvalidTokenError ||
    err instanceof TokenAlreadyConsumedError ||
    err instanceof TokenExpiredError ||
    err instanceof UserSuspendedError
  ) {
    return { statusCode: 400, body: { error: err.code, message: err.message } };
  }
  if (err instanceof UsersAndTeamsError) {
    return { statusCode: 400, body: { error: err.code, message: err.message } };
  }
  return null;
}
