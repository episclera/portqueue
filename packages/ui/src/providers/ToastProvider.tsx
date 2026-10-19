import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Portal } from '../overlay/Portal';
import { ErrorIcon, InfoIcon, SuccessIcon, WarningIcon } from '../icons';
import styles from './ToastProvider.module.css';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: number;
  kind: ToastKind;
  content: React.ReactNode;
}

export interface ToastApi {
  success: (content: React.ReactNode) => void;
  error: (content: React.ReactNode) => void;
  info: (content: React.ReactNode) => void;
  warning: (content: React.ReactNode) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ICON: Record<ToastKind, React.ComponentType> = {
  success: SuccessIcon,
  error: ErrorIcon,
  info: InfoIcon,
  warning: WarningIcon,
};

/**
 * Lightweight toast host — the replacement for antd's `App` message API.
 * Wrap the app once, then call `useToast()` for `success`/`error`/`info`/`warning`.
 */
export function ToastProvider({
  children,
  duration = 3200,
}: {
  children: React.ReactNode;
  duration?: number;
}): React.ReactElement {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback(
    (kind: ToastKind, content: React.ReactNode) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, kind, content }]);
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), duration);
    },
    [duration],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (c) => push('success', c),
      error: (c) => push('error', c),
      info: (c) => push('info', c),
      warning: (c) => push('warning', c),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Portal>
        <div className={styles.viewport} role="status" aria-live="polite">
          {toasts.map((t) => {
            const KindIcon = ICON[t.kind];
            return (
              <div key={t.id} className={clsx(styles.item, styles[t.kind])}>
                <span className={styles.glyph} aria-hidden>
                  <KindIcon />
                </span>
                <span>{t.content}</span>
              </div>
            );
          })}
        </div>
      </Portal>
    </ToastContext.Provider>
  );
}

/** Access the toast API. Throws if no `ToastProvider` is mounted. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a <ToastProvider>');
  return ctx;
}
