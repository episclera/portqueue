/**
 * Action hook: wraps mutating API calls with toast feedback and a global refetch pulse.
 * Read-only mode hides the callers, but this is a convenience layer — the server enforces it.
 */
import { useToast } from '@portqueue/ui';
import { useCallback } from 'react';
import { api } from '../queries/api';
import { useLive } from '../components/LiveProvider';
import type { ActionRequestDto } from '../../shared/dto';

export interface RunOptions {
  /**
   * Skip the success toast and the refetch pulse. Used by bulk fan-outs so N mutations cost one
   * toast and one refetch instead of N of each — the caller refreshes once at the end.
   */
  silent?: boolean;
}

export function useAction(): {
  run: (body: ActionRequestDto, successMessage?: string, options?: RunOptions) => Promise<boolean>;
  refresh: () => void;
} {
  const toast = useToast();
  const { refreshNow } = useLive();

  const run = useCallback(
    async (
      body: ActionRequestDto,
      successMessage?: string,
      options?: RunOptions,
    ): Promise<boolean> => {
      try {
        await api.action(body);
        if (!options?.silent) {
          toast.success(successMessage ?? 'Done');
          refreshNow();
        }
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Action failed');
        return false;
      }
    },
    [toast, refreshNow],
  );

  return { run, refresh: refreshNow };
}
