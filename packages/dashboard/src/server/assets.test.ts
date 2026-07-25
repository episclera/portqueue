/** @jest-environment node */
import { rewriteAssetUrls, serveAsset } from './assets';
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

// The bundle is built with Vite `base: './'`, so index.html points at `./assets/…`. Served from a
// mount, those must become absolute or the browser resolves them outside the mount and 404s.
describe('rewriteAssetUrls', () => {
  const html =
    '<script type="module" crossorigin src="./assets/index-abc.js"></script>' +
    '<link rel="stylesheet" href="./assets/index-abc.css" />';

  it('rewrites relative asset URLs to absolute paths under the mount', () => {
    expect(rewriteAssetUrls(html, '/portqueue')).toBe(
      '<script type="module" crossorigin src="/portqueue/assets/index-abc.js"></script>' +
        '<link rel="stylesheet" href="/portqueue/assets/index-abc.css" />',
    );
  });

  it('honours a custom mount path', () => {
    expect(rewriteAssetUrls(html, '/admin/queues')).toContain(
      'src="/admin/queues/assets/index-abc.js"',
    );
  });

  it('emits root-absolute URLs for a root mount, never protocol-relative ones', () => {
    const out = rewriteAssetUrls(html, '/');
    expect(out).toContain('src="/assets/index-abc.js"');
    expect(out).not.toContain('//assets');
  });

  it('leaves already-absolute and external URLs untouched', () => {
    const untouched =
      '<link href="/portqueue/assets/x.css" /><script src="https://cdn.example.com/x.js"></script>';
    expect(rewriteAssetUrls(untouched, '/portqueue')).toBe(untouched);
  });
});
