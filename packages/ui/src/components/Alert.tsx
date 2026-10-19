import React from 'react';
import clsx from 'clsx';
import { ErrorIcon, InfoIcon, SuccessIcon, WarningIcon } from '../icons';
import styles from './Alert.module.css';

export type AlertType = 'info' | 'success' | 'warning' | 'error';

export interface AlertProps {
  type?: AlertType;
  className?: string;
  style?: React.CSSProperties;
  title?: React.ReactNode;
  message?: React.ReactNode;
  showIcon?: boolean;
  action?: React.ReactNode;
  children?: React.ReactNode;
}

const ICONS: Record<AlertType, React.ComponentType> = {
  info: InfoIcon,
  success: SuccessIcon,
  warning: WarningIcon,
  error: ErrorIcon,
};

/** Tinted banner keyed by `type`, with an icon, optional title/message and a right-side action. */
export function Alert({
  type = 'info',
  title,
  message,
  showIcon = true,
  action,
  children,
  className,
  style,
}: AlertProps): React.ReactElement {
  const body = children ?? message;
  const TypeIcon = ICONS[type];
  return (
    <div className={clsx(styles.root, styles[type], className)} style={style} role="alert">
      {showIcon ? (
        <span className={styles.icon} aria-hidden>
          <TypeIcon />
        </span>
      ) : null}
      <div className={styles.content}>
        {title !== undefined ? <div className={styles.title}>{title}</div> : null}
        {body !== undefined && body !== null ? <div className={styles.message}>{body}</div> : null}
      </div>
      {action !== undefined ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
