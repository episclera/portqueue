/**
 * Action hook: wraps mutating API calls with toast feedback (antd's `message`) and a cache invalidation, so every
 * page showing affected data refetches once the mutation lands.
 *
 * Bulk actions are **one request**: the server applies every id in a single transaction and
 * reports how many rows it changed. That replaces the old fan-out of N sequential requests, which
 * produced N error toasts on a bad batch and no summary of what actually happened.
 */
import { useCallback } from 'react';
import { App } from 'antd';
import { api } from './api';
import { useRefreshAll } from './use-queries';
import type { ActionRequestDto, ActionResultDto } from '../../shared/dto';

export interface RunOptions {
  /** Suppress the success toast (the caller reports the outcome itself). Errors still surface. */
  silent?: boolean;
}

export interface ActionRunner {
  /** Fire one action. Returns the server's result, or null when it failed (already toasted). */
  run: (
    body: ActionRequestDto,
    successMessage?: string,
    options?: RunOptions,
  ) => Promise<ActionResultDto | null>;
  /**
   * Fire a batch and report it once: "Removed 3 of 5 jobs." when the server acted on fewer rows
   * than were asked for, plain "Removed 5 jobs." when it acted on all of them.
   */
  runBatch: (
    body: ActionRequestDto,
    labels: { verb: string; noun: string },
  ) => Promise<ActionResultDto | null>;
  /** Refetch every dashboard query. */
  refresh: () => void;
}

export function useAction(): ActionRunner {
  const { message: toast } = App.useApp();
  const refresh = useRefreshAll();

  const run = useCallback(
    async (
      body: ActionRequestDto,
      successMessage?: string,
      options?: RunOptions,
    ): Promise<ActionResultDto | null> => {
      try {
        const result = await api.action(body);
        if (!options?.silent) toast.success(successMessage ?? 'Done');
        refresh();
        return result;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Action failed');
        return null;
      }
    },
    [toast, refresh],
  );

  const runBatch = useCallback(
    async (
      body: ActionRequestDto,
      labels: { verb: string; noun: string },
    ): Promise<ActionResultDto | null> => {
      const result = await run(body, undefined, { silent: true });
      if (!result) return null;
      const { affected = 0, requested = 0, signalled = 0 } = result;
      const plural = (n: number): string => `${labels.noun}${n === 1 ? '' : 's'}`;
      // Jobs running in the dashboard's own process were only asked to stop, so they are named
      // separately — counting them as cancelled is how a toast came to say "Cancelled 3 jobs" for
      // three jobs that all completed normally.
      const asked = signalled
        ? `${signalled} running ${signalled === 1 ? 'job was' : 'jobs were'} asked to stop.`
        : '';
      // A shortfall is normal rather than an error: a row may have finished, vanished, or been an
      // ACTIVE job a removal refuses. Naming both numbers is more honest than claiming all N.
      const shortfall = requested > 0 && affected + signalled < requested;
      if (shortfall) {
        toast.info(
          [`${labels.verb} ${affected} of ${requested} ${plural(requested)}.`, asked]
            .filter(Boolean)
            .join(' '),
        );
      } else if (affected === 0 && signalled > 0) {
        // Nothing has been settled yet — "Cancelled 0 jobs." in front of this would read as a
        // failure, and a success toast would claim an outcome the handlers have not reached.
        toast.info(asked);
      } else {
        toast.success(
          [`${labels.verb} ${affected} ${plural(affected)}.`, asked].filter(Boolean).join(' '),
        );
      }
      return result;
    },
    [run, toast],
  );

  return { run, runBatch, refresh };
}
