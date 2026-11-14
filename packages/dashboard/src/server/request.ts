/** Raw-Node request helpers shared by the engine and adapters. */
import type { IncomingMessage } from 'node:http';
import { MAX_BODY_BYTES } from '../shared/constants';

/**
 * Read a request body to a string, rejecting anything over {@link MAX_BODY_BYTES}.
 *
 * On overflow it stops accumulating and **keeps reading** rather than destroying the socket. The
 * caller answers 413, and a client can only read that answer if the connection is still there —
 * `req.destroy()` mid-stream closed a keep-alive connection instead, so the client saw a transport
 * error where a clear status was available. The remaining bytes are discarded as they arrive, so
 * nothing accumulates in memory either way.
 */
export function readBody(req: IncomingMessage): Promise<string> {
  // A body parser mounted above the dashboard (`express.json()` is in most host apps) has already
  // drained the stream, so `end` has fired and will not fire again — waiting for it hung the request
  // forever. Recover what that parser left on `req.body` instead.
  if (req.readableEnded) return alreadyRead(req);
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (tooLarge) return;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        reject(new BodyTooLargeError());
        return;
      }
      resolveBody(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

/**
 * The body a host's parser already consumed, back as the string the router expects, under the same
 * cap. A parsed object is re-serialized — it came from JSON, so this round-trips — and nothing at all
 * reads as an empty body, which the router answers with a 400 rather than a hang.
 */
function alreadyRead(req: IncomingMessage): Promise<string> {
  const parsed = (req as IncomingMessage & { body?: unknown }).body;
  let text: string;
  if (parsed === undefined || parsed === null) text = '';
  else if (typeof parsed === 'string') text = parsed;
  else if (Buffer.isBuffer(parsed)) text = parsed.toString('utf8');
  else text = JSON.stringify(parsed);
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return Promise.reject(new BodyTooLargeError());
  return Promise.resolve(text);
}

/** Why {@link readBody} rejected: the body passed the cap, and the answer is a 413. */
export class BodyTooLargeError extends Error {
  constructor() {
    super(`Request body exceeds the ${MAX_BODY_BYTES}-byte limit`);
    this.name = 'BodyTooLargeError';
  }
}

export function toHeaders(req: IncomingMessage): Record<string, string | string[] | undefined> {
  return req.headers as Record<string, string | string[] | undefined>;
}

/** Normalize a mount path: ensure a leading slash, drop a trailing one. */
export function normalizeBase(basePath: string): string {
  let b = basePath.trim();
  if (!b.startsWith('/')) b = `/${b}`;
  if (b.length > 1 && b.endsWith('/')) b = b.slice(0, -1);
  return b;
}
