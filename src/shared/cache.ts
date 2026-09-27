/**
 * Redis cache layer using Upstash Redis.
 *
 * Environment variables:
 *   UPSTASH_REDIS_REST_URL  — Upstash Redis REST URL
 *   UPSTASH_REDIS_REST_TOKEN — Upstash Redis REST token
 *
 * Falls back to in-memory cache when Redis is not configured (local dev).
 */

import { Redis } from "@upstash/redis";

let redis: Redis | null = null;
let warnedNoRedis = false;

function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    // Warn once per process. Repeated warnings on every cache read showed up in
    // the dev overlay as a standing "issue" even though the in-memory fallback
    // is the intended, working behaviour when Redis is simply not configured.
    if (!warnedNoRedis) {
      warnedNoRedis = true;
      console.info("[cache] No Redis configured — using in-memory fallback (this is expected without REDIS_URL).");
    }
    return null;
  }
  redis = new Redis({ url, token });
  return redis;
}

// ── In-memory fallback ──────────────────────────────────────────────

const memCache = new Map<string, { value: string; expiresAt: number }>();

function memGet(key: string): string | null {
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memCache.delete(key);
    return null;
  }
  return entry.value;
}

function memSet(key: string, value: string, ttlSec: number) {
  memCache.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
}

function memDel(key: string) {
  memCache.delete(key);
}

function memDelPattern(pattern: string) {
  const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
  for (const k of memCache.keys()) {
    if (regex.test(k)) memCache.delete(k);
  }
}

// ── Public API ──────────────────────────────────────────────────────

export type CacheOptions = {
  ttlSec?: number; // time-to-live in seconds
  prefix?: string; // key prefix
};

function makeKey(key: string, prefix?: string): string {
  return prefix ? `${prefix}:${key}` : key;
}

/**
 * Get a cached value. Returns null on miss.
 */
export async function cacheGet<T>(key: string, opts?: CacheOptions): Promise<T | null> {
  const fullKey = makeKey(key, opts?.prefix);
  const r = getRedis();

  try {
    if (r) {
      const raw = await r.get(fullKey);
      return (raw as T) ?? null;
    }
    const raw = memGet(fullKey);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (err) {
    console.error(`[cache] GET ${fullKey} error:`, err);
    return null;
  }
}

/**
 * Set a cached value with optional TTL.
 */
export async function cacheSet<T>(key: string, value: T, opts?: CacheOptions): Promise<void> {
  const fullKey = makeKey(key, opts?.prefix);
  const ttl = opts?.ttlSec ?? 300; // default 5 minutes
  const r = getRedis();

  try {
    if (r) {
      await r.set(fullKey, JSON.stringify(value), { ex: ttl });
    } else {
      memSet(fullKey, JSON.stringify(value), ttl);
    }
  } catch (err) {
    console.error(`[cache] SET ${fullKey} error:`, err);
  }
}

/**
 * Delete a cached key.
 */
export async function cacheDel(key: string, opts?: CacheOptions): Promise<void> {
  const fullKey = makeKey(key, opts?.prefix);
  const r = getRedis();

  try {
    if (r) {
      await r.del(fullKey);
    } else {
      memDel(fullKey);
    }
  } catch (err) {
    console.error(`[cache] DEL ${fullKey} error:`, err);
  }
}

/**
 * Delete all keys matching a pattern.
 */
export async function cacheDelPattern(pattern: string, opts?: CacheOptions): Promise<void> {
  const fullPattern = makeKey(pattern, opts?.prefix);
  const r = getRedis();

  try {
    if (r) {
      // Upstash doesn't have SCAN — use KEYS (acceptable for small keyspaces)
      const keys = await r.keys(fullPattern);
      if (keys.length > 0) {
        await r.del(...keys);
      }
    } else {
      memDelPattern(fullPattern);
    }
  } catch (err) {
    console.error(`[cache] DEL_PATTERN ${fullPattern} error:`, err);
  }
}

/**
 * Get-or-set: return cached value, or compute + cache it.
 */
export async function cacheGetOrSet<T>(
  key: string,
  compute: () => Promise<T>,
  opts?: CacheOptions,
): Promise<T> {
  const cached = await cacheGet<T>(key, opts);
  if (cached !== null) return cached;

  const value = await compute();
  await cacheSet(key, value, opts);
  return value;
}

/**
 * Invalidate all cache entries for a prefix (e.g., after admin edits).
 */
export async function invalidatePrefix(prefix: string): Promise<void> {
  await cacheDelPattern("*", { prefix });
}
