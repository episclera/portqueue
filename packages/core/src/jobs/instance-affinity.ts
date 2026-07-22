/**
 * Claim-time instance affinity. Pure, engine-agnostic logic: portable SQL
 * cannot evaluate regular expressions, and the sharded-friendly schema carries no indexes, so
 * the claim path selects candidates and applies affinity here in the tool. A job may target an
 * instance by exact key or by a regex `pattern`; matching is liveness-aware so a job pinned to a
 * dead instance falls back (to its fallback target, or to anyone) rather than stranding.
 */

/** The affinity fields of a job that drive the claim decision. */
export interface JobAffinity {
  preferredInstanceKey: string | null;
  preferredInstanceKeyPattern: string | null;
  fallbackInstanceKey: string | null;
  fallbackInstanceKeyPattern: string | null;
}

// Compiled-regex cache. Patterns are developer-provided (not end-user), so the surface for
// pathological expressions is small; an invalid pattern compiles to `null` and matches nothing.
const regexCache = new Map<string, RegExp | null>();

function compile(pattern: string): RegExp | null {
  const cached = regexCache.get(pattern);
  if (cached !== undefined) return cached;
  let re: RegExp | null;
  try {
    re = new RegExp(pattern);
  } catch {
    re = null;
  }
  regexCache.set(pattern, re);
  return re;
}

/** Is a constraint (exact key and/or pattern) expressed at all? */
function hasConstraint(exact: string | null, pattern: string | null): boolean {
  return exact != null || pattern != null;
}

/** Does a single instance key satisfy the exact/pattern constraint? */
function matches(key: string, exact: string | null, pattern: string | null): boolean {
  if (exact != null) return key === exact;
  if (pattern != null) {
    const re = compile(pattern);
    return re ? re.test(key) : false;
  }
  return false;
}

/** Is any currently-alive instance a match for the exact/pattern constraint? */
function anyAliveMatches(
  aliveKeys: readonly string[],
  exact: string | null,
  pattern: string | null,
): boolean {
  if (exact != null) return aliveKeys.includes(exact);
  if (pattern != null) {
    const re = compile(pattern);
    return re ? aliveKeys.some((k) => re.test(k)) : false;
  }
  return false;
}

/**
 * Decide whether the instance `selfKey` may claim `job`, given the set of currently-alive
 * instance keys (which always includes `selfKey`). Precedence: unpinned → anyone; preferred
 * match → mine; preferred targets a live *other* → theirs; preferred all dead → fall back
 * (fallback match → mine; fallback targets a live other → theirs; otherwise rescue).
 */
export function canClaim(
  job: JobAffinity,
  selfKey: string,
  aliveKeys: readonly string[],
): boolean {
  if (!hasConstraint(job.preferredInstanceKey, job.preferredInstanceKeyPattern)) return true;
  if (matches(selfKey, job.preferredInstanceKey, job.preferredInstanceKeyPattern)) return true;
  if (anyAliveMatches(aliveKeys, job.preferredInstanceKey, job.preferredInstanceKeyPattern)) {
    return false;
  }
  // Every preferred target is dead — consider the fallback.
  if (!hasConstraint(job.fallbackInstanceKey, job.fallbackInstanceKeyPattern)) return true;
  if (matches(selfKey, job.fallbackInstanceKey, job.fallbackInstanceKeyPattern)) return true;
  if (anyAliveMatches(aliveKeys, job.fallbackInstanceKey, job.fallbackInstanceKeyPattern)) {
    return false;
  }
  // Fallback is dead too — rescue rather than strand.
  return true;
}
