import { InvalidOptionsError } from '../errors/errors.js';
import type { WorkflowDefinition, WorkflowStep } from '../jobs/job.js';

/**
 * Build a shared, pure {@link WorkflowDefinition} (build_plan/05.3). No I/O.
 * Validates unique step keys and records the ordered steps + entry step (`steps[0].key`).
 */
export function defineWorkflow<TData = unknown, TQueue extends string = string>(options: {
  queue: TQueue;
  steps: Array<WorkflowStep<TData>>;
}): WorkflowDefinition<TData, TQueue> {
  const { queue, steps } = options;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new InvalidOptionsError(
      `Workflow for queue '${queue}' must declare at least one step (an ordered array of { key, handler }).`,
    );
  }
  const seen = new Set<string>();
  for (const step of steps) {
    if (!step.key) {
      throw new InvalidOptionsError(`Workflow for queue '${queue}' has a step with an empty key.`);
    }
    if (seen.has(step.key)) {
      throw new InvalidOptionsError(
        `Workflow for queue '${queue}' has a duplicate step key '${step.key}'. Step keys must be unique.`,
      );
    }
    seen.add(step.key);
  }
  return {
    queue,
    steps: steps.slice(),
    entryStep: steps[0]!.key,
  };
}
