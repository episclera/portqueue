/**
 * The dashboard's in-app link: antd's `Typography.Link`, navigating through the router.
 *
 * **Anything that takes the user to another page renders as this — never as a tag, a code chip or
 * a bare `<a>`.** A value styled as a tag reads as a label, so nobody thinks to click it; a link
 * that looks like a link is the only affordance that says "this goes somewhere". `Typography.Link`
 * carries the theme's link colour, hover and focus ring; this component adds the router: a plain
 * click pushes the route, while a modified click (new tab, new window) is left to the browser,
 * which the real `href` makes work.
 */
import React from 'react';
import { useHistory } from 'react-router-dom';
import { Typography } from 'antd';

export interface AppLinkProps {
  /** The in-app route, e.g. `/jobs/abc` — optionally with a `?query`. */
  to: string;
  children: React.ReactNode;
  title?: string;
  'aria-label'?: string;
  style?: React.CSSProperties;
}

export function AppLink({ to, children, ...rest }: AppLinkProps): React.ReactElement {
  const history = useHistory();
  const [pathname = '', search = ''] = to.split('?');
  const href = history.createHref({ pathname, search: search ? `?${search}` : '' });
  return (
    <Typography.Link
      {...rest}
      href={href}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        history.push(to);
      }}
    >
      {children}
    </Typography.Link>
  );
}
