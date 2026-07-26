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
}
