import React from 'react';
import styled, { keyframes } from 'styled-components';
import { Portal } from '../overlay/Portal';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  footer?: React.ReactNode;
  /** Dialog width in px. Defaults to 520. */
  width?: number;
  children: React.ReactNode;
}

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const popIn = keyframes`
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
`;

/**
 * Full-viewport backdrop, portalled to the body. Stacks above all page chrome; the transient
 * layers a dialog can contain (selects, popovers, tooltips) deliberately stack above it.
 */
const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: ${(p) => p.theme.space(12)} ${(p) => p.theme.space(4)};
  background: rgba(9, 12, 18, 0.55);
  z-index: ${(p) => p.theme.zIndex.modal};
  overflow-y: auto;
  animation: ${fadeIn} ${(p) => p.theme.motion.fast};
`;

const Dialog = styled.div<{ $width: number }>`
  width: 100%;
  max-width: ${(p) => p.$width}px;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - ${(p) => p.theme.space(24)});
  background: ${(p) => p.theme.color.surface};
  color: ${(p) => p.theme.color.text};
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radii.lg}px;
  box-shadow: ${(p) => p.theme.shadow.lg};
  animation: ${popIn} ${(p) => p.theme.motion.base};
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${(p) => p.theme.space(3)};
  padding: ${(p) => p.theme.space(4)} ${(p) => p.theme.space(5)};
  border-bottom: 1px solid ${(p) => p.theme.color.border};
`;

const Title = styled.h2`
  margin: 0;
  font-family: ${(p) => p.theme.font.display};
  font-size: 17px;
  font-weight: 600;
  color: ${(p) => p.theme.color.text};
`;

const CloseButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  font-size: 15px;
  line-height: 1;
  color: ${(p) => p.theme.color.textMuted};
  background: transparent;
  border: 1px solid transparent;
  border-radius: ${(p) => p.theme.radii.md}px;
  cursor: pointer;
  transition: background ${(p) => p.theme.motion.fast}, color ${(p) => p.theme.motion.fast};
  &:hover {
    background: ${(p) => p.theme.color.surfaceAlt};
    color: ${(p) => p.theme.color.text};
  }
  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.color.brand};
    outline-offset: 2px;
  }
`;

const Body = styled.div`
  padding: ${(p) => p.theme.space(5)};
  overflow-y: auto;
  font-size: 14px;
  line-height: 1.55;
`;

const Footer = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: ${(p) => p.theme.space(2)};
  padding: ${(p) => p.theme.space(4)} ${(p) => p.theme.space(5)};
  border-top: 1px solid ${(p) => p.theme.color.border};
`;

/** Bespoke modal dialog rendered via a portal, with backdrop + Escape close. */
export const Modal = ({
  open,
  onClose,
  title,
  footer,
  width = 520,
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
      <Backdrop onClick={onClose} role="presentation">
        <Dialog $width={width} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
          <Header>
            {title != null ? <Title>{title}</Title> : <span />}
            <CloseButton type="button" onClick={onClose} aria-label="Close">
              ✕
            </CloseButton>
          </Header>
          <Body>{children}</Body>
          {footer != null ? <Footer>{footer}</Footer> : null}
        </Dialog>
      </Backdrop>
    </Portal>
  );
};
