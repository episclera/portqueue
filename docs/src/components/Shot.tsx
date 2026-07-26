import type { ReactNode } from 'react';
import styled from 'styled-components';
import ThemedImage from '@theme/ThemedImage';
import useBaseUrl from '@docusaurus/useBaseUrl';

/**
 * A dashboard page described in prose on the left, with a screenshot of it on the right.
 *
 * The screenshot is deliberately small — it is there to show what the page looks like, not to be
 * read. Anyone who wants the detail runs the dashboard.
 *
 * `name` is the shared stem of a light/dark pair under `static/img/dashboard/`
 * (`<name>-light.png` and `<name>-dark.png`); `ThemedImage` swaps them with the site theme, so a
 * reader in dark mode never gets a white rectangle burned into the page.
 */
export function Shot({
  name,
  alt,
  children,
}: {
  name: string;
  alt: string;
  children: ReactNode;
}): ReactNode {
  const light = useBaseUrl(`/img/dashboard/${name}-light.png`);
  const dark = useBaseUrl(`/img/dashboard/${name}-dark.png`);
  return (
    <Row>
      <Copy>{children}</Copy>
      <Frame>
        <ThemedImage alt={alt} sources={{ light, dark }} loading="lazy" />
      </Frame>
    </Row>
  );
}

const Row = styled.section`
  display: flex;
  align-items: flex-start;
  gap: 1.75rem;
  margin: 2rem 0 2.5rem;

  /* Below the sidebar breakpoint there isn't room for two columns: stack, text first. */
  @media (max-width: 996px) {
    flex-direction: column;
    gap: 1rem;
  }
`;

const Copy = styled.div`
  flex: 1 1 300px;
  min-width: 0;

  /* The heading opens the block, so it shouldn't add its own top gap. */
  > :first-child {
    margin-top: 0;
  }
  > :last-child {
    margin-bottom: 0;
  }
`;

const Frame = styled.div`
  flex: 1 1 380px;
  min-width: 0;
  max-width: 480px;
  border: 1px solid var(--secondary);
  border-radius: 12px;
  overflow: hidden;
  background: var(--surface);
  box-shadow: var(--ifm-global-shadow-lw);

  img {
    display: block;
    width: 100%;
    height: auto;
  }

  @media (max-width: 996px) {
    max-width: 100%;
    align-self: stretch;
  }
`;
