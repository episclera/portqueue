import type { ReactNode } from 'react';
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
import CodeBlock from '@theme/CodeBlock';
import { DRIVERS } from '@site/src/constants/drivers';

/**
 * Driver-selector tabs, rendered from the shared DRIVERS constant so every page
 * that lets the reader pick an engine lists all supported drivers automatically.
 *
 *   <DriverTabs mode="install" />   → `npm install @portqueue/core <peerDep>` per driver
 *   <DriverTabs mode="connect" />   → the minimal connect snippet per driver
 */
export default function DriverTabs({ mode }: { mode: 'install' | 'connect' }): ReactNode {
  return (
    <Tabs groupId="driver">
      {DRIVERS.map((d) => (
        <TabItem key={d.value} value={d.value} label={d.label} default={d.default}>
          {mode === 'install' ? (
            <CodeBlock language="bash">{`npm install @portqueue/core ${d.peerDep}`}</CodeBlock>
          ) : (
            <CodeBlock language="ts">{d.connect}</CodeBlock>
          )}
        </TabItem>
      ))}
    </Tabs>
  );
}
