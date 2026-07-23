import type { ReactNode } from 'react';
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
import CodeBlock from '@theme/CodeBlock';
import { TX_ADAPTERS } from '@site/src/constants/tx-adapters';

/**
 * Transaction-adapter tabs, rendered from the shared TX_ADAPTERS constant so
 * every page that shows a transactional-enqueue example lists all supported
 * adapters automatically.
 *
 *   <TxTabs />   → the minimal transactional-enqueue snippet per adapter
 */
export default function TxTabs(): ReactNode {
  return (
    <Tabs groupId="tx">
      {TX_ADAPTERS.map((a) => (
        <TabItem key={a.value} value={a.value} label={a.label} default={a.default}>
          <CodeBlock language="ts">{a.snippet}</CodeBlock>
        </TabItem>
      ))}
    </Tabs>
  );
}
