import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

/**
 * Sidebar ordered by priority (build_plan/15.6). Split into meaningful sections;
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
      label: 'Events & Hooks',
      items: ['events-hooks/events-vs-hooks', 'events-hooks/events', 'events-hooks/hooks'],
    },
    'scale-horizontally',
    'production',
    'api-reference',
    {
      type: 'category',
      label: 'More',
      items: ['examples', 'contributing', 'testing', 'advanced', 'brandbook', 'team'],
    },
  ],
};

export default sidebars;
