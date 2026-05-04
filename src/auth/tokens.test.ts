import { describe, expect, it } from 'vitest';
import { generateToken, hashToken } from './tokens.js';

describe('generateToken', () => {
  it('returns a base64url-safe string of at least 32 bytes (43+ chars)', () => {
    const token = generateToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('returns different tokens on each call', () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(generateToken());
    expect(set.size).toBe(1000);
  });
});

describe('hashToken', () => {
  it('returns a 64-character hex string (sha256)', () => {
    expect(hashToken('hello')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(hashToken('hello')).toBe(hashToken('hello'));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});
