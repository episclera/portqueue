/** @jest-environment node */
import { rewriteAssetUrls, safeResolve, serializeConfig, serveAsset } from './assets';
import type { DashboardConfigDto } from '../shared/dto';

const config: DashboardConfigDto = { basePath: '/portqueue' };

// In tests the module resolves to src/server/, so no built client bundle is present:
// serveAsset falls back to the inline shell for navigations and 404s for asset paths.
describe('serveAsset (no built client)', () => {
  it('serves the inline shell for a navigation request', async () => {
    const asset = await serveAsset('/', config);
    expect(asset.status).toBe(200);
    expect(asset.contentType).toContain('text/html');
    const html = String(asset.body);
    expect(html).toContain('PortQueue Dashboard');
    expect(html).toContain('/portqueue');
    // Runtime config is injected for the SPA to read on boot.
    expect(html).toContain('window.__PORTQUEUE_DASHBOARD__');
  });

  it('404s for an asset-looking path when no bundle is present', async () => {
    const asset = await serveAsset('/assets/app.js', config);
    expect(asset.status).toBe(404);
  });

  it('sends a CSP whose nonce matches the one on the injected script', async () => {
    const asset = await serveAsset('/', config);
    const csp = asset.headers?.['content-security-policy'] ?? '';
    const fromHeader = /'nonce-([^']+)'/.exec(csp)?.[1];
    const fromScript = /<script nonce="([^"]+)"/.exec(String(asset.body))?.[1];
    expect(fromHeader).toBeTruthy();
    // A mismatch means the browser refuses the config blob and the SPA boots with defaults.
    expect(fromScript).toBe(fromHeader);
  });

  it('issues a fresh nonce per response', async () => {
    const a = await serveAsset('/', config);
    const b = await serveAsset('/', config);
    expect(a.headers?.['content-security-policy']).not.toBe(b.headers?.['content-security-policy']);
  });

  it('never caches HTML, since the injected config rides along with it', async () => {
    const asset = await serveAsset('/', config);
    expect(asset.headers?.['cache-control']).toBe('no-cache');
  });
});

// A developer-supplied basePath is not attacker input, but it reaches an inline <script> verbatim.
describe('serializeConfig', () => {
  it('escapes `<` so a value cannot close the script element', () => {
    const basePath = '</script><script>alert(1)</script>';
    const out = serializeConfig({ basePath });
    expect(out).not.toContain('</script>');
    expect(out).toContain('\\u003c');
    // Still valid JSON: the escapes sit inside the string literal, not around it.
    expect((JSON.parse(out) as DashboardConfigDto).basePath).toBe(basePath);
  });

  it('escapes the line terminators that are legal in JSON but not in JS source', () => {
    const out = serializeConfig({ basePath: 'a\u2028b\u2029c' });
    expect(out).toContain('\\u2028');
    expect(out).toContain('\\u2029');
  });
});

// The guard has to reject more than a leading `../`: a sibling directory whose name merely
// starts with the root's would pass a naive `startsWith` prefix test.
describe('safeResolve', () => {
  const root = '/srv/app/dist/client';

  it('resolves an ordinary asset path inside the root', () => {
    expect(safeResolve(root, '/assets/app.js')).toBe(`${root}/assets/app.js`);
  });

  it('rejects traversal, however it is spelled', () => {
    expect(safeResolve(root, '/../secrets.env')).toBeNull();
    expect(safeResolve(root, '/../../etc/passwd')).toBeNull();
    expect(safeResolve(root, '/assets/../../secrets.env')).toBeNull();
  });

  it('rejects a sibling directory that shares the root as a name prefix', () => {
    expect(safeResolve(root, '/../client-evil/x.js')).toBeNull();
  });

  it('treats an absolute-looking request path as relative to the root', () => {
    // The leading slash is the URL's, not the filesystem's — it must not escape the bundle dir.
    expect(safeResolve(root, '/etc/passwd')).toBe(`${root}/etc/passwd`);
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
