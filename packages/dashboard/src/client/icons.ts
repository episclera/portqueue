/**
 * The dashboard's icon set — real SVG icons from `@ant-design/icons`, never emoji, under names
 * that say what they *mean* here (`RetryIcon`, not `RedoOutlined`), so every page spells one
 * action with one glyph.
 *
 * Dashboard code imports its icons from this file, never from `@ant-design/icons` directly (lint
 * enforces it): the list is the allowlist, so the bundle carries only what is named below. Icons
 * inherit `currentColor` and `1em`, so they take the colour and size of the text around them.
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
  DownOutlined as CaretDownIcon,
  MoonOutlined as DarkModeIcon,
  SunOutlined as LightModeIcon,
} from '@ant-design/icons';
