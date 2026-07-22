import { theme, type ThemeConfig } from 'antd';
import { tokens } from './tokens.js';
import { typography } from './typography.js';

/** AntD dark theme derived from the shared tokens (build_plan/14.4). */
export const darkTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: tokens.color.brandHover,
    colorBgLayout: tokens.color.bgDark,
    colorBgContainer: tokens.color.surfaceDark,
    colorText: tokens.color.textDark,
    borderRadius: tokens.radii.md,
    fontFamily: typography.fontFamily,
    boxShadow: tokens.shadow.lg,
  },
  components: {
    Card: { borderRadiusLG: tokens.radii.lg },
    Button: { borderRadius: tokens.radii.md, controlHeight: 38 },
  },
};
