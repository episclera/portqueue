/**
 * Claim-time instance affinity. Pure, engine-agnostic logic: portable SQL cannot evaluate regular
 * expressions and the sharded-friendly schema carries no indexes, so the claim path selects
 * candidates and applies affinity here in the tool.
 *
 * Affinity is a single **preferred key pattern**. A job with no pattern runs anywhere; a job with
 * a pattern runs only on an instance whose key matches it. There is no exact-key pin and no
 * fallback tier — a pattern already spans many instances, so the first live match takes the job,
 * and if none match it simply waits. Build patterns that scale (e.g. `ram-(4|8)gb`) rather than
 * pinning to one server that might disappear.
 */

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

/**
 * Does `selfKey` satisfy a preferred pattern? A `null` pattern means "no constraint" and matches
 * any instance. An invalid regex matches nothing (the job waits rather than running anywhere).
 */
export function matchesInstance(pattern: string | null, selfKey: string): boolean {
  if (pattern == null) return true;
  const re = compile(pattern);
  return re ? re.test(selfKey) : false;
}
