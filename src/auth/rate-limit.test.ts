import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rate-limit.js';

describe('createRateLimiter', () => {
  const baseConfig = {
    perEmailPerHour: 5,
    perIpPerHour: 20,
  };

  it('allows requests under the per-email limit', () => {
    const rl = createRateLimiter(baseConfig);
    for (let i = 0; i < 5; i++) {
      const result = rl.check({ email: 'a@example.com', ip: '127.0.0.1', now: 0 });
      expect(result.ok).toBe(true);
    }
  });

  it('blocks the 6th request in an hour for the same email', () => {
    const rl = createRateLimiter(baseConfig);
    for (let i = 0; i < 5; i++) {
      rl.check({ email: 'a@example.com', ip: '127.0.0.1', now: i });
    }
    const result = rl.check({ email: 'a@example.com', ip: '127.0.0.2', now: 6 });
    if (result.ok) throw new Error('expected block');
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('returns retryAfterSeconds based on the oldest hit in the window', () => {
    const rl = createRateLimiter(baseConfig);
    const T0 = 1_000_000;
    for (let i = 0; i < 5; i++) {
      rl.check({ email: 'a@example.com', ip: '1.1.1.1', now: T0 + i * 1000 });
    }
    // Next call at T0 + 5500 should be blocked; oldest is at T0
    const result = rl.check({ email: 'a@example.com', ip: '1.1.1.1', now: T0 + 5500 });
    if (result.ok) throw new Error('expected block');
    // Window is 1 hour = 3_600_000 ms. Retry-after = (T0 + 3_600_000) - (T0 + 5500) = 3_594_500ms ≈ 3595s
    expect(result.retryAfterSeconds).toBeGreaterThan(3500);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(3600);
  });

  it('allows again after the window slides past', () => {
    const rl = createRateLimiter(baseConfig);
    const T0 = 1_000_000;
    for (let i = 0; i < 5; i++) {
      rl.check({ email: 'a@example.com', ip: '1.1.1.1', now: T0 });
    }
    expect(rl.check({ email: 'a@example.com', ip: '1.1.1.1', now: T0 }).ok).toBe(false);
    // Skip past the 1-hour window
    expect(
      rl.check({ email: 'a@example.com', ip: '1.1.1.1', now: T0 + 3_600_001 }).ok,
    ).toBe(true);
  });

  it('blocks the 21st request in an hour for the same IP', () => {
    const rl = createRateLimiter(baseConfig);
    for (let i = 0; i < 20; i++) {
      const r = rl.check({ email: `a${i}@example.com`, ip: '1.1.1.1', now: i });
      expect(r.ok).toBe(true);
    }
    const blocked = rl.check({ email: 'newperson@example.com', ip: '1.1.1.1', now: 21 });
    expect(blocked.ok).toBe(false);
  });

  it('per-email and per-ip are tracked independently', () => {
    const rl = createRateLimiter(baseConfig);
    // Burn the email quota for a@
    for (let i = 0; i < 5; i++) {
      rl.check({ email: 'a@example.com', ip: '1.1.1.1', now: i });
    }
    // Different email but same IP — should still pass (IP under 20)
    const r = rl.check({ email: 'b@example.com', ip: '1.1.1.1', now: 6 });
    expect(r.ok).toBe(true);
  });
});
