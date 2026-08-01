/**
 * The basic-auth guard in front of the CLI-served dashboard.
 *
 * The dashboard package ships no auth of its own — that belongs to whatever middleware a host puts in
 * front of the mount — and `portqueue dashboard` is the one case with no host, so this is the only
 * thing between a port on someone's machine and an admin UI that can purge a queue. Worth pinning
 * every branch of.
 */
import { createBasicAuthGuard } from './basic-auth';
import type { IncomingMessage, ServerResponse } from 'node:http';

const USER = 'ops';
const PASS = 'correct horse';

/** A request carrying (or not carrying) an Authorization header. */
function req(header?: string): IncomingMessage {
  return { headers: header ? { authorization: header } : {} } as IncomingMessage;
}

/** A response that records the challenge instead of writing it. */
function res(): ServerResponse & { status: number; headers: Record<string, string>; body: string } {
  const captured = {
    status: 0,
    headers: {} as Record<string, string>,
    body: '',
    writeHead(status: number, headers?: Record<string, string>) {
      captured.status = status;
      Object.assign(captured.headers, headers ?? {});
      return captured;
    },
    end(body?: string) {
      captured.body = body ?? '';
      return captured;
    },
  };
  return captured as unknown as ServerResponse & {
    status: number;
    headers: Record<string, string>;
    body: string;
  };
}

const basic = (user: string, pass: string): string =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

describe('createBasicAuthGuard', () => {
  it('lets the right credentials through without touching the response', () => {
    const guard = createBasicAuthGuard({ username: USER, password: PASS });
    const response = res();
    expect(guard(req(basic(USER, PASS)), response)).toBe(true);
    expect(response.status).toBe(0);
  });

  it('challenges a request with no credentials', () => {
    const guard = createBasicAuthGuard({ username: USER, password: PASS });
    const response = res();
    expect(guard(req(), response)).toBe(false);
    expect(response.status).toBe(401);
    // The challenge is what makes a browser prompt rather than showing a bare error.
    expect(response.headers['www-authenticate']).toContain('Basic realm="PortQueue Dashboard"');
    expect(response.body).toBe('Unauthorized');
  });

  it('refuses a wrong password, a wrong username, and a wrong-length password', () => {
    const guard = createBasicAuthGuard({ username: USER, password: PASS });
    expect(guard(req(basic(USER, 'wrong')), res())).toBe(false);
    expect(guard(req(basic('someone', PASS)), res())).toBe(false);
    // A prefix of the real password must fail: the comparison pads before comparing, then checks the
    // true lengths, so neither the password nor its length leaks through timing.
    expect(guard(req(basic(USER, PASS.slice(0, 4))), res())).toBe(false);
    expect(guard(req(basic(USER, `${PASS} `)), res())).toBe(false);
  });

  it('refuses a malformed Authorization header', () => {
    const guard = createBasicAuthGuard({ username: USER, password: PASS });
    expect(guard(req('Bearer token'), res())).toBe(false);
    expect(guard(req('Basic not-base64!!'), res())).toBe(false);
  });

  it('uses the realm it was given, so a host can name its own prompt', () => {
    const guard = createBasicAuthGuard({ username: USER, password: PASS, realm: 'Ops Console' });
    const response = res();
    guard(req(), response);
    expect(response.headers['www-authenticate']).toContain('realm="Ops Console"');
  });

  it('accepts credentials containing a colon, which only the first one delimits', () => {
    // `user:pa:ss` is a valid password containing a colon; splitting on every colon would reject it.
    const guard = createBasicAuthGuard({ username: USER, password: 'pa:ss' });
    expect(guard(req(basic(USER, 'pa:ss')), res())).toBe(true);
  });
});
