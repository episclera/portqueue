import React from 'react';
import clsx from 'clsx';
import { Portal } from '../overlay/Portal';
import { CloseIcon } from '../icons';
import styles from './Modal.module.css';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  footer?: React.ReactNode;
  /** Dialog width in px. Defaults to 520. */
  width?: number;
  /** Applied to the dialog box (not the backdrop). */
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

/** Bespoke modal dialog rendered via a portal, with backdrop + Escape close. */
export const Modal = ({
  open,
  onClose,
  title,
  footer,
  width = 520,
  className,
  style,
  children,
}: ModalProps): React.ReactElement | null => {
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (typeof document === 'undefined') return null;
  if (!open) return null;

  return (
    <Portal>
      <div className={styles.backdrop} onClick={onClose} role="presentation">
        <div
          className={clsx(styles.dialog, className)}
          style={{ maxWidth: width, ...style }}
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.header}>
            {title != null ? <h2 className={styles.title}>{title}</h2> : <span />}
            <button
              className={styles.closeButton}
              type="button"
              onClick={onClose}
              aria-label="Close"
            >
              <CloseIcon aria-hidden />
            </button>
          </div>
          <div className={styles.body}>{children}</div>
          {footer != null ? <div className={styles.footer}>{footer}</div> : null}
        </div>
      </div>
    </Portal>
  );
};
