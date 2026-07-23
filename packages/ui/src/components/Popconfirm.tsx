import React from 'react';
import styled, { keyframes } from 'styled-components';
import { Button } from './Button';

export interface PopconfirmProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  onConfirm: () => void;
  onCancel?: () => void;
  okText?: string;
  cancelText?: string;
  okDanger?: boolean;
  children: React.ReactElement;
}

const popIn = keyframes`
  from { opacity: 0; transform: translateY(4px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
`;

const Wrapper = styled.span`
  position: relative;
  display: inline-block;
`;

const Popover = styled.div`
  position: absolute;
  top: 100%;
  left: 0;
  z-index: ${(p) => p.theme.zIndex.modal};
  min-width: 220px;
  max-width: 300px;
  margin-top: 6px;
  padding: ${(p) => p.theme.space(3)} ${(p) => p.theme.space(4)};
  background: ${(p) => p.theme.color.surface};
  color: ${(p) => p.theme.color.text};
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radii.md}px;
  box-shadow: ${(p) => p.theme.shadow.lg};
  animation: ${popIn} ${(p) => p.theme.motion.fast};
`;

const Title = styled.div`
  display: flex;
  align-items: flex-start;
  gap: ${(p) => p.theme.space(2)};
  font-size: 14px;
  font-weight: 600;
  color: ${(p) => p.theme.color.text};
`;

const Description = styled.div`
  margin-top: ${(p) => p.theme.space(1)};
  font-size: 13px;
  line-height: 1.45;
  color: ${(p) => p.theme.color.textMuted};
`;

const Actions = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: ${(p) => p.theme.space(2)};
  margin-top: ${(p) => p.theme.space(3)};
`;

/** Bespoke confirmation popover anchored to its trigger child. */
export const Popconfirm = ({
  title,
  description,
  onConfirm,
  onCancel,
  okText = 'OK',
  cancelText = 'Cancel',
  okDanger = false,
  children,
}: PopconfirmProps): React.ReactElement => {
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

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
    <Wrapper ref={wrapperRef}>
      {trigger}
      {open ? (
        <Popover role="dialog">
          <Title>
            <span aria-hidden>❓</span>
            <span>{title}</span>
          </Title>
          {description != null ? <Description>{description}</Description> : null}
          <Actions>
            <Button variant="text" size="sm" onClick={handleCancel}>
              {cancelText}
            </Button>
            <Button variant={okDanger ? 'danger' : 'primary'} size="sm" onClick={handleConfirm}>
              {okText}
            </Button>
          </Actions>
        </Popover>
      ) : null}
    </Wrapper>
  );
};
