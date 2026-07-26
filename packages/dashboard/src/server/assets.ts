/**
 * Serves the built client bundle + index.html from the packaged `dist/client` directory. If that
 * directory is absent (the client hasn't been built), serves a minimal inline HTML shell so the
 * mount still responds and says why. No dependency beyond Node fs.
 */
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import type { DashboardConfigDto } from '../shared/dto';

const HTML_MIME = 'text/html; charset=utf-8';

const MIME: Record<string, string> = {
  '.html': HTML_MIME,
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Vite emits content-hashed asset filenames, so a given URL's bytes never change — those can be
 * cached indefinitely. HTML carries the injected runtime config and must always be revalidated.
 */
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
const NO_CACHE = 'no-cache';

export interface AssetResult {
  status: number;
  body: Buffer | string;
  contentType: string;
  /** Extra response headers — caching and, for HTML, the CSP naming the inline script's nonce. */
  headers?: Record<string, string>;
}

/** Resolve the packaged client bundle directory relative to this module. */
function clientDistDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // At runtime the server lives at dist/index.{mjs,cjs}; the client bundle sits in dist/client.
  return resolve(here, 'client');
}

async function exists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

/** True when a built client bundle is present in the package. */
export async function hasBuiltClient(): Promise<boolean> {
  return exists(join(clientDistDir(), 'index.html'));
}

/**
 * Resolve a request path inside the bundle directory, or null if it escapes.
 *
 * `resolve` + `relative`, not a string prefix test: a prefix check accepts a sibling directory
 * whose name merely starts with the root's (`…/client-evil` passes `startsWith('…/client')`), and
 * it mishandles an absolute request path. Here anything resolving outside the root — a `..`
 * segment, an absolute path — comes back as a relative path that starts with `..` or is itself
 * absolute, and is rejected.
 */
export function safeResolve(root: string, relPath: string): string | null {
  const target = resolve(root, `.${relPath.startsWith('/') ? relPath : `/${relPath}`}`);
  const rel = relative(root, target);
  if (rel === '') return target; // the root itself
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return target;
}

/**
 * Serve a static asset by relative path (already stripped of basePath). SPA fallback: unknown
 * non-file paths resolve to index.html so client-side routing works.
 */
export async function serveAsset(
  relPath: string,
  config: DashboardConfigDto,
): Promise<AssetResult> {
  const root = clientDistDir();
  const built = await hasBuiltClient();

  if (!built) {
    // No bundle: serve the inline shell for any navigation, 404 for asset-looking requests.
    if (extname(relPath) && relPath !== '/index.html') {
      return { status: 404, body: 'Not found', contentType: 'text/plain; charset=utf-8' };
    }
    return htmlResult(inlineShell(config), config);
  }

  const requested = relPath === '/' ? '/index.html' : relPath;
  const target = safeResolve(root, requested);
  if (target === null) {
    return { status: 403, body: 'Forbidden', contentType: 'text/plain; charset=utf-8' };
  }

  if (await exists(target)) {
    const ext = extname(target).toLowerCase();
    const body = await readFile(target);
    if (ext === '.html') {
      return htmlResult(rewriteAssetUrls(body.toString('utf8'), config.basePath), config);
    }
    return {
      status: 200,
      body,
      contentType: MIME[ext] ?? 'application/octet-stream',
      // Content-hashed filenames make this safe: the browser never re-requests a cached bundle.
      headers: { 'cache-control': IMMUTABLE_CACHE },
    };
  }

  // SPA fallback: any non-asset path → index.html with injected config.
  if (!extname(requested)) {
    const indexPath = join(root, 'index.html');
    if (await exists(indexPath)) {
      const raw = (await readFile(indexPath)).toString('utf8');
      return htmlResult(rewriteAssetUrls(raw, config.basePath), config);
    }
  }
  return { status: 404, body: 'Not found', contentType: 'text/plain; charset=utf-8' };
}

/**
 * Finish an HTML response: inject the runtime config under a fresh nonce, and emit the CSP that
 * authorizes exactly that one inline script. The nonce is per-response, so an injected `<script>`
 * without it is refused by the browser even if it does reach the page.
 */
function htmlResult(html: string, config: DashboardConfigDto): AssetResult {
  const nonce = randomBytes(16).toString('base64');
  return {
    status: 200,
    body: injectConfig(html, config, nonce),
    contentType: HTML_MIME,
    headers: {
      'cache-control': NO_CACHE,
      'content-security-policy': contentSecurityPolicy(nonce),
    },
  };
}

/**
 * The dashboard's CSP. The SPA has exactly one inline script (the config blob), so it carries a
 * nonce and every other inline script is refused. `style-src` must allow `unsafe-inline`:
 * styled-components injects its rules at runtime into a `<style>` element.
 */
function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

/**
 * The client is built with Vite `base: './'`, so `index.html` references its bundle relatively
 * (`./assets/app.js`). The browser would resolve that against the *current* URL, which breaks
 * for every mount-relative navigation: `/portqueue` → `/assets/app.js` (outside the mount) and
 * `/portqueue/jobs/1` → `/portqueue/jobs/assets/app.js`. Rewriting the references to absolute
 * paths under the mount makes them resolve identically from any URL, with or without a trailing
 * slash. A root mount (`/`) needs no prefix — `//assets/...` would read as protocol-relative.
 */
export function rewriteAssetUrls(html: string, basePath: string): string {
  const prefix = basePath === '/' ? '' : basePath;
  return html.replace(
    /(\b(?:src|href)=")\.\/([^"]*)"/g,
    (_match, attr: string, path: string) => `${attr}${prefix}/${path}"`,
  );
}

/** Inject the runtime config as a global the SPA reads on boot. */
function injectConfig(html: string, config: DashboardConfigDto, nonce: string): string {
  const tag = `<script nonce="${nonce}">window.__PORTQUEUE_DASHBOARD__=${serializeConfig(config)};</script>`;
  if (html.includes('</head>')) return html.replace('</head>', `${tag}</head>`);
  return `${tag}${html}`;
}

/**
 * JSON for embedding inside a `<script>` element. `JSON.stringify` does not escape `<`, so a
 * developer-supplied title of `</script>…` would otherwise close the element early and let what
 * follows be parsed as markup. Escaping `<` and `>` — plus U+2028/U+2029, which are legal inside
 * a JSON string but count as line terminators to a JS parser — makes the value inert while
 * keeping it valid JSON.
 */
export function serializeConfig(config: DashboardConfigDto): string {
  return JSON.stringify(config)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** A minimal, dependency-free HTML shell used when no built client is packaged. */
function inlineShell(config: DashboardConfigDto): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(config.title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background:#f7f8fa; color:#1a1d23; }
  @media (prefers-color-scheme: dark){ body{ background:#0b0e14; color:#e6e8ec; } .card{ background:#131722 !important; } }
  .wrap{ max-width:720px; margin:12vh auto; padding:24px; }
  .card{ background:#fff; border-radius:16px; padding:32px; box-shadow:0 12px 32px rgba(16,24,40,0.12),0 6px 16px rgba(16,24,40,0.08); }
  code{ font-family: ui-monospace, "SF Mono", Menlo, monospace; background:rgba(127,127,127,0.15); padding:2px 6px; border-radius:6px; }
  h1{ font-size:22px; margin:0 0 8px; }
</style>
</head>
<body>
<div class="wrap"><div class="card">
<h1>${escapeHtml(config.title)}</h1>
<p>The PortQueue dashboard server is mounted at <code>${escapeHtml(config.basePath)}</code>, but the client bundle has not been built into this package yet.</p>
<p>Build it with <code>npm run build:client</code> in <code>@portqueue/dashboard</code>, then reload. The JSON API is already live at <code>${escapeHtml(config.basePath)}/api</code>.</p>
</div></div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
