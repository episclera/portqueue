/** @jest-environment node */
import { serveAsset } from './assets';
import type { DashboardConfigDto } from '../shared/dto';

const config: DashboardConfigDto = {
  basePath: '/portqueue',
  title: 'My Dashboard',
  theme: 'system',
  readOnly: false,
};

// In tests the module resolves to src/server/, so no built client bundle is present:
// serveAsset falls back to the inline shell for navigations and 404s for asset paths.
describe('serveAsset (no built client)', () => {
  it('serves the inline shell for a navigation request', async () => {
    const asset = await serveAsset('/', config);
    expect(asset.status).toBe(200);
    expect(asset.contentType).toContain('text/html');
    const html = String(asset.body);
    expect(html).toContain('My Dashboard');
    expect(html).toContain('/portqueue');
    // Runtime config is injected for the SPA to read on boot.
    expect(html).toContain('window.__PORTQUEUE_DASHBOARD__');
  });

  it('404s for an asset-looking path when no bundle is present', async () => {
    const asset = await serveAsset('/assets/app.js', config);
    expect(asset.status).toBe(404);
  });
});
