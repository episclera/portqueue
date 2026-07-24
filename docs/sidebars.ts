import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

/**
 * Sidebar ordered by priority (build_plan/15.6). Split into meaningful sections;
 * never a flat list. Ids map to files under docs/.
 */
const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: ['getting-started/installation', 'getting-started/first-queue'],
    },
    {
      type: 'category',
      label: 'Core Guides',
      items: [
        'guides/producing-jobs',
        'guides/consuming-jobs',
        'guides/scheduling',
        'guides/retention',
        'guides/transactions',
        'guides/canceling-jobs',
        'guides/rate-limiting',
        'troubleshooting',
      ],
    },
    {
      type: 'category',
      label: 'Dashboard & CLI',
      items: ['dashboard', 'cli'],
    },
    {
      type: 'category',
      label: 'Workflows',
      items: [
        'workflows/what-is-a-workflow',
        'workflows/designing',
        'workflows/step-controller',
        'workflows/resumability',
      ],
    },
    {
      type: 'category',
      label: 'Events & Hooks',
      items: ['events-hooks/events-vs-hooks', 'events-hooks/events', 'events-hooks/hooks'],
    },
    'scale-horizontally',
    'production',
    'api-reference',
    {
      type: 'category',
      label: 'More',
      items: ['advanced', 'examples', 'contributing', 'brandbook', 'team'],
    },
  ],
};

export default sidebars;
