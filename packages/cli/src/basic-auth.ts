/**
 * Basic-auth guard for the CLI-served dashboard.
 *
 * `@portqueue/dashboard` ships no authentication of its own — protecting the mount is the host
 * application's job, done with whatever middleware it already uses (see the dashboard docs). The
 * CLI is the one case with no host application to speak of: `portqueue dashboard` opens a port
 * directly, so it brings its own guard rather than serving an unprotected admin UI.
 *
 * Credential parsing uses the `basic-auth` package; the comparison is constant-time so a wrong
 * password can't be recovered a byte at a time from response timings.
 */
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import auth from 'basic-auth';

export interface BasicAuthOptions {
  username: string;
  password: string;
  /** Shown in the browser's credential prompt. */
  realm?: string;
}

/**
 * Constant-time string compare that doesn't short-circuit on length. Both sides are padded to a
 * common length before the comparison, and the true lengths are only compared afterwards, so
 * neither the password nor its length leaks through timing.
 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  const len = Math.max(ab.length, bb.length, 1);
  const pa = Buffer.alloc(len);
  const pb = Buffer.alloc(len);
  ab.copy(pa);
  bb.copy(pb);
  return timingSafeEqual(pa, pb) && ab.length === bb.length;
}

/**
 * A `(req, res) => boolean` gate: returns true when the request is authorized and the caller
 * should carry on, false when it has already been answered with a 401 challenge.
 */
export function createBasicAuthGuard(
  options: BasicAuthOptions,
): (req: IncomingMessage, res: ServerResponse) => boolean {
  const realm = options.realm ?? 'PortQueue Dashboard';
  return (req, res) => {
    const credentials = auth(req);
    const ok =
      credentials !== undefined &&
      safeEqual(credentials.name, options.username) &&
      safeEqual(credentials.pass, options.password);
    if (ok) return true;
    res.writeHead(401, {
      'www-authenticate': `Basic realm="${realm}", charset="UTF-8"`,
      'content-type': 'text/plain; charset=utf-8',
    });
    res.end('Unauthorized');
    return false;
  };
}
