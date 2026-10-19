/**
 * Table action controls: icon-only row actions (with a tooltip that opens below the button so
 * it can't be clipped by the row above), the bulk-actions button that only appears once rows
 * are selected, and the confirmation dialog those bulk actions share.
 */
import React from 'react';
import {
  Button,
  CaretDownIcon,
  Dropdown,
  IconButton,
  Inline,
  Modal,
  Popconfirm,
  Text,
  Tooltip,
  type DropdownItem,
} from '@portqueue/ui';
import { ACTIONS_CONFIG } from '../constants/labels';
import styles from './RowActions.module.css';

export interface RowActionProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Ask for confirmation in a popover before running. */
  confirm?: { title: string; description?: string };
}

export function RowAction({
  icon,
  label,
  onClick,
  disabled = false,
  danger = false,
  confirm,
}: RowActionProps): React.ReactElement {
  const button = (
    <IconButton
      className={styles.actionButton}
      size="sm"
      variant={danger ? 'danger' : 'text'}
      disabled={disabled}
      aria-label={label}
      onClick={confirm ? undefined : onClick}
    >
      <span aria-hidden>{icon}</span>
    </IconButton>
  );

  const trigger = confirm ? (
    <Popconfirm
      title={confirm.title}
      description={confirm.description}
      okText={label}
      // Not "Cancel" — the confirm button is already labelled with the action, which for the
      // cancel-job row action would leave two identically named buttons in the popover.
      cancelText="Keep"
      okDanger={danger}
      onConfirm={onClick}
    >
      {button}
    </Popconfirm>
  ) : (
    button
  );

  return (
    <Tooltip title={label} placement="bottom">
      {trigger}
    </Tooltip>
  );
}

/** Row-actions cell — a tight row of icon buttons. */
export function RowActions({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <Inline gap={1} align="center">
      {children}
    </Inline>
  );
}

export interface BulkActionsButtonProps {
  /** Number of selected rows; the button hides itself at 0. */
  count: number;
  items: DropdownItem[];
}

/** Bulk-actions trigger: first control on the toolbar row, shown only with a live selection. */
export function BulkActionsButton({
  count,
  items,
}: BulkActionsButtonProps): React.ReactElement | null {
  if (count === 0) return null;
  return (
    <Dropdown items={items}>
      <Button size="sm" icon={ACTIONS_CONFIG.bulk.icon}>
        {ACTIONS_CONFIG.bulk.label} ({count}) <CaretDownIcon aria-hidden />
      </Button>
    </Dropdown>
  );
}

export interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: React.ReactNode;
  onConfirm: () => void;
  onClose: () => void;
  okText?: string;
  okDanger?: boolean;
}

/** Confirmation dialog for a bulk action, where a row-level Popconfirm has nothing to anchor to. */
export function ConfirmModal({
  open,
  title,
  description,
  onConfirm,
  onClose,
  okText = 'Confirm',
  okDanger = false,
}: ConfirmModalProps): React.ReactElement {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={okDanger ? 'danger' : 'primary'}
            onClick={() => {
              onClose();
              onConfirm();
            }}
          >
            {okText}
          </Button>
        </>
      }
    >
      <Text>{description}</Text>
    </Modal>
  );
}
