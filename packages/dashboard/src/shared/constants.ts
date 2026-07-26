/** Constants shared between the dashboard client and server (avoid literal drift). */

/**
 * The dashboard's name, in the browser tab and in the fallback shell. Fixed, not a host option:
 * the product has one name, and a host-set title only made the tab disagree with the header, the
 * docs and every screenshot.
 */
export const DASHBOARD_TITLE = 'PortQueue Dashboard';

/** Header + marker the client sends on every request so the server can assert same-origin. */
export const REQUESTED_WITH_HEADER = 'x-requested-with';
export const REQUESTED_WITH_MARKER = 'portqueue-dashboard';
