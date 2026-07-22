import type { Driver } from '../driver/driver.interface.js';
import type { Logger } from '../logging/logger.interface.js';
import { PubSubChannel } from './channels.js';

/**
 * Emits DB notifications on new/changed jobs. Notifications carry only
 * a lightweight signal (`{ queue }`), never the payload.
 */
export class NotifierService {
  constructor(
    private readonly driver: Driver,
    private readonly logger: Logger,
    private readonly capable: boolean,
  ) {}

  async notifyJobAdded(queue: string): Promise<void> {
    if (!this.capable) return;
    try {
      await this.driver.notify({ channel: PubSubChannel.JOBS, payload: JSON.stringify({ queue }) });
    } catch (err) {
      this.logger.debug('notify failed (non-fatal; poll backstops).', { err, queue });
    }
  }
}
