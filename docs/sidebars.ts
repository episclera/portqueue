import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

/**
 * Sidebar ordered by priority. Split into meaningful sections;
 * never a flat list. Ids map to files under docs/.
 */
const sidebars: SidebarsConfig = {
  docsSidebar: [
    'getting-started',
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
        'guides/events',
        'guides/hooks',
        'troubleshooting',
      ],
    },
    {
      type: 'category',
      label: 'Dashboard & CLI',
      items: ['dashboard', 'cli'],
    },
    'production',
    'scale-horizontally',
    'api-reference',
    {
      type: 'category',
      label: 'More',
      items: ['examples', 'benchmarks', 'contributing', 'testing', 'advanced', 'brandbook', 'team'],
    },
  ],
};

export default sidebars;
