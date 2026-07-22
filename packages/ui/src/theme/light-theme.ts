import { theme, type ThemeConfig } from 'antd';
import { tokens } from './tokens.js';
import { typography } from './typography.js';

/** AntD light theme derived from the shared tokens. */
export const lightTheme: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: tokens.color.brand,
    colorBgLayout: tokens.color.bgLight,
    colorBgContainer: tokens.color.surfaceLight,
    colorText: tokens.color.textLight,
    borderRadius: tokens.radii.md,
    fontFamily: typography.fontFamily,
    boxShadow: tokens.shadow.md,
    boxShadowSecondary: tokens.shadow.sm,
  },
  components: {
    Card: { borderRadiusLG: tokens.radii.lg },
    Button: { borderRadius: tokens.radii.md, controlHeight: 38 },
  },
};
