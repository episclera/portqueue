/** Raw-Node request helpers shared by the engine and adapters. */
import type { IncomingMessage } from 'node:http';

const MAX_BODY_BYTES = 1024 * 1024; // 1MB guard

/** Read a request body to a string, rejecting bodies over the 1MB guard. */
export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
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
