/**
 * Static config the server injects into the SPA shell.
 *
 * Only the mount path: the dashboard's title and its theme are the dashboard's own business. A
 * host-set title made the browser tab and the header disagree with every screenshot and doc page,
 * and a host-set default theme only pre-empted a choice the visitor makes in one click (and which
 * `localStorage` then remembers).
 */
export interface DashboardConfigDto {
  basePath: string;
  /**
   * The most ids one bulk action may carry — core's `MAX_BATCH_IDS`, delivered rather than copied.
   *
   * The client needs it to stop a selection growing past what the server will accept, and it cannot
   * import it: `@portqueue/core` reaches for `node:os`, `node:v8` and friends, so pulling a constant
   * out of it drags Node builtins into the browser bundle. Sending the value keeps one source of
   * truth for a limit the server enforces anyway.
   */
  maxBatchIds: number;
}
