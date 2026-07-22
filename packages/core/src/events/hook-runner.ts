import {
  HookPhase,
  type BeforeAddResult,
  type HookRegistration,
  type ProcessOutcome,
} from './hooks.js';
import type { AddJobOptions } from '../options/job-options.js';
import type { Job } from '../jobs/job.js';
import type { AddJobResult } from '../producer/results.js';
import type { Logger } from '../logging/logger.interface.js';
import type { EventBusService } from './event-bus.service.js';
import { PortQueueEvent } from './event-name.enum.js';

/**
 * Runs participation hooks. Hooks are awaited, in registration order.
 * A BEFORE_* throw aborts the operation; an AFTER_* throw is logged and surfaced via ERROR
 * but does not undo the completed operation.
 */
export class HookRunner {
  private readonly hooks: HookRegistration[] = [];

  constructor(
    private readonly logger: Logger,
    private readonly events: EventBusService,
  ) {}

  register(hook: HookRegistration): () => void {
    this.hooks.push(hook);
    return () => {
      const i = this.hooks.indexOf(hook);
      if (i >= 0) this.hooks.splice(i, 1);
    };
  }

  private forPhase(phase: HookPhase, queue: string): HookRegistration[] {
    return this.hooks.filter(
      (h) => h.phase === phase && (h.queue === undefined || h.queue === queue),
    );
  }

  /** Run BEFORE_ADD hooks; may mutate options or veto by throwing. Returns merged options. */
  async runBeforeAdd<TData>(
    queue: string,
    options: AddJobOptions<TData>,
  ): Promise<AddJobOptions<TData>> {
    let current = options;
    for (const hook of this.forPhase(HookPhase.BEFORE_ADD, queue)) {
      const result = (await (hook.handler as (ctx: unknown) => Promise<BeforeAddResult | void>)({
        queue,
        options: current,
      })) as BeforeAddResult<TData> | void;
      if (result?.options) current = { ...current, ...result.options };
    }
    return current;
  }

  async runAfterAdd(queue: string, result: AddJobResult): Promise<void> {
    for (const hook of this.forPhase(HookPhase.AFTER_ADD, queue)) {
      await this.safeAfter(hook, { result });
    }
  }

  /** Run BEFORE_PROCESS hooks; a throw skips/fails the job before the handler runs. */
  async runBeforeProcess(queue: string, job: Job): Promise<void> {
    for (const hook of this.forPhase(HookPhase.BEFORE_PROCESS, queue)) {
      await (hook.handler as (ctx: unknown) => Promise<void>)({ job });
    }
  }

  async runAfterProcess(queue: string, job: Job, outcome: ProcessOutcome): Promise<void> {
    for (const hook of this.forPhase(HookPhase.AFTER_PROCESS, queue)) {
      await this.safeAfter(hook, { job, outcome });
    }
  }

  private async safeAfter(hook: HookRegistration, ctx: unknown): Promise<void> {
    try {
      await (hook.handler as (c: unknown) => Promise<void>)(ctx);
    } catch (err) {
      this.logger.error('AFTER hook threw; isolated.', { err, phase: hook.phase });
      this.events.emit(PortQueueEvent.ERROR, { error: err, source: 'hook' });
    }
  }
}
