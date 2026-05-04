// Cryptographic primitives for magic-link and session tokens. Plain Node
// crypto — no extra dependencies, no JWT.

import { createHash, randomBytes } from 'node:crypto';

/**
 * 32 random bytes (256 bits of entropy), base64url encoded.
 * The output has no padding and contains only [A-Za-z0-9_-].
 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hash of the token, hex encoded. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
