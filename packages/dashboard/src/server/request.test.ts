/**
 * `readBody` — the request-body reader and its size cap.
 *
 * The cap is the interesting part. On overflow the reader used to `destroy()` the socket mid-stream,
 * which on a keep-alive connection closes it: the caller's 413 was written to a connection the client
 * had already lost, so a too-large body surfaced as a transport error instead of a status. It now
 * keeps draining and rejects at the end, so the 413 is readable.
 * @jest-environment node
 */
import { Readable } from 'node:stream';
import { BodyTooLargeError, normalizeBase, readBody, toHeaders } from './request';
import { MAX_BODY_BYTES } from '../shared/constants';
import type { IncomingMessage } from 'node:http';

/** A request whose body arrives as the given chunks. */
function requestWith(chunks: string[]): IncomingMessage {
  const stream = Readable.from(chunks.map((c) => Buffer.from(c)));
  return Object.assign(stream, { headers: {} }) as unknown as IncomingMessage;
}

describe('readBody', () => {
  it('concatenates every chunk into one string', async () => {
    await expect(readBody(requestWith(['{"a":', '1}']))).resolves.toBe('{"a":1}');
  });

  it('resolves empty for a request with no body', async () => {
    await expect(readBody(requestWith([]))).resolves.toBe('');
  });

  it('decodes multi-byte characters split across chunk boundaries', async () => {
    // A UTF-8 character can straddle two chunks; decoding per chunk would produce replacement
    // characters, which is why the buffers are concatenated before being decoded.
    const emoji = Buffer.from('🚀', 'utf8');
    const stream = Readable.from([emoji.subarray(0, 2), emoji.subarray(2)]);
    const req = Object.assign(stream, { headers: {} }) as unknown as IncomingMessage;
    await expect(readBody(req)).resolves.toBe('🚀');
  });

  it('rejects a body over the cap only once it has drained, so the 413 is readable', async () => {
    // The reader used to `destroy()` mid-stream, which closes a keep-alive connection — the caller's
    // 413 then went to a connection the client had already lost. Draining first is what keeps the
    // status readable, so this asserts the *whole* body was consumed before the rejection.
    const half = 'x'.repeat(MAX_BODY_BYTES);
    const delivered: number[] = [];
    const stream = Readable.from(
      (function* chunks() {
        for (const [index, chunk] of [half, half].entries()) {
          delivered.push(index);
          yield Buffer.from(chunk);
        }
      })(),
    );
    const req = Object.assign(stream, { headers: {} }) as unknown as IncomingMessage;

    await expect(readBody(req)).rejects.toThrow(BodyTooLargeError);
    expect(delivered).toEqual([0, 1]);
  });

  it('accepts a body exactly at the cap', async () => {
    const body = 'x'.repeat(MAX_BODY_BYTES);
    await expect(readBody(requestWith([body]))).resolves.toHaveLength(MAX_BODY_BYTES);
  });

  it('rejects when the request stream errors', async () => {
    const stream = new Readable({ read() {} });
    const req = Object.assign(stream, { headers: {} }) as unknown as IncomingMessage;
    const pending = readBody(req);
    stream.emit('error', new Error('socket gone'));
    await expect(pending).rejects.toThrow('socket gone');
  });
});

describe('readBody after a host body parser', () => {
  /** A request whose stream something upstream has already read to the end. */
  async function drained(body: unknown): Promise<IncomingMessage> {
    const stream = Readable.from([Buffer.from('ignored')]);
    for await (const chunk of stream) void chunk;
    return Object.assign(stream, { headers: {}, body }) as unknown as IncomingMessage;
  }

  it('re-serializes a parsed object instead of waiting for an end that already fired', async () => {
    await expect(readBody(await drained({ queue: 'emails' }))).resolves.toBe('{"queue":"emails"}');
  });

  it('passes a raw string or buffer through', async () => {
    await expect(readBody(await drained('{"a":1}'))).resolves.toBe('{"a":1}');
    await expect(readBody(await drained(Buffer.from('{"a":2}')))).resolves.toBe('{"a":2}');
  });

  it('reads nothing left behind as an empty body, which the router answers with a 400', async () => {
    await expect(readBody(await drained(undefined))).resolves.toBe('');
  });

  it('holds a pre-parsed body to the same cap', async () => {
    await expect(readBody(await drained('x'.repeat(MAX_BODY_BYTES + 1)))).rejects.toThrow(
      BodyTooLargeError,
    );
  });
});

describe('normalizeBase', () => {
  it('adds the leading slash and drops a trailing one', () => {
    expect(normalizeBase('portqueue')).toBe('/portqueue');
    expect(normalizeBase('/portqueue/')).toBe('/portqueue');
    expect(normalizeBase('  /admin/queues/  ')).toBe('/admin/queues');
  });

  it('leaves a root mount as a single slash', () => {
    // `/` must not become the empty string: `owns('/')` and the asset paths are built from it.
    expect(normalizeBase('/')).toBe('/');
  });
});

describe('toHeaders', () => {
  it('hands back the request headers as-is', () => {
    const req = {
      headers: { 'x-requested-with': 'portqueue-dashboard' },
    } as unknown as IncomingMessage;
    expect(toHeaders(req)).toEqual({ 'x-requested-with': 'portqueue-dashboard' });
  });
});
