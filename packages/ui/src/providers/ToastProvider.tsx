import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import type { DefaultTheme } from 'styled-components';

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

const ICON: Record<ToastKind, string> = {
  success: '✅',
  error: '⛔',
  info: 'ℹ️',
  warning: '⚠️',
};

const slideIn = keyframes`
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
`;

const Viewport = styled.div`
  position: fixed;
  top: ${(p) => p.theme.space(4)};
  left: 50%;
  transform: translateX(-50%);
  z-index: ${(p) => p.theme.zIndex.toast};
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space(2)};
  pointer-events: none;
`;

const ACCENT: Record<ToastKind, (t: DefaultTheme) => string> = {
  success: (t) => t.color.success,
  error: (t) => t.color.danger,
  warning: (t) => t.color.warning,
  info: (t) => t.color.info,
};

const Item = styled.div<{ $kind: ToastKind }>`
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.space(2)};
  min-width: 240px;
  max-width: 440px;
  padding: ${(p) => p.theme.space(2)} ${(p) => p.theme.space(3)};
  border-radius: ${(p) => p.theme.radii.md}px;
  background: ${(p) => p.theme.color.surface};
  color: ${(p) => p.theme.color.text};
  border: 1px solid ${(p) => p.theme.color.border};
  border-left: 3px solid ${(p) => ACCENT[p.$kind](p.theme)};
  box-shadow: ${(p) => p.theme.shadow.lg};
  font-size: 14px;
  animation: ${slideIn} ${(p) => p.theme.motion.base};
`;

/**
 * Lightweight toast host — the styled-components replacement for antd's `App` message API.
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
      <Viewport role="status" aria-live="polite">
        {toasts.map((t) => (
          <Item key={t.id} $kind={t.kind}>
            <span aria-hidden>{ICON[t.kind]}</span>
            <span>{t.content}</span>
          </Item>
        ))}
      </Viewport>
    </ToastContext.Provider>
  );
}

/** Access the toast API. Throws if no `ToastProvider` is mounted. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a <ToastProvider>');
  return ctx;
}
