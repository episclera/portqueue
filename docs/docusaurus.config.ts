import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// Brand tokens mirrored from `@portqueue/ui` (build_plan/14 — tokens.ts).
// Kept in sync manually here so the docs chrome (Infima) matches the dashboard
// without pulling the AntD/CSS-in-JS package into the static Docusaurus config.
const REPO_URL = 'https://github.com/episclera/portqueue';

const config: Config = {
  title: 'PortQueue',
  tagline: 'The distributed, fault-tolerant job queue that runs on your own database.',
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
        { type: 'docSidebar', sidebarId: 'docsSidebar', position: 'left', label: 'Docs' },
        { to: '/blog', label: 'Blog', position: 'left' },
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
          items: [
            { label: 'Getting Started', to: '/docs/getting-started/installation' },
            { label: 'Job Lifecycle', to: '/docs/guides/consuming-jobs#job-states' },
            { label: 'Workflows', to: '/docs/workflows/what-is-a-workflow' },
            { label: 'Drivers', to: '/docs/drivers/overview' },
            { label: 'Events reference', to: '/docs/events-hooks/events' },
            { label: 'API Reference', to: '/docs/api-reference' },
            { label: 'Dashboard', to: '/docs/dashboard' },
            { label: 'CLI', to: '/docs/cli' },
            { label: 'Production Best Practices', to: '/docs/production' },
            { label: 'Troubleshooting', to: '/docs/troubleshooting' },
          ],
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
            { label: 'License', to: '/docs/introduction#license' },
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
