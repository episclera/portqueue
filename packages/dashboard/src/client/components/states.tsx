/**
 * The two states a data view can be in besides "showing rows": failed, and legitimately empty.
 *
 * Both used to render the same way — an empty table reading "No queues yet." whether the database
 * held nothing or the server had just 500'd. They are opposite situations and now look it: a
 * failure states what broke and offers a retry, and an empty view says what to do next and links
 * the docs that show how.
 */
import React from 'react';
import { Alert, Button, OpenIcon, Stack, Text } from '@portqueue/ui';

/** Where the docs live, so an empty state can point at the page that fixes it. */
const DOCS_BASE = 'https://episclera.github.io/portqueue/docs';

export const DOCS = {
  firstQueue: `${DOCS_BASE}/getting-started/first-queue`,
  producing: `${DOCS_BASE}/guides/producing-jobs`,
  scheduling: `${DOCS_BASE}/guides/scheduling`,
  scaleHorizontally: `${DOCS_BASE}/scale-horizontally`,
};

export interface ErrorStateProps {
  /** What failed, in the user's terms: "Couldn't load queues". */
  title: string;
  error: unknown;
  /** Wired to the query's `refetch`, when the caller has one. */
  onRetry?: () => void;
}

/** Turn whatever was thrown into something worth reading. */
function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'The dashboard could not reach its server.';
}

/**
 * The failure state for any data view. Rendered *instead of* the table or the cards, never as a
 * banner above stale rows — showing both invites reading old numbers as current ones.
 */
export function ErrorState({ title, error, onRetry }: ErrorStateProps): React.ReactElement {
  return (
    <Alert
      type="error"
      title={title}
      action={
        onRetry ? (
          <Button size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : undefined
      }
    >
      <Stack gap={1}>
        <Text small>{messageOf(error)}</Text>
        <Text tone="muted" small>
          The queue itself keeps running — this only affects what the dashboard can display.
        </Text>
      </Stack>
    </Alert>
  );
}

export interface EmptyStateProps {
  /** The plain statement of emptiness: "No queues yet." */
  message: string;
  /** The next step, phrased as guidance: "Here's how to add your first job". */
  hint?: string;
  /** Where that guidance lives. */
  docsHref?: string;
  docsLabel?: string;
}

/**
 * The empty state for a table. A first-run dashboard is the most likely place to see one, so it
 * says what to do rather than stopping at "nothing here".
 */
export function EmptyState({
  message,
  hint,
  docsHref,
  docsLabel = 'Read the guide',
}: EmptyStateProps): React.ReactElement {
  return (
    <Stack gap={1} align="center">
      <Text tone="muted">{message}</Text>
      {hint ? (
        <Text tone="muted" small>
          {hint}{' '}
          {docsHref ? (
            <a href={docsHref} target="_blank" rel="noreferrer noopener">
              {docsLabel} <OpenIcon aria-hidden />
            </a>
          ) : null}
        </Text>
      ) : null}
    </Stack>
  );
}
