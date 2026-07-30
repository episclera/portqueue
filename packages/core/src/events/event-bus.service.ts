import {
  PortQueueEvent,
  type EventListener,
  type PortQueueEventPayloads,
  type Unsubscribe,
} from './event-name.enum';
import type { Logger } from '../logging/logger.interface';

interface Registration {
  listener: (payload: unknown) => void;
  queue?: string;
  once: boolean;
}

/** One event's listeners, plus how many of them are `once` registrations. */
interface Bucket {
  registrations: Set<Registration>;
  /** Kept in step with the set, so `emit` knows whether removal during iteration is possible. */
  onceCount: number;
}

/**
 * Typed event bus. Synchronous fan-out; listeners may be async but the
 * bus never awaits them (observation must not block the hot path). A throwing listener is
 * caught, logged, and re-surfaced as {@link PortQueueEvent.ERROR} — never breaks emission.
 *
 * Four to six events fire per job, so `emit` is a hot path. It iterates the registration set
 * **directly** and only snapshots it when the set actually holds a `once` listener — the one case
 * where emission mutates what it is iterating. Tracking that with a counter turns the common case
 * (plain `on` listeners, or none) from an allocation per event into none at all.
 */
export class EventBusService {
  private readonly buckets = new Map<PortQueueEvent, Bucket>();

  constructor(private readonly logger: Logger) {}

  on<E extends PortQueueEvent>(
    event: E,
    listener: EventListener<E>,
    filter?: { queue?: string },
  ): Unsubscribe {
    return this.add(event, listener as (p: unknown) => void, filter?.queue, false);
  }

  once<E extends PortQueueEvent>(
    event: E,
    listener: EventListener<E>,
    filter?: { queue?: string },
  ): Unsubscribe {
    return this.add(event, listener as (p: unknown) => void, filter?.queue, true);
  }

  off<E extends PortQueueEvent>(event: E, listener: EventListener<E>): void {
    const bucket = this.buckets.get(event);
    if (!bucket) return;
    // Snapshot, then delete. Mutating a Set mid-iteration is legal, but doing it here while `emit`
    // copies the set for exactly that reason would leave the two reading as inconsistent about the
    // same hazard.
    const matches = [...bucket.registrations].filter(
      (reg) => reg.listener === (listener as (p: unknown) => void),
    );
    for (const reg of matches) this.remove(bucket, reg);
  }

  private add(
    event: PortQueueEvent,
    listener: (p: unknown) => void,
    queue: string | undefined,
    once: boolean,
  ): Unsubscribe {
    let bucket = this.buckets.get(event);
    if (!bucket) {
      bucket = { registrations: new Set(), onceCount: 0 };
      this.buckets.set(event, bucket);
    }
    const reg: Registration = { listener, once, ...(queue !== undefined ? { queue } : {}) };
    bucket.registrations.add(reg);
    if (once) bucket.onceCount += 1;
    const target = bucket;
    return () => this.remove(target, reg);
  }

  private remove(bucket: Bucket, reg: Registration): void {
    if (!bucket.registrations.delete(reg)) return;
    if (reg.once) bucket.onceCount -= 1;
  }

  emit<E extends PortQueueEvent>(event: E, payload: PortQueueEventPayloads[E]): void {
    const bucket = this.buckets.get(event);
    if (!bucket || bucket.registrations.size === 0) return;
    const queue = (payload as { queue?: string }).queue;
    // Only a `once` listener is removed while we iterate, so only then is a snapshot needed.
    const targets: Iterable<Registration> =
      bucket.onceCount > 0 ? [...bucket.registrations] : bucket.registrations;
    for (const reg of targets) {
      if (reg.queue !== undefined && reg.queue !== queue) continue;
      if (reg.once) this.remove(bucket, reg);
      try {
        reg.listener(payload);
      } catch (err) {
        // Isolate listener errors and re-surface (avoid infinite loop on ERROR itself).
        this.logger.error('Event listener threw; isolated.', { err, event });
        if (event !== PortQueueEvent.ERROR) {
          this.emit(PortQueueEvent.ERROR, { error: err, source: 'listener' });
        }
      }
    }
  }
}
