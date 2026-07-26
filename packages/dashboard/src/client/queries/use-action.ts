/**
 * Action hook: wraps mutating API calls with toast feedback and a cache invalidation, so every
 * page showing affected data refetches once the mutation lands.
 *
 * Bulk actions are **one request**: the server applies every id in a single transaction and
 * reports how many rows it changed. That replaces the old fan-out of N sequential requests, which
 * produced N error toasts on a bad batch and no summary of what actually happened.
 */
import { useToast } from '@portqueue/ui';
import { useCallback } from 'react';
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
  const toast = useToast();
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
      const { affected = 0, requested = 0 } = result;
      const noun = `${labels.noun}${affected === 1 ? '' : 's'}`;
      // A shortfall is normal rather than an error: a row may have finished, vanished, or been an
      // ACTIVE job a removal refuses. Naming both numbers is more honest than claiming all N.
      if (requested && affected < requested) {
        toast.info(`${labels.verb} ${affected} of ${requested} ${labels.noun}s.`);
      } else {
        toast.success(`${labels.verb} ${affected} ${noun}.`);
      }
      return result;
    },
    [run, toast],
  );

  return { run, runBatch, refresh };
}
