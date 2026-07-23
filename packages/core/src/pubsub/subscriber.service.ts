import type { Driver, Subscription } from '../driver/driver.interface.js';
import { DriverCapability } from '../driver/driver-capabilities.js';
import { matchesInstance } from '../jobs/instance-affinity.js';
import type { Logger } from '../logging/logger.interface.js';
import type { Wakeup } from './wakeup.js';
import { PubSubChannel } from './channels.js';

/**
 * Listens for DB notifications and wakes claim loops. When LISTEN/NOTIFY
 * is unavailable it relies on each worker's interval poller; a "safety poll" also runs even
 * when LISTEN is available to catch missed notifications (delayed jobs, stalled reclaims).
 */
export class SubscriberService {
  private subscription: Subscription | null = null;
  private safetyTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly driver: Driver,
    private readonly logger: Logger,
    private readonly wakeup: Wakeup,
    private readonly safetyPollMs: number,
    private readonly instanceKey: string | null,
  ) {}

  async start(): Promise<void> {
    if (this.driver.capabilities[DriverCapability.LISTEN_NOTIFY]) {
      try {
        this.subscription = await this.driver.subscribe({
          channel: PubSubChannel.JOBS,
          onNotification: (payload) => {
            try {
              const { queue, pattern } = JSON.parse(payload) as {
                queue?: string;
                pattern?: string | null;
              };
              if (!queue) {
                this.wakeup.signalAll();
                return;
              }
              // Skip the wakeup when the added job targets a pattern this instance can't match —
              // claiming it would find nothing. Jobs meant for us fire their own notify, and the
              // safety poll backstops anything missed. Null pattern (or single-instance) → wake.
              if (pattern != null && this.instanceKey != null) {
                if (!matchesInstance(pattern, this.instanceKey)) return;
              }
              this.wakeup.signal(queue);
            } catch {
              this.wakeup.signalAll();
            }
          },
        });
      } catch (err) {
        this.logger.warn('LISTEN/NOTIFY subscribe failed; relying on polling.', { err });
      }
    } else {
      this.logger.debug('Driver has no LISTEN/NOTIFY; using interval polling.');
    }
    // Safety poll backstops missed notifications and delayed/stalled jobs on every driver.
    this.safetyTimer = setInterval(() => this.wakeup.signalAll(), this.safetyPollMs);
    this.safetyTimer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.safetyTimer) {
      clearInterval(this.safetyTimer);
      this.safetyTimer = null;
    }
    if (this.subscription) {
      await this.subscription.unsubscribe().catch(() => undefined);
      this.subscription = null;
    }
  }
}
