/** Static config the server injects into the SPA shell. */
export interface DashboardConfigDto {
  basePath: string;
  title: string;
  /**
   * The theme the dashboard opens with when the visitor has no stored preference of their own.
   * An explicit choice (the header switcher, persisted in `localStorage`) always wins over this.
   */
  theme: 'light' | 'dark' | 'system';
}
