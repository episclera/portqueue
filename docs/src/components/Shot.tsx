import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import ThemedImage from '@theme/ThemedImage';
import useBaseUrl from '@docusaurus/useBaseUrl';
import { CloseOutlined, ZoomInOutlined } from '@ant-design/icons';

/**
 * A group of dashboard screenshots: a short description, then the shots in a row beneath it.
 *
 * Each `name` is the shared stem of a light/dark pair under `static/img/dashboard/`
 * (`<name>-light.png` and `<name>-dark.png`); `ThemedImage` swaps them with the site theme, so a
 * reader in dark mode never gets a white rectangle burned into the page.
 *
 * The thumbnails are deliberately small — they show what a page looks like, not what it says.
 * Hovering one reveals a zoom affordance, and clicking opens it full-size in a lightbox, so the
 * detail is one click away instead of dominating the page.
 */
export function Shot({
  shots,
  children,
}: {
  shots: { name: string; alt: string }[];
  children: ReactNode;
}): ReactNode {
  const [zoomed, setZoomed] = useState<number | null>(null);

  return (
    <Block>
      <Copy>{children}</Copy>
      <Row>
        {shots.map((shot, i) => (
          <Thumb
            key={shot.name}
            type="button"
            onClick={() => setZoomed(i)}
            aria-label={`Enlarge screenshot: ${shot.alt}`}
          >
            <Picture {...shot} />
            <Overlay aria-hidden="true">
              <ZoomInOutlined />
            </Overlay>
          </Thumb>
        ))}
      </Row>
      {zoomed !== null ? <Lightbox shot={shots[zoomed]} onClose={() => setZoomed(null)} /> : null}
    </Block>
  );
}

/** The themed light/dark pair for one screenshot stem. */
function Picture({ name, alt }: { name: string; alt: string }): ReactNode {
  const light = useBaseUrl(`/img/dashboard/${name}-light.png`);
  const dark = useBaseUrl(`/img/dashboard/${name}-dark.png`);
  return <ThemedImage alt={alt} sources={{ light, dark }} loading="lazy" />;
}

/**
 * The enlarged view: a portal onto `document.body`, so the site's sticky navbar and sidebars can't
 * clip it or stack over it. Escape or a click outside the image closes it, and the page behind
 * stays put while it is open. It only ever mounts after a click, so there is nothing to render
 * server-side.
 */
function Lightbox({
  shot,
  onClose,
}: {
  shot: { name: string; alt: string };
  onClose: () => void;
}): ReactNode {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <Backdrop role="dialog" aria-modal="true" aria-label={shot.alt} onClick={onClose}>
      <CloseButton type="button" onClick={onClose} aria-label="Close">
        <CloseOutlined />
      </CloseButton>
      {/* The image itself isn't a dismiss target — only the space around it. */}
      <Full onClick={(e) => e.stopPropagation()}>
        <Picture {...shot} />
      </Full>
    </Backdrop>,
    document.body,
  );
}

const Block = styled.section`
  margin: 1.5rem 0 2.5rem;
`;

const Copy = styled.div`
  > :first-child {
    margin-top: 0;
  }
`;

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-top: 1.25rem;
`;

const Thumb = styled.button`
  position: relative;
  flex: 1 1 320px;
  max-width: 100%;
  padding: 0;
  border: 1px solid var(--secondary);
  border-radius: 12px;
  overflow: hidden;
  background: var(--surface);
  box-shadow: var(--ifm-global-shadow-lw);
  cursor: zoom-in;
  transition: box-shadow var(--ifm-transition-fast) ease-out;

  img {
    display: block;
    width: 100%;
    height: auto;
  }

  &:hover,
  &:focus-visible {
    box-shadow: var(--ifm-global-shadow-md);
  }

  &:hover > span,
  &:focus-visible > span {
    opacity: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

/** Sits over the thumbnail on hover: a dim wash plus the zoom glyph, so the click is discoverable. */
const Overlay = styled.span`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(27, 31, 29, 0.34);
  color: #fff;
  font-size: 1.75rem;
  opacity: 0;
  transition: opacity var(--ifm-transition-fast) ease-out;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 400;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2.5rem;
  background: rgba(23, 26, 25, 0.82);
  cursor: zoom-out;

  @media (max-width: 996px) {
    padding: 1rem;
  }
`;

const Full = styled.div`
  max-width: min(1400px, 96vw);
  max-height: 92vh;
  overflow: auto;
  border-radius: 12px;
  cursor: default;
  box-shadow: var(--ifm-global-shadow-tl);

  img {
    display: block;
    width: 100%;
    height: auto;
  }
`;

const CloseButton = styled.button`
  position: absolute;
  top: 1rem;
  right: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  font-size: 1rem;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    background: rgba(255, 255, 255, 0.26);
  }
`;
