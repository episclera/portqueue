/** Static config the server injects into the SPA shell. */
export interface DashboardConfigDto {
  basePath: string;
  title: string;
  theme: 'light' | 'dark' | 'system';
  readOnly: boolean;
}
