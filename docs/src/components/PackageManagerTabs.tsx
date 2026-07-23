import type { ReactNode } from 'react';
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
import CodeBlock from '@theme/CodeBlock';
import { DRIVERS, PACKAGE_MANAGERS } from '@site/src/constants/drivers';

/**
 * Package-manager install tabs (npm / pnpm / yarn / bun), rendered from the shared
 * PACKAGE_MANAGERS constant so every install snippet stays in sync.
 *
 * Two modes:
 *   <PackageManagerTabs pkg="@portqueue/core" />   → a fixed package string
 *   <PackageManagerTabs />                          → driver-aware: the DB client
 *     tracks the driver chosen in <DriverTabs mode="install" /> on the same page,
 *     because the nested driver tabs share `groupId="driver"`. The redundant inner
 *     driver tab-strip is hidden via CSS (`.pm-driver-sync`), so only the package
 *     manager is pickable here while the command still follows the selected engine.
 */
export default function PackageManagerTabs({ pkg }: { pkg?: string }): ReactNode {
  return (
    <Tabs groupId="pm">
      {PACKAGE_MANAGERS.map((pm) => (
        <TabItem key={pm.value} value={pm.value} label={pm.label} default={pm.default}>
          {pkg ? (
            <CodeBlock language="bash">{`${pm.add} ${pkg}`}</CodeBlock>
          ) : (
            <Tabs groupId="driver" className="pm-driver-sync">
              {DRIVERS.map((d) => (
                <TabItem key={d.value} value={d.value} label={d.label} default={d.default}>
                  <CodeBlock language="bash">{`${pm.add} @portqueue/core ${d.peerDep}`}</CodeBlock>
                </TabItem>
              ))}
            </Tabs>
          )}
        </TabItem>
      ))}
    </Tabs>
  );
}
