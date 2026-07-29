import React from 'react';
import styled, { keyframes } from 'styled-components';
import { Button } from './Button';
import { Portal } from '../overlay/Portal';
import { useAnchoredLayer } from '../overlay/useAnchoredLayer';
import { useDismiss } from '../overlay/useDismiss';
import { ConfirmIcon } from '../icons';

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
  display: inline-block;
`;

const MIN_WIDTH = 220;

/**
 * Rendered in a body portal at fixed viewport coordinates: a row-action popover has to escape
 * the table cell that would otherwise clip it, and outrank the dialog it may be opened inside.
 */
const Popover = styled.div<{ $top: number; $left: number }>`
  position: fixed;
  top: ${(p) => p.$top}px;
  left: ${(p) => p.$left}px;
  z-index: ${(p) => p.theme.zIndex.popover};
  min-width: ${MIN_WIDTH}px;
  max-width: 300px;
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

/** The question mark leads the prompt in the caution colour, since every use is a confirm. */
const TitleIcon = styled(ConfirmIcon)`
  flex: none;
  margin-top: 2px;
  color: ${(p) => p.theme.color.warning};
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

/** Bespoke confirmation popover, portalled to the body and anchored to its trigger child. */
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
      <Wrapper ref={triggerRef}>{trigger}</Wrapper>
      {open && position ? (
        <Portal>
          <Popover ref={layerRef} role="dialog" $top={position.top} $left={position.left}>
            <Title>
              <TitleIcon aria-hidden />
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
        </Portal>
      ) : null}
    </>
  );
};
