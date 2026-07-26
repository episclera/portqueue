/**
 * Shared harness for the client render tests: a stubbed axios adapter plus the provider stack the
 * app expects (theme, toasts, query cache, live toggle).
 *
 * The stub replaces axios' **adapter** rather than `global.fetch`, so requests still travel the
 * real client — including the response interceptor that turns a server's `{ error }` body into
 * the message the UI shows. Stubbing `fetch` would bypass that layer and test something the app
 * no longer does.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, ToastProvider } from '@portqueue/ui';
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios';
import { App } from '../client/App';
import { LiveProvider } from '../client/components/LiveProvider';
import { http } from '../client/queries/api';

/** A request the stub captured, in the terms a test asserts on. */
export interface CapturedRequest {
  method: string;
  url: string;
  params: Record<string, unknown>;
  body: unknown;
}

export interface StubOptions {
  /** Payload per endpoint path fragment, e.g. `{ '/queues': {...} }`. */
  responses?: Record<string, unknown>;
  /** Paths that should fail, mapped to the status and body the server would send. */
  failures?: Record<string, { status: number; body?: unknown }>;
  /** What `POST /actions` resolves to. */
  actionResult?: unknown;
}

export interface Harness {
  requests: CapturedRequest[];
  /** Only the mutations, in order — what the action tests assert on. */
  posts: CapturedRequest[];
  /** The body of the most recent mutation. */
  lastAction: () => unknown;
  renderApp: (hash: string) => void;
}

/** Longest-match lookup, so `/jobs/job-1` wins over `/jobs`. */
function matchKey(url: string, keys: string[]): string | undefined {
  return keys
    .filter((key) => url.includes(key))
    .sort((a, b) => b.length - a.length)
    .at(0);
}

export function createHarness(options: StubOptions = {}): Harness {
  const requests: CapturedRequest[] = [];
  const posts: CapturedRequest[] = [];

  const adapter: AxiosAdapter = async (config: AxiosRequestConfig) => {
    const url = String(config.url ?? '');
    const method = (config.method ?? 'get').toUpperCase();
    const captured: CapturedRequest = {
      method,
      url,
      params: (config.params as Record<string, unknown>) ?? {},
      body: config.data ? JSON.parse(String(config.data)) : undefined,
    };
    requests.push(captured);
    if (method === 'POST') posts.push(captured);

    const respond = (status: number, data: unknown): AxiosResponse =>
      ({ data, status, statusText: '', headers: {}, config }) as AxiosResponse;

    const failKey = matchKey(url, Object.keys(options.failures ?? {}));
    if (failKey) {
      const failure = options.failures![failKey]!;
      // Reject the way axios does, so the client's interceptor sees a real AxiosError shape.
      const error = Object.assign(new Error(`Request failed with status code ${failure.status}`), {
        isAxiosError: true,
        config,
        response: respond(failure.status, failure.body),
      });
      throw error;
    }

    if (method === 'POST') return respond(200, options.actionResult ?? { ok: true });

    const key = matchKey(url, Object.keys(options.responses ?? {}));
    return respond(200, key ? options.responses![key] : {});
  };

  http.defaults.adapter = adapter;

  const renderApp = (hash: string): void => {
    window.location.hash = hash;
    // A fresh cache per render, with retries off so a failure test asserts immediately rather
    // than after a backoff, and no stale window so each test starts from a real fetch.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
    });
    render(
      <ThemeProvider mode="light">
        <ToastProvider>
          <QueryClientProvider client={client}>
            <LiveProvider>
              <App onThemeChange={() => {}} />
            </LiveProvider>
          </QueryClientProvider>
        </ToastProvider>
      </ThemeProvider>,
    );
  };

  return { requests, posts, lastAction: () => posts.at(-1)?.body, renderApp };
}

/** A page DTO wrapper, so fixtures read as the API's actual shape. */
export function page<T>(items: T[], total = items.length): { items: T[]; total: number; hasMore: boolean } {
  return { items, total, hasMore: false };
}
