/**
 * Action hook: wraps mutating API calls with toast feedback and a global refetch pulse.
 * Read-only mode hides the callers, but this is a convenience layer — the server enforces it.
 */
import { useToast } from '@portqueue/ui';
import { useCallback } from 'react';
import { api } from '../queries/api.js';
import { useLive } from '../components/LiveProvider.js';
import type { ActionRequestDto } from '../../shared/dto.js';

export function useAction(): {
  run: (body: ActionRequestDto, successMessage?: string) => Promise<boolean>;
} {
  const toast = useToast();
  const { refreshNow } = useLive();

  const run = useCallback(
    async (body: ActionRequestDto, successMessage?: string): Promise<boolean> => {
      try {
        await api.action(body);
        toast.success(successMessage ?? 'Done');
        refreshNow();
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Action failed');
        return false;
      }
    },
    [toast, refreshNow],
  );

  return { run };
}
