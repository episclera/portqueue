/**
 * The app's error boundary. Without one, a render throw anywhere blanks the SPA to a white page
 * whose only trace is in the console — the user sees nothing and has nothing to act on.
 *
 * This has to be a class: `componentDidCatch`/`getDerivedStateFromError` have no hook equivalent.
 */
import React from 'react';
import { Alert, Button, Card, Content, Inline, Stack, Text } from '@portqueue/ui';

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
    <Stack gap={3}>
      <Alert
        type="error"
        title="Something went wrong rendering this page"
        message={error.message || 'An unexpected error occurred.'}
      />
      <Text tone="muted" small>
        The dashboard itself failed here — your queues and jobs are unaffected. Reloading usually
        clears it; if it happens consistently, the browser console has the full stack trace.
      </Text>
      <Inline gap={2}>
        <Button variant="primary" onClick={() => window.location.reload()}>
          Reload the dashboard
        </Button>
      </Inline>
    </Stack>
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
        <Content>
          <Details error={this.state.error} />
        </Content>
      );
    }
    return this.props.children;
  }
}
