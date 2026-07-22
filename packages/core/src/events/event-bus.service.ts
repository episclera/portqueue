import {
  PortQueueEvent,
  type EventListener,
  type PortQueueEventPayloads,
  type Unsubscribe,
} from './event-name.enum.js';
import type { Logger } from '../logging/logger.interface.js';

interface Registration {
  listener: (payload: unknown) => void;
  queue?: string;
  once: boolean;
}

/**
 * Typed event bus. Synchronous fan-out; listeners may be async but the
 * bus never awaits them (observation must not block the hot path). A throwing listener is
 * caught, logged, and re-surfaced as {@link PortQueueEvent.ERROR} — never breaks emission.
 */
export class EventBusService {
  private readonly registrations = new Map<PortQueueEvent, Set<Registration>>();

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
    const set = this.registrations.get(event);
    if (!set) return;
    for (const reg of set) {
      if (reg.listener === (listener as (p: unknown) => void)) set.delete(reg);
    }
  }

  private add(
    event: PortQueueEvent,
    listener: (p: unknown) => void,
    queue: string | undefined,
    once: boolean,
  ): Unsubscribe {
    let set = this.registrations.get(event);
    if (!set) {
      set = new Set();
      this.registrations.set(event, set);
    }
    const reg: Registration = { listener, once, ...(queue !== undefined ? { queue } : {}) };
    set.add(reg);
    return () => set!.delete(reg);
  }

  emit<E extends PortQueueEvent>(event: E, payload: PortQueueEventPayloads[E]): void {
    const set = this.registrations.get(event);
    if (!set || set.size === 0) return;
    const queue = (payload as { queue?: string }).queue;
    for (const reg of [...set]) {
      if (reg.queue !== undefined && reg.queue !== queue) continue;
      if (reg.once) set.delete(reg);
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
