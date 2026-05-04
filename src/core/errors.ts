// Typed error classes used across the package. Adapters and operations throw
// these; HTTP plugins translate them to status codes.

export class UsersAndTeamsError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'UsersAndTeamsError';
  }
}

export class UserNotFoundError extends UsersAndTeamsError {
  constructor(detail?: string) {
    super(detail ?? 'User not found', 'USER_NOT_FOUND');
    this.name = 'UserNotFoundError';
  }
}

export class SessionExpiredError extends UsersAndTeamsError {
  constructor() {
    super('Session expired', 'SESSION_EXPIRED');
    this.name = 'SessionExpiredError';
  }
}

export class InvalidTokenError extends UsersAndTeamsError {
  constructor(detail?: string) {
    super(detail ?? 'Invalid token', 'INVALID_TOKEN');
    this.name = 'InvalidTokenError';
  }
}

export class TokenExpiredError extends UsersAndTeamsError {
  constructor(detail?: string) {
    super(detail ?? 'Token expired', 'TOKEN_EXPIRED');
    this.name = 'TokenExpiredError';
  }
}

export class TokenAlreadyConsumedError extends UsersAndTeamsError {
  constructor() {
    super('Token already consumed', 'TOKEN_ALREADY_CONSUMED');
    this.name = 'TokenAlreadyConsumedError';
  }
}

export class RateLimitError extends UsersAndTeamsError {
  constructor(public readonly retryAfterSeconds: number) {
    super('Rate limit exceeded', 'RATE_LIMIT');
    this.name = 'RateLimitError';
  }
}

export class TeamNotFoundError extends UsersAndTeamsError {
  constructor() {
    super('Team not found', 'TEAM_NOT_FOUND');
    this.name = 'TeamNotFoundError';
  }
}

export class TeamSlugTakenError extends UsersAndTeamsError {
  constructor(slug: string) {
    super(`Team slug "${slug}" already taken`, 'TEAM_SLUG_TAKEN');
    this.name = 'TeamSlugTakenError';
  }
}

export class NotAuthorizedError extends UsersAndTeamsError {
  constructor(detail?: string) {
    super(detail ?? 'Not authorized', 'NOT_AUTHORIZED');
    this.name = 'NotAuthorizedError';
  }
}

export class UserSuspendedError extends UsersAndTeamsError {
  constructor() {
    super('User account is suspended', 'USER_SUSPENDED');
    this.name = 'UserSuspendedError';
  }
}
