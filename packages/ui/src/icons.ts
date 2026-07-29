/**
 * The icon set for the whole design system — real SVG icons from `@ant-design/icons`, not
 * emoji glyphs. Emoji rendered differently on every platform (and picked up a colour we never
 * chose), so nothing in the UI is an emoji any more.
 *
 * Everything imports its icons **from here**, never from `@ant-design/icons` directly: this
 * file is the allowlist, so a component can't reach for a 900-icon library at random and the
 * bundle only carries what is listed below. Icons inherit `currentColor` and `1em`, so they
 * take the colour and size of the text around them with no per-use styling.
 *
 * The docs site is the one exception — it has no dependency on `@portqueue/ui` and imports the
 * package directly (see `docs/src/pages/index.tsx`).
 */
export {
  // Job / queue actions
  RedoOutlined as RetryIcon,
  StopOutlined as CancelIcon,
  DeleteOutlined as RemoveIcon,
  PauseCircleOutlined as PauseIcon,
  PlayCircleOutlined as ResumeIcon,
  ExportOutlined as OpenIcon,
  PlusOutlined as AddIcon,
  FilterOutlined as FiltersIcon,
  SearchOutlined as SearchIcon,
  ReloadOutlined as RefreshIcon,
  CopyOutlined as CopyIcon,
  SnippetsOutlined as CloneIcon,
  UnorderedListOutlined as BulkIcon,
  // Navigation
  DashboardOutlined as OverviewIcon,
  ClusterOutlined as InstancesIcon,
  ScheduleOutlined as SchedulesIcon,
  ReadOutlined as DocsIcon,
  GithubOutlined as GithubIcon,
  MenuOutlined as MenuIcon,
  // Controls & affordances
  CloseOutlined as CloseIcon,
  CheckOutlined as CheckIcon,
  DownOutlined as CaretDownIcon,
  RightOutlined as CaretRightIcon,
  LoadingOutlined as LoadingIcon,
  MoonOutlined as DarkModeIcon,
  SunOutlined as LightModeIcon,
  InboxOutlined as EmptyIcon,
  // Status & feedback
  InfoCircleFilled as InfoIcon,
  CheckCircleFilled as SuccessIcon,
  WarningFilled as WarningIcon,
  CloseCircleFilled as ErrorIcon,
  QuestionCircleOutlined as ConfirmIcon,
} from '@ant-design/icons';
