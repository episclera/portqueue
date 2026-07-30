/**
 * Claim-time instance affinity. Pure, engine-agnostic logic: portable SQL cannot evaluate regular
 * expressions, so the claim path selects candidates and applies affinity here in the tool.
 *
 * Affinity is a single **preferred key pattern**. A job with no pattern runs anywhere; a job with
 * a pattern runs only on an instance whose key matches it. There is no exact-key pin and no
 * fallback tier — a pattern already spans many instances, so the first live match takes the job,
 * and if none match it simply waits. Build patterns that scale (e.g. `ram-8gb.*cpu-4cor`) rather
 * than pinning to one server that might disappear.
 *
 * **Nothing is cached.** A pattern is compiled where it is used, from the value the candidate row
 * carries. A module-global compiled-regex map would be process-lifetime state shared by every
 * PortQueue in the process — which contradicts "DI per PortQueue instance" — and it bought nothing:
 * constructing a `RegExp` is cheap next to the round trip that fetched the row it came from.
 */

/**
 * Does `selfKey` satisfy a preferred pattern? A `null` pattern means "no constraint" and matches
 * any instance. An invalid regex matches nothing (the job waits rather than running anywhere).
 */
export function matchesInstance(pattern: string | null, selfKey: string): boolean {
  if (pattern == null) return true;
  try {
    return new RegExp(pattern).test(selfKey);
  } catch {
    return false;
  }
}
