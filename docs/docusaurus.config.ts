import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import sidebars from './sidebars';

// Brand tokens mirrored from `@portqueue/ui` (build_plan/14 — tokens.ts).
// Kept in sync manually here so the docs chrome (Infima) matches the dashboard
// without pulling the AntD/CSS-in-JS package into the static Docusaurus config.
const REPO_URL = 'https://github.com/episclera/portqueue';

// --- Footer "Docs" column, derived from the left sidebar ---------------------------------
// The footer lists one link per top-level section/page of the docs sidebar, so adding a
// page or section to `sidebars.ts` automatically surfaces it in the footer too — a single
// source of truth. Categories link to their first child doc.
type SidebarEntry =
  | string
  | {
      type?: string;
      id?: string;
      label?: string;
      link?: { type?: string; id?: string };
      items?: SidebarEntry[];
    };

// Words to keep fully uppercased when turning a doc id into a label (e.g. 'api-reference').
const LABEL_ACRONYMS = new Set(['api', 'cli', 'ui', 'sql']);

function humanizeDocId(id: string): string {
  const last = id.split('/').pop() ?? id;
  return last
    .split('-')
    .map((w) => (LABEL_ACRONYMS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

// The first linkable doc id under a sidebar entry (recurses into categories).
function firstDocId(entry: SidebarEntry): string | undefined {
  if (typeof entry === 'string') return entry;
  if (entry.type === 'doc' && entry.id) return entry.id;
  if (entry.link?.type === 'doc' && entry.link.id) return entry.link.id;
  for (const child of entry.items ?? []) {
    const found = firstDocId(child);
    if (found) return found;
  }
  return undefined;
}

function footerDocsItems(): Array<{ label: string; to: string }> {
  const top = (sidebars.docsSidebar ?? []) as SidebarEntry[];
  return top.flatMap((entry) => {
    const id = firstDocId(entry);
    if (!id) return [];
    const label =
      typeof entry === 'string' ? humanizeDocId(entry) : (entry.label ?? humanizeDocId(id));
    return [{ label, to: `/docs/${id}` }];
  });
}

const config: Config = {
  title: 'PortQueue',
  tagline:
    'The distributed, fault-tolerant, database-agnostic, performance-focused queue implementation.',
  favicon: 'img/favicon.svg',

  // GitHub Pages deployment (build_plan/15.10). Adjust `url` to the real Pages domain.
  url: 'https://episclera.github.io',
  baseUrl: '/portqueue/',
  organizationName: 'episclera',
  projectName: 'portqueue',
  trailingSlash: false,

  // Do NOT hard-fail on broken links — warn instead (task requirement).
  onBrokenLinks: 'warn',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  // Structured data (JSON-LD) injected into every page's <head> for rich search results:
  // a WebSite entity and the SoftwareApplication entity for the library itself.
  headTags: [
    {
      tagName: 'script',
      attributes: { type: 'application/ld+json' },
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'PortQueue',
        url: 'https://episclera.github.io/portqueue/',
        description:
          'The distributed, fault-tolerant, database-agnostic, performance-focused queue implementation.',
      }),
    },
    {
      tagName: 'script',
      attributes: { type: 'application/ld+json' },
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'PortQueue',
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Node.js',
        description:
          'A broker-less, strictly typed background job queue for Node.js and TypeScript that treats your relational database (Postgres, PGLite, SQLite, Oracle, MySQL) as the single source of truth.',
        url: 'https://episclera.github.io/portqueue/',
        codeRepository: REPO_URL,
        license: 'https://opensource.org/licenses/MIT',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        author: { '@type': 'Organization', name: 'episclera', url: 'https://github.com/episclera' },
      }),
    },
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: `${REPO_URL}/tree/main/docs/`,
        },
        blog: {
          showReadingTime: true,
          blogTitle: 'PortQueue Blog',
          blogDescription: 'News, design notes, and comparisons from the PortQueue team.',
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          editUrl: `${REPO_URL}/tree/main/docs/`,
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/social-card.png',
    // Site-wide meta tags. Per-page `description` (frontmatter) supplies the per-page
    // description; these add the global keyword set and Open Graph type that Docusaurus
    // does not emit on its own (it already handles og/twitter title, description & image).
    metadata: [
      {
        name: 'keywords',
        content:
          'portqueue, job queue, task queue, message queue, background jobs, postgres queue, ' +
          'database queue, node.js job queue, typescript queue, workers, cron jobs, delayed jobs, ' +
          'recurring jobs, workflows, transactional enqueue, bullmq alternative, pg-boss alternative, ' +
          'celery alternative, sqlite, oracle, pglite, mysql',
      },
      { property: 'og:type', content: 'website' },
    ],
    // Follow system preference on first load (build_plan/14.4).
    colorMode: {
      defaultMode: 'light',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'PortQueue',
      logo: {
        alt: 'PortQueue',
        src: 'img/logo.svg',
      },
      items: [
        { type: 'docSidebar', sidebarId: 'docsSidebar', position: 'right', label: 'Docs' },
        { to: '/docs/api-reference', label: 'API Reference', position: 'right' },
        { to: '/blog', label: 'Blog', position: 'right' },
        {
          href: REPO_URL,
          label: 'GitHub',
          position: 'right',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      ],
    },
    footer: {
      // Light-color footer (build_plan/15.3) — styled via custom.css.
      style: 'light',
      links: [
        {
          // All technical/product documentation lives here.
          title: 'Docs',
          // Auto-derived from the left sidebar (see footerDocsItems above): one link per
          // top-level section/page. Add a section to sidebars.ts and it appears here too.
          items: footerDocsItems(),
        },
        {
          // Community & contribution — how to follow along and get involved.
          title: 'Community',
          items: [
            { label: 'Blog', to: '/blog' },
            { label: 'GitHub', href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' },
            { label: 'Contributing', to: '/docs/contributing' },
            {
              label: 'Changelog',
              href: `${REPO_URL}/blob/main/CHANGELOG.md`,
              target: '_blank',
              rel: 'noopener noreferrer',
            },
          ],
        },
        {
          // Who's behind PortQueue and how to represent it.
          title: 'Team & Brand',
          items: [
            { label: 'Team', to: '/docs/team' },
            { label: 'Brandbook', to: '/docs/brandbook' },
            // Homepage anchor: `pathname://` opts out of Docusaurus link processing so its
            // broken-anchor checker doesn't flag it — the checker only indexes Markdown heading
            // anchors, not the `id` on this React page's <Section id="license">. Works at runtime.
            { label: 'License', href: 'pathname:///portqueue/#license' },
          ],
        },
      ],
      copyright: `Free and open source. Commercial use permitted. No license fee, no obligations. (MIT)<br/>Created by <a href="/portqueue/docs/team">Gheorghe Gherciu</a>. © ${new Date().getFullYear()} PortQueue.`,
    },
    prism: {
      theme: prismThemes.oneLight,
      darkTheme: prismThemes.oneDark,
      additionalLanguages: ['bash', 'json', 'sql'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
