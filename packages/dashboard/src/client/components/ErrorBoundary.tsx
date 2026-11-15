/**
 * The app's error boundary. Without one, a render throw anywhere blanks the SPA to a white page
 * whose only trace is in the console — the user sees nothing and has nothing to act on.
 *
 * This has to be a class: `componentDidCatch`/`getDerivedStateFromError` have no hook equivalent.
 */
import React from 'react';
import { Alert, Button, Card, Flex, Typography } from 'antd';
import { PageBody } from './layout';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /**
   * Remounting the subtree resets the boundary. The router passes the current path, so navigating
   * away from a page that threw recovers on its own instead of stranding the user on the notice.
   */
  resetKey?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

const Details = ({ error }: { error: Error }): React.ReactElement => (
  <Card>
    <Flex vertical gap="middle" align="flex-start">
      <Alert
        type="error"
        showIcon
        title="Something went wrong rendering this page"
        description={error.message || 'An unexpected error occurred.'}
        style={{ alignSelf: 'stretch' }}
      />
      <Typography.Text type="secondary">
        The dashboard itself failed here — your queues and jobs are unaffected. Reloading usually
        clears it; if it happens consistently, the browser console has the full stack trace.
      </Typography.Text>
      <Button type="primary" onClick={() => window.location.reload()}>
        Reload the dashboard
      </Button>
    </Flex>
  </Card>
);

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidUpdate(prev: ErrorBoundaryProps): void {
    // A new resetKey means the user navigated; drop the error so the next page gets a clean try.
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // The boundary swallows the throw, so without this the stack never reaches the console.
    console.error('[portqueue-dashboard] Render error:', error, info.componentStack);
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <PageBody>
          <Details error={this.state.error} />
        </PageBody>
      );
    }
    return this.props.children;
  }
}
