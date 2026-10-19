import React from 'react';
import clsx from 'clsx';
import { Button } from './Button';
import { Portal } from '../overlay/Portal';
import { useAnchoredLayer } from '../overlay/useAnchoredLayer';
import { useDismiss } from '../overlay/useDismiss';
import { ConfirmIcon } from '../icons';
import styles from './Popconfirm.module.css';

export interface PopconfirmProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  onConfirm: () => void;
  onCancel?: () => void;
  okText?: string;
  cancelText?: string;
  okDanger?: boolean;
  className?: string;
  children: React.ReactElement;
}

/** Kept in step with `.popover`'s `min-width` in the module. */
const MIN_WIDTH = 220;

/** Bespoke confirmation popover, portalled to the body and anchored to its trigger child. */
export const Popconfirm = ({
  title,
  description,
  onConfirm,
  onCancel,
  okText = 'OK',
  cancelText = 'Cancel',
  okDanger = false,
  className,
  children,
}: PopconfirmProps): React.ReactElement => {
  const [open, setOpen] = React.useState(false);
  const { triggerRef, layerRef, position } = useAnchoredLayer<HTMLSpanElement, HTMLDivElement>({
    open,
    minWidth: MIN_WIDTH,
  });

  useDismiss({ open, onDismiss: () => setOpen(false), refs: [triggerRef, layerRef] });

  const handleCancel = (): void => {
    setOpen(false);
    onCancel?.();
  };

  const handleConfirm = (): void => {
    setOpen(false);
    onConfirm();
  };

  const trigger = React.cloneElement(children, {
    onClick: (e: React.MouseEvent) => {
      children.props.onClick?.(e);
      setOpen((prev) => !prev);
    },
  });

  return (
    <>
      <span ref={triggerRef} className={clsx(styles.wrapper, className)}>
        {trigger}
      </span>
      {open && position ? (
        <Portal>
          <div
            ref={layerRef}
            className={styles.popover}
            role="dialog"
            style={{ top: position.top, left: position.left }}
          >
            <div className={styles.title}>
              <ConfirmIcon className={styles.titleIcon} aria-hidden />
              <span>{title}</span>
            </div>
            {description != null ? <div className={styles.description}>{description}</div> : null}
            <div className={styles.actions}>
              <Button variant="text" size="sm" onClick={handleCancel}>
                {cancelText}
              </Button>
              <Button variant={okDanger ? 'danger' : 'primary'} size="sm" onClick={handleConfirm}>
                {okText}
              </Button>
            </div>
          </div>
        </Portal>
      ) : null}
    </>
  );
};
