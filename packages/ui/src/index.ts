// Theme & tokens
export { tokens } from './theme/tokens';
export type { StatusColorKey } from './theme/tokens';
export { typography } from './theme/typography';

// Providers
export { ThemeProvider, useTheme } from './providers/ThemeProvider';
export type { ThemeProviderProps } from './providers/ThemeProvider';
export { ToastProvider, useToast } from './providers/ToastProvider';
export type { ToastApi, ToastKind } from './providers/ToastProvider';

// Primitives
export { Button } from './components/Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './components/Button';
export { CopyButton } from './components/CopyButton';
export type { CopyButtonProps } from './components/CopyButton';
export { IconButton } from './components/IconButton';
export { Checkbox } from './components/Checkbox';
export { Card, CardHeader, CardBody, Panel } from './components/Card';
export type { CardProps, CardHeaderProps } from './components/Card';
export { Title, Text, Paragraph, Code, Mono } from './components/Typography';
export type { TextTone } from './components/Typography';
export { Tag } from './components/Tag';
export type { TagProps, TagVariant, TagTone } from './components/Tag';
export { Segmented } from './components/Segmented';
export type { SegmentedProps, SegmentedOption } from './components/Segmented';
export { Switch } from './components/Switch';
export type { SwitchProps } from './components/Switch';

// Form & inputs
export { Input } from './components/Input';
export type { InputProps, InputSize } from './components/Input';
export { Textarea } from './components/Textarea';
export type { TextareaProps } from './components/Textarea';
export { InputNumber } from './components/InputNumber';
export type { InputNumberProps } from './components/InputNumber';
export { Select } from './components/Select';
export type { SelectProps, SelectOption, SelectSize } from './components/Select';
export { Form, Field } from './components/Form';
export type { FieldProps } from './components/Form';

// Overlays
export { Modal } from './components/Modal';
export type { ModalProps } from './components/Modal';
export { Tooltip } from './components/Tooltip';
export type { TooltipProps, TooltipPlacement } from './components/Tooltip';
export { Popconfirm } from './components/Popconfirm';
export type { PopconfirmProps } from './components/Popconfirm';
export { Dropdown } from './components/Dropdown';
export type { DropdownProps, DropdownItem } from './components/Dropdown';

// Data display
export { Table } from './components/Table';
export type {
  TableProps,
  TableColumn,
  TableAlign,
  TableSize,
  TableRowSelection,
} from './components/Table';
export { Pagination } from './components/Pagination';
export type { PaginationProps } from './components/Pagination';
export { Timeline } from './components/Timeline';
export type { TimelineProps, TimelineItem } from './components/Timeline';
export { Collapse } from './components/Collapse';
export type { CollapseProps, CollapseItem } from './components/Collapse';
export { Statistic } from './components/Statistic';
export type { StatisticProps, StatisticTone } from './components/Statistic';
export { Skeleton, SkeletonText } from './components/Skeleton';
export type { SkeletonProps, SkeletonTextProps } from './components/Skeleton';
export { ScrollShadow } from './components/ScrollShadow';
export type { ScrollShadowProps } from './components/ScrollShadow';
export { Alert } from './components/Alert';
export type { AlertProps, AlertType } from './components/Alert';

// Layout & misc
export { Stack, Inline } from './components/Stack';
export type { StackProps, InlineProps } from './components/Stack';
export { Row, Col } from './components/Grid';
export type { RowProps, ColProps } from './components/Grid';
export { Divider } from './components/Divider';
export type { DividerProps } from './components/Divider';
export { Spinner } from './components/Spinner';
export type { SpinnerProps } from './components/Spinner';
export { AppShell, Header, Content, Footer, PageHeader } from './layout/AppLayout';
export type { HeaderProps, PageHeaderProps } from './layout/AppLayout';

// Brand & domain
export { Logo, type LogoProps } from './components/Logo';
export { StatusTag, type StatusTagProps } from './components/StatusTag';
export { ThemeSwitcher, useThemeMode, type ThemeMode } from './components/ThemeSwitcher';

// Icons — the allowlisted `@ant-design/icons` set every surface draws from.
export * from './icons';
