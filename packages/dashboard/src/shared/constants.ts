/** Constants shared between the dashboard client and server (avoid literal drift). */

/** Header + marker the client sends on every request so the server can assert same-origin. */
export const REQUESTED_WITH_HEADER = 'x-requested-with';
export const REQUESTED_WITH_MARKER = 'portqueue-dashboard';
