import { hostname, networkInterfaces } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { InstanceType } from '../options/enums.js';
import type { InstanceIdentityOptions } from '../options/common.js';
import type { Logger } from '../logging/logger.interface.js';

/**
 * Resolves this process's instance id + type once at startup.
 * Best-effort and never throws; failures fall back to UNKNOWN + a random id.
 */
export class InstanceIdentityService {
  readonly id: string;
  readonly type: InstanceType;

  constructor(options: InstanceIdentityOptions | undefined, logger: Logger) {
    let type = InstanceType.UNKNOWN;
    let id: string;
    try {
      if (options?.id) {
        id = options.id;
        type = options.type ?? this.detectType();
      } else {
        type = options?.type ?? this.detectType();
        id = type === InstanceType.CONTAINER ? this.containerId() : this.bareMetalId();
      }
    } catch (err) {
      logger.debug('Instance identity detection failed; using a random id.', { err });
      id = randomUUID();
    }
    this.id = id;
    this.type = type;
  }

  private detectType(): InstanceType {
    if (
      process.env.KUBERNETES_SERVICE_HOST ||
      process.env.DOCKER_CONTAINER ||
      this.looksContainerized()
    ) {
      return InstanceType.CONTAINER;
    }
    return InstanceType.BARE_METAL;
  }

  private looksContainerized(): boolean {
    try {
      const cgroup = readFileSync('/proc/self/cgroup', 'utf8');
      return /docker|kubepods|containerd/.test(cgroup);
    } catch {
      return false;
    }
  }

  private containerId(): string {
    if (process.env.HOSTNAME) return process.env.HOSTNAME;
    try {
      const cgroup = readFileSync('/proc/self/cgroup', 'utf8');
      const match = cgroup.match(/[0-9a-f]{64}/);
      if (match) return match[0].slice(0, 16);
    } catch {
      /* fall through */
    }
    return `container-${randomUUID().slice(0, 8)}`;
  }

  /** Stable, unprivileged bare-metal id: hostname + MAC hash. */
  private bareMetalId(): string {
    const macs: string[] = [];
    const ifaces = networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name] ?? []) {
        if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') macs.push(iface.mac);
      }
    }
    const seed = `${hostname()}:${macs.sort().join(',')}`;
    return createHash('sha1').update(seed).digest('hex').slice(0, 16);
  }
}
