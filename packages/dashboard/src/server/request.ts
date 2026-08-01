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
