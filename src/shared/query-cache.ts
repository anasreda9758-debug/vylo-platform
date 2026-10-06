/**
 * Cache wrappers for hot-path queries.
 * Each wrapper checks cache first, falls back to DB, then caches the result.
 */

import { cacheGetOrSet, cacheDel, invalidatePrefix } from "@/shared/cache";

// ── TTL constants ───────────────────────────────────────────────────

const TTL = {
  /** University hierarchy + curriculum structure — rarely changes */
  CURRICULUM: 60 * 30, // 30 minutes
  /** Leaderboard — refresh every 15 minutes */
  LEADERBOARD: 60 * 15, // 15 minutes
  /** RAG index — rebuild every 10 min anyway, cache for 5 */
  RAG_INDEX: 60 * 5, // 5 minutes
  /** Module access — per-user, short TTL since subs can change */
  MODULE_ACCESS: 60 * 2, // 2 minutes
  /** Plans list — rarely changes */
  PLANS: 60 * 60, // 1 hour
} as const;

// ── Curriculum ──────────────────────────────────────────────────────

export async function getCachedCurriculum(userId: string, studyYear?: number) {
  return cacheGetOrSet(
    `curriculum:v3:${userId}:${studyYear ?? "all"}`,
    async () => {
      const { getCurriculum } = await import("@/features/curriculum/queries");
      return getCurriculum(userId, studyYear);
    },
    { ttlSec: TTL.CURRICULUM, prefix: "horus" },
  );
}

export async function invalidateCurriculumCache() {
  await invalidatePrefix("horus:curriculum");
}

// ── Leaderboard ─────────────────────────────────────────────────────

export async function getCachedLeaderboard(limit = 20) {
  return cacheGetOrSet(
    `leaderboard:${limit}`,
    async () => {
      const { getLeaderboard } = await import("@/features/gamification/queries");
      return getLeaderboard(limit);
    },
    { ttlSec: TTL.LEADERBOARD, prefix: "horus" },
  );
}

export async function invalidateLeaderboardCache() {
  await invalidatePrefix("horus:leaderboard");
}

// ── Plans ───────────────────────────────────────────────────────────

export async function getCachedPlans() {
  return cacheGetOrSet(
    "plans",
    async () => {
      const { getPlans } = await import("@/features/billing/queries");
      return getPlans();
    },
    { ttlSec: TTL.PLANS, prefix: "horus" },
  );
}

export async function invalidatePlansCache() {
  await invalidatePrefix("horus:plans");
}

// ── Module Access (per-user) ────────────────────────────────────────

export async function getCachedModuleAccess(
  userId: string,
  module: { id: string; slug: string; isFree: boolean; term: number },
) {
  return cacheGetOrSet(
    `access:${userId}:${module.slug}`,
    async () => {
      const { hasModuleAccess } = await import("@/features/billing/queries");
      return hasModuleAccess(userId, module);
    },
    { ttlSec: TTL.MODULE_ACCESS, prefix: "horus" },
  );
}

export async function invalidateUserAccessCache(userId: string) {
  await invalidatePrefix(`horus:access:${userId}`);
}
