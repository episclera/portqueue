/**
 * Pluggable dashboard auth guard. Protects the dashboard endpoint
 * itself, never the DB. `readOnly` is enforced separately in routes; this module only
 * answers "may this request reach the dashboard at all?".
 */
import { timingSafeEqual } from 'node:crypto';

/** A minimal, framework-agnostic view of an incoming request for custom guards. */
export interface AuthRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
}

/** A custom guard may return a plain boolean or a richer result. */
export interface AuthResult {
  authorized: boolean;
  /** Optional role; a guard can grant read-only vs full control. */
  readOnly?: boolean;
}

export interface DashboardAuth {
  mode: 'none' | 'basic' | 'custom';
  /** For `basic`. */
  username?: string;
  /** For `basic`. */
  password?: string;
  /** For `custom`. */
  guard?: (req: AuthRequest) => Promise<boolean | AuthResult> | boolean | AuthResult;
}

export interface AuthDecision {
  authorized: boolean;
  /** True when the resolved identity is restricted to read-only. */
  readOnly: boolean;
  /** Set when a 401 should be returned with a Basic challenge. */
  challenge?: string;
}

/** Constant-time string compare that never short-circuits on length. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // Compare against a fixed-length buffer to avoid leaking length via timing.
  const len = Math.max(ab.length, bb.length, 1);
  const pa = Buffer.alloc(len);
  const pb = Buffer.alloc(len);
  ab.copy(pa);
  bb.copy(pb);
  const equal = timingSafeEqual(pa, pb);
  return equal && ab.length === bb.length;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function parseBasic(header: string | undefined): { user: string; pass: string } | null {
  if (!header) return null;
  const prefix = 'Basic ';
  if (!header.startsWith(prefix)) return null;
  const decoded = Buffer.from(header.slice(prefix.length), 'base64').toString('utf8');
  const idx = decoded.indexOf(':');
  if (idx === -1) return null;
  return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
}

/**
 * Evaluate the configured guard against a request. Never throws; returns a decision the
 * router turns into a 401/403 or lets through.
 */
export async function authorize(
  auth: DashboardAuth | undefined,
  req: AuthRequest,
): Promise<AuthDecision> {
  if (!auth || auth.mode === 'none') {
    return { authorized: true, readOnly: false };
  }

  if (auth.mode === 'basic') {
    const provided = parseBasic(firstHeader(req.headers['authorization']));
    const expectedUser = auth.username ?? '';
    const expectedPass = auth.password ?? '';
    const ok =
      provided !== null &&
      safeEqual(provided.user, expectedUser) &&
      safeEqual(provided.pass, expectedPass);
    if (ok) return { authorized: true, readOnly: false };
    return { authorized: false, readOnly: false, challenge: 'Basic realm="PortQueue Dashboard"' };
  }

  // custom
  if (auth.mode === 'custom' && typeof auth.guard === 'function') {
    const result = await auth.guard(req);
    if (typeof result === 'boolean') {
      return { authorized: result, readOnly: false };
    }
    return { authorized: result.authorized, readOnly: result.readOnly ?? false };
  }

  // Misconfigured custom mode: deny.
  return { authorized: false, readOnly: false };
}
