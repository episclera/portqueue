import {
  HookPhase,
  type BeforeAddResult,
  type HookRegistration,
  type ProcessOutcome,
} from './hooks';
import type { AddJobOptions } from '../options/job-options';
import type { Job } from '../jobs/job';
import type { AddJobResult } from '../producer/results';
import type { Logger } from '../logging/logger.interface';
import type { EventBusService } from './event-bus.service';
import { PortQueueEvent } from './event-name.enum';

/** The shared empty result for a phase nothing registered against — never allocated per call. */
const EMPTY: readonly HookRegistration[] = [];

/**
 * Runs participation hooks. Hooks are awaited, in registration order.
 * A BEFORE_* throw aborts the operation; an AFTER_* throw is logged and surfaced via ERROR
 * but does not undo the completed operation.
 *
 * Hooks are **indexed by phase at registration time**. `forPhase` runs four times per job, and
 * filtering the whole array each time meant an allocation and a full scan per job even for an
 * application with no hooks at all; now the no-hook case is a `Map` miss and an early return.
 */
export class HookRunner {
  private readonly byPhase = new Map<HookPhase, HookRegistration[]>();

  constructor(
    private readonly logger: Logger,
    private readonly events: EventBusService,
  ) {}

  register(hook: HookRegistration): () => void {
    const bucket = this.byPhase.get(hook.phase);
    if (bucket) bucket.push(hook);
    else this.byPhase.set(hook.phase, [hook]);
    return () => {
      const current = this.byPhase.get(hook.phase);
      if (!current) return;
      const i = current.indexOf(hook);
      if (i >= 0) current.splice(i, 1);
      if (current.length === 0) this.byPhase.delete(hook.phase);
    };
  }

  /**
   * The hooks for one phase that apply to `queue`, in registration order. Returns the phase's own
   * array untouched when every hook in it is unscoped — the common case — so no array is built.
   */
  private forPhase(phase: HookPhase, queue: string): readonly HookRegistration[] {
    const bucket = this.byPhase.get(phase);
    if (!bucket || bucket.length === 0) return EMPTY;
    if (bucket.every((h) => h.queue === undefined)) return bucket;
    return bucket.filter((h) => h.queue === undefined || h.queue === queue);
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
