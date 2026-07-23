import type { ReactNode } from 'react';
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
import CodeBlock from '@theme/CodeBlock';
import { PACKAGE_MANAGERS } from '@site/src/constants/drivers';

/**
 * Package-manager install tabs (npm / pnpm / yarn / bun), rendered from the shared
 * PACKAGE_MANAGERS constant so every install snippet stays in sync.
 *
 * Usage in MDX:  <PackageManagerTabs pkg="@portqueue/core pg" />
 */
export default function PackageManagerTabs({ pkg }: { pkg: string }): ReactNode {
  return (
    <Tabs groupId="pm">
      {PACKAGE_MANAGERS.map((pm) => (
        <TabItem key={pm.value} value={pm.value} label={pm.label} default={pm.default}>
          <CodeBlock language="bash">{`${pm.add} ${pkg}`}</CodeBlock>
        </TabItem>
      ))}
    </Tabs>
  );
}
