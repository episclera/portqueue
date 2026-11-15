/**
 * Clean URLs: the dashboard routes with real paths under its mount
 * (`/portqueue/instances/worker.eu-1`), not a `#/` fragment.
 *
 * That works on reload and from a shared link because the server answers every path under the mount
 * that is not a bundle file with the app's shell (see `isAssetPath` in `server/assets.ts`) — which
 * is decided by folder, so a record named with a dot is still a page.
 */

/** react-router's `basename` for a mount. A root mount has none — `'/'` would double every slash. */
export function routerBasename(basePath: string): string {
  return basePath === '/' ? '' : basePath.replace(/\/+$/, '');
}
