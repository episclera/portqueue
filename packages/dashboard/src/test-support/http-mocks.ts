/** Minimal raw-Node request/response mocks for exercising the server engine + adapters. */
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  ended: boolean;
  headersSent: boolean;
  writeHead(status: number, headers?: Record<string, string>): MockResponse;
  write(): boolean;
  end(body?: unknown): MockResponse;
  on(): MockResponse;
}

export function makeReq(
  init: { method?: string; url?: string; headers?: Record<string, string> } = {},
): IncomingMessage {
  const req = {
    method: init.method ?? 'GET',
    url: init.url ?? '/',
    headers: init.headers ?? {},
    on() {},
    destroy() {},
  };
  return req as unknown as IncomingMessage;
}

export function makeRes(): MockResponse & ServerResponse {
  const res: MockResponse = {
    statusCode: 0,
    headers: {},
    body: undefined,
    ended: false,
    headersSent: false,
    writeHead(status, headers) {
      this.statusCode = status;
      if (headers) Object.assign(this.headers, headers);
      this.headersSent = true;
      return this;
    },
    write() {
      return true;
    },
    end(body) {
      if (body !== undefined) this.body = body;
      this.ended = true;
      return this;
    },
    on() {
      return this;
    },
  };
  return res as unknown as MockResponse & ServerResponse;
}

/** Basic-auth header value for the given credentials. */
export function basicAuth(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}
