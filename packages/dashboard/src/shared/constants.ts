/** Constants shared between the dashboard client and server (avoid literal drift). */

/**
 * The dashboard's name, in the browser tab and in the fallback shell. Fixed, not a host option:
 * the product has one name, and a host-set title only made the tab disagree with the header, the
 * docs and every screenshot.
 */
export const DASHBOARD_TITLE = 'PortQueue Dashboard';

/**
 * Header + marker the client sends on every request, and the server **requires** on every mutation.
 *
 * This is the mount's CSRF defence, and it works because of what a browser will not do: a custom
 * request header cannot be set on a cross-origin request unless a preflight allows it, and the
 * dashboard answers no CORS preflight at all. So a form post or `fetch` from another page reaches
 * the mount without the marker and is refused — which matters because the mount is usually behind
 * cookie or basic auth, and a browser replays both on a cross-site request.
 *
 * It costs the host nothing: there is no option to set and nothing to configure.
 */
export const REQUESTED_WITH_HEADER = 'x-requested-with';
export const REQUESTED_WITH_MARKER = 'portqueue-dashboard';

/**
 * The largest request body the mount reads, in bytes.
 *
 * Here rather than in the reader that enforces it, because it is a property of the API the client
 * talks to: the only mutation that carries a payload of any size is `add`, whose `data` this bounds.
 */
export const MAX_BODY_BYTES = 1024 * 1024;
