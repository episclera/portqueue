/**
 * Serves the built client bundle + index.html (build_plan/12.2/12.4). Reads static assets
 * from the packaged `client-dist` directory; if that directory is absent (e.g. the client
 * hasn't been built yet), serves a minimal inline HTML shell that boots the SPA from a CDN-
 * free fallback so the mount still responds. No dependency beyond Node fs.
 */
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import type { DashboardConfigDto } from '../shared/dto.js';

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

export interface AssetResult {
  status: number;
  body: Buffer | string;
  contentType: string;
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
 * Serve a static asset by relative path (already stripped of basePath). SPA fallback: unknown
 * non-file paths resolve to index.html so client-side routing works. Guards against traversal.
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
    return { status: 200, body: inlineShell(config), contentType: HTML_MIME };
  }

  const clean = normalize(relPath).replace(/^(\.\.[/\\])+/, '');
  const target = join(root, clean === '/' || clean === sep ? 'index.html' : clean);
  if (!target.startsWith(root)) {
    return { status: 403, body: 'Forbidden', contentType: 'text/plain; charset=utf-8' };
  }

  if (await exists(target)) {
    const ext = extname(target).toLowerCase();
    const body = await readFile(target);
    let contentType = MIME[ext] ?? 'application/octet-stream';
    let out: Buffer | string = body;
    if (ext === '.html') {
      out = injectConfig(body.toString('utf8'), config);
      contentType = HTML_MIME;
    }
    return { status: 200, body: out, contentType };
  }

  // SPA fallback: any non-asset path → index.html with injected config.
  if (!extname(clean)) {
    const indexPath = join(root, 'index.html');
    if (await exists(indexPath)) {
      const html = injectConfig((await readFile(indexPath)).toString('utf8'), config);
      return { status: 200, body: html, contentType: HTML_MIME };
    }
  }
  return { status: 404, body: 'Not found', contentType: 'text/plain; charset=utf-8' };
}

/** Inject the runtime config as a global the SPA reads on boot. */
function injectConfig(html: string, config: DashboardConfigDto): string {
  const tag = `<script>window.__PORTQUEUE_DASHBOARD__=${JSON.stringify(config)};</script>`;
  if (html.includes('</head>')) return html.replace('</head>', `${tag}</head>`);
  return `${tag}${html}`;
}

/** A minimal, dependency-free HTML shell used when no built client is packaged. */
function inlineShell(config: DashboardConfigDto): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(config.title)}</title>
<script>window.__PORTQUEUE_DASHBOARD__=${JSON.stringify(config)};</script>
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
<p>Build it with <code>npm run build:client</code> in <code>@portqueue/dashboard</code>, then reload. The JSON API and event stream are already live at <code>${escapeHtml(config.basePath)}/api</code>.</p>
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
