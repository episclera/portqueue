/**
 * Table action controls: icon-only row actions (each with a tooltip, and an optional confirmation
 * popover), and the bulk-actions menu that only appears once rows are selected.
 */
import React from 'react';
import { Button, Dropdown, Flex, Popconfirm, Tooltip } from 'antd';
import { CaretDownIcon } from '../icons';
import { ACTIONS_CONFIG } from '../constants/labels';

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
    <Button
      type="text"
      size="small"
      danger={danger}
      disabled={disabled}
      icon={icon}
      aria-label={label}
      onClick={confirm ? undefined : onClick}
    />
  );

  return (
    <Tooltip title={label} placement="bottom">
      {confirm ? (
        <Popconfirm
          title={confirm.title}
          description={confirm.description}
          okText={label}
          // Not "Cancel" — the confirm button is already labelled with the action, which for the
          // cancel-job row action would leave two identically named buttons in the popover.
          cancelText="Keep"
          okButtonProps={{ danger }}
          onConfirm={onClick}
          disabled={disabled}
        >
          {button}
        </Popconfirm>
      ) : (
        button
      )}
    </Tooltip>
  );
}

/** Row-actions cell — a tight row of icon buttons. */
export function RowActions({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    // Inline, so the cell's own alignment (the column's `align`) decides which edge it sits on.
    <Flex gap={4} align="center" style={{ display: 'inline-flex' }}>
      {children}
    </Flex>
  );
}

export interface BulkItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
}

export interface BulkActionsButtonProps {
  /** Number of selected rows; the button hides itself at 0. */
  count: number;
  items: BulkItem[];
}

/** Bulk-actions trigger: first control on the toolbar row, shown only with a live selection. */
export function BulkActionsButton({
  count,
  items,
}: BulkActionsButtonProps): React.ReactElement | null {
  if (count === 0) return null;
  return (
    <Dropdown
      trigger={['click']}
      menu={{
        items: items.map(({ key, label, icon, danger }) => ({ key, label, icon, danger })),
        onClick: ({ key }) => items.find((item) => item.key === key)?.onClick(),
      }}
    >
      <Button icon={ACTIONS_CONFIG.bulk.icon}>
        {ACTIONS_CONFIG.bulk.label} ({count}) <CaretDownIcon aria-hidden />
      </Button>
    </Dropdown>
  );
}
