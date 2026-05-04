// In-memory rate limiter using a sliding-window log per key. Two buckets:
// per-email and per-IP. Both must pass for a request to be allowed.
//
// Trade-offs (acceptable for v1):
// - In-memory: per-process, doesn't survive restart, doesn't span replicas.
//   For multi-instance deployments, add a Redis-backed limiter (out of scope).
// - Sliding-window log: O(N) per check where N = window size. At <1k MAU this
//   is trivial. If we ever need O(1), switch to a token-bucket with refill rate.

const HOUR_MS = 60 * 60 * 1000;

export interface RateLimitConfig {
  perEmailPerHour: number;
  perIpPerHour: number;
}

export interface RateLimitCheckArgs {
  email: string;
  ip: string;
  /** Override clock for testing. Defaults to Date.now(). */
  now?: number;
}

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number; reason: 'email' | 'ip' };

export interface RateLimiter {
  check(args: RateLimitCheckArgs): RateLimitResult;
  /** For tests: clear all state. */
  reset(): void;
}

export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  const emailHits = new Map<string, number[]>();
  const ipHits = new Map<string, number[]>();

  function prune(hits: number[], now: number): number[] {
    const cutoff = now - HOUR_MS;
    let i = 0;
    while (i < hits.length && hits[i]! < cutoff) i++;
    return i === 0 ? hits : hits.slice(i);
  }

  function checkBucket(
    key: string,
    map: Map<string, number[]>,
    limit: number,
    now: number,
  ): { ok: true } | { ok: false; retryAfterSeconds: number } {
    const existing = map.get(key) ?? [];
    const pruned = prune(existing, now);

    if (pruned.length >= limit) {
      // Earliest hit in window — wait until it slides out
      const earliest = pruned[0]!;
      const retryMs = earliest + HOUR_MS - now;
      const retryAfterSeconds = Math.max(1, Math.ceil(retryMs / 1000));
      // Save pruned list to keep memory bounded
      map.set(key, pruned);
      return { ok: false, retryAfterSeconds };
    }

    pruned.push(now);
    map.set(key, pruned);
    return { ok: true };
  }

  return {
    check({ email, ip, now }: RateLimitCheckArgs): RateLimitResult {
      const t = now ?? Date.now();

      const e = checkBucket(email, emailHits, config.perEmailPerHour, t);
      if (!e.ok) return { ok: false, retryAfterSeconds: e.retryAfterSeconds, reason: 'email' };

      const i = checkBucket(ip, ipHits, config.perIpPerHour, t);
      if (!i.ok) {
        // Roll back the email hit we just added so a per-IP block doesn't burn the email quota
        const list = emailHits.get(email);
        if (list && list[list.length - 1] === t) list.pop();
        return { ok: false, retryAfterSeconds: i.retryAfterSeconds, reason: 'ip' };
      }

      return { ok: true };
    },
    reset() {
      emailHits.clear();
      ipHits.clear();
    },
  };
}
