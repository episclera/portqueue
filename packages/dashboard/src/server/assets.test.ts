/** @jest-environment node */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isAssetPath,
  resetBuiltClientCache,
  rewriteAssetUrls,
  safeResolve,
  serializeConfig,
  serveAsset,
} from './assets';
import type { DashboardConfigDto } from '../shared/dto';

const config: DashboardConfigDto = { basePath: '/portqueue', maxBatchIds: 1000 };

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

  it('serves the inline shell for a deep link whose last segment contains a dot', async () => {
    const asset = await serveAsset('/instances/worker.eu-1', config);
    expect(asset.status).toBe(200);
    expect(asset.contentType).toContain('text/html');
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

/**
 * With a bundle present. The module resolves its bundle directory next to itself, so in tests that
 * is `src/server/client`: a throwaway bundle is written there for this block and removed after.
 */
describe('serveAsset (built client)', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), 'client');
  const SHELL =
    '<!doctype html><html><head></head><body><script src="./assets/index-abc.js"></script></body></html>';

  beforeAll(async () => {
    await mkdir(join(root, 'assets'), { recursive: true });
    await writeFile(join(root, 'index.html'), SHELL);
    await writeFile(join(root, 'assets', 'index-abc.js'), 'console.log(1)');
    resetBuiltClientCache();
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    resetBuiltClientCache();
  });

  it.each([
    '/',
    '/index.html',
    '/queues/emails',
    // The case the routing exists for: records named with dots are pages, not files.
    '/queues/emails.v2',
    '/queues/billing.invoice.created',
    '/instances/worker.eu-1',
    '/instances/10.0.3.7',
    '/jobs/job-8f3a1c',
  ])('serves the app shell, with its config, for %s', async (path) => {
    const asset = await serveAsset(path, config);
    expect(asset.status).toBe(200);
    expect(asset.contentType).toContain('text/html');
    const html = String(asset.body);
    expect(html).toContain('window.__PORTQUEUE_DASHBOARD__');
    // Asset URLs are absolute under the mount, so they resolve from any depth of deep link.
    expect(html).toContain('src="/portqueue/assets/index-abc.js"');
  });

  it('serves a file from assets/ with a long-lived cache', async () => {
    const asset = await serveAsset('/assets/index-abc.js', config);
    expect(asset.status).toBe(200);
    expect(asset.contentType).toContain('text/javascript');
    expect(asset.headers?.['cache-control']).toContain('immutable');
  });

  it('404s for a missing file under assets/, rather than handing back the shell', async () => {
    const asset = await serveAsset('/assets/index-missing.js', config);
    expect(asset.status).toBe(404);
  });

  it('refuses to walk out of assets/, even to a file inside the bundle', async () => {
    expect((await serveAsset('/assets/../index.html', config)).status).toBe(403);
    expect((await serveAsset('/assets/../../package.json', config)).status).toBe(403);
  });
});

describe('isAssetPath', () => {
  it('is decided by the folder, never by the extension', () => {
    expect(isAssetPath('/assets/index-abc.js')).toBe(true);
    expect(isAssetPath('/instances/worker.eu-1')).toBe(false);
    expect(isAssetPath('/queues/report.csv')).toBe(false);
    expect(isAssetPath('/assetsx/app.js')).toBe(false);
  });
});

// A developer-supplied basePath is not attacker input, but it reaches an inline <script> verbatim.
describe('serializeConfig', () => {
  it('escapes `<` so a value cannot close the script element', () => {
    const basePath = '</script><script>alert(1)</script>';
    const out = serializeConfig({ ...config, basePath });
    expect(out).not.toContain('</script>');
    expect(out).toContain('\\u003c');
    // Still valid JSON: the escapes sit inside the string literal, not around it.
    expect((JSON.parse(out) as DashboardConfigDto).basePath).toBe(basePath);
  });

  it('escapes the line terminators that are legal in JSON but not in JS source', () => {
    const out = serializeConfig({ ...config, basePath: 'a\u2028b\u2029c' });
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
