import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

/**
 * Sidebar ordered by priority (build_plan/15.6). Split into meaningful sections;
 * never a flat list. Ids map to files under docs/.
 */
const sidebars: SidebarsConfig = {
  docsSidebar: [
    'introduction',
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        'getting-started/installation',
        'getting-started/first-queue',
        'getting-started/first-worker',
      ],
    },
    {
      type: 'category',
      label: 'Core Concepts',
      items: ['core-concepts/model', 'core-concepts/job-lifecycle', 'core-concepts/at-least-once'],
    },
    'guides/producing-jobs',
    'guides/consuming-jobs',
    'guides/scheduling',
    'guides/transactions',
    'guides/rate-limiting',
    'guides/retention',
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
    {
      type: 'category',
      label: 'Drivers',
      items: [
        'drivers/overview',
        'drivers/postgres',
        'drivers/pglite',
        'drivers/sqlite',
        'drivers/oracle',
        'drivers/custom',
      ],
    },
    'scalability',
    'production',
    'dashboard',
    'cli',
    'api-reference',
    'troubleshooting',
    'contributing',
    'team',
  ],
};

export default sidebars;
