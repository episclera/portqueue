/** @jest-environment node */
import { authorize, type DashboardAuth } from './auth';
import { basicAuth } from '../../test-support/http-mocks';

const req = (headers: Record<string, string> = {}) => ({ method: 'GET', url: '/portqueue', headers });

describe('authorize', () => {
  it('allows everything when no auth is configured', async () => {
    expect(await authorize(undefined, req())).toEqual({ authorized: true, readOnly: false });
    const none: DashboardAuth = { mode: 'none' };
    expect((await authorize(none, req())).authorized).toBe(true);
  });

  describe('basic', () => {
    const auth: DashboardAuth = { mode: 'basic', username: 'admin', password: 's3cret' };

    it('authorizes correct credentials', async () => {
      const decision = await authorize(auth, req({ authorization: basicAuth('admin', 's3cret') }));
      expect(decision.authorized).toBe(true);
    });

    it('rejects a wrong password and returns a Basic challenge', async () => {
      const decision = await authorize(auth, req({ authorization: basicAuth('admin', 'nope') }));
      expect(decision.authorized).toBe(false);
      expect(decision.challenge).toMatch(/^Basic realm=/);
    });

    it('rejects a missing header', async () => {
      expect((await authorize(auth, req())).authorized).toBe(false);
    });
  });

  describe('custom', () => {
    it('accepts a boolean guard result', async () => {
      const auth: DashboardAuth = { mode: 'custom', guard: () => true };
      expect((await authorize(auth, req())).authorized).toBe(true);
    });

    it('accepts a rich guard result with readOnly', async () => {
      const auth: DashboardAuth = { mode: 'custom', guard: async () => ({ authorized: true, readOnly: true }) };
      expect(await authorize(auth, req())).toEqual({ authorized: true, readOnly: true });
    });

    it('denies when custom mode has no guard', async () => {
      expect((await authorize({ mode: 'custom' }, req())).authorized).toBe(false);
    });
  });
});
