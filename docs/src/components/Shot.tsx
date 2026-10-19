import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import ThemedImage from '@theme/ThemedImage';
import useBaseUrl from '@docusaurus/useBaseUrl';
import { CloseOutlined, ZoomInOutlined } from '@ant-design/icons';
import styles from './Shot.module.css';

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
    <section className={styles.block}>
      <div className={styles.copy}>{children}</div>
      <div className={styles.row}>
        {shots.map((shot, i) => (
          <button
            className={styles.thumb}
            key={shot.name}
            type="button"
            onClick={() => setZoomed(i)}
            aria-label={`Enlarge screenshot: ${shot.alt}`}
          >
            <Picture {...shot} />
            <span className={styles.overlay} aria-hidden="true">
              <ZoomInOutlined />
            </span>
          </button>
        ))}
      </div>
      {zoomed !== null ? <Lightbox shot={shots[zoomed]} onClose={() => setZoomed(null)} /> : null}
    </section>
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
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={shot.alt}
      onClick={onClose}
    >
      <button className={styles.closeButton} type="button" onClick={onClose} aria-label="Close">
        <CloseOutlined />
      </button>
      {/* The image itself isn't a dismiss target — only the space around it. */}
      <div className={styles.full} onClick={(e) => e.stopPropagation()}>
        <Picture {...shot} />
      </div>
    </div>,
    document.body,
  );
}
