import type { Driver } from '../driver/driver.interface.js';
import type { Logger } from '../logging/logger.interface.js';
import { PubSubChannel } from './channels.js';

/**
 * Emits DB notifications on new/changed jobs. Notifications carry only
 * a lightweight signal (`{ queue, pattern? }`), never the payload. The optional preferred-instance
 * pattern lets subscribers skip waking for jobs they can't claim.
 */
export class NotifierService {
  constructor(
    private readonly driver: Driver,
    private readonly logger: Logger,
    private readonly capable: boolean,
  ) {}

  async notifyJobAdded(queue: string, preferredInstanceKeyPattern?: string | null): Promise<void> {
    if (!this.capable) return;
    try {
      const signal =
        preferredInstanceKeyPattern != null
          ? { queue, pattern: preferredInstanceKeyPattern }
          : { queue };
      await this.driver.notify({ channel: PubSubChannel.JOBS, payload: JSON.stringify(signal) });
    } catch (err) {
      this.logger.debug('notify failed (non-fatal; poll backstops).', { err, queue });
    }
  }
}
