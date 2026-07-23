import { monitorEventLoopDelay } from 'node:perf_hooks';
import { cpuUsage, memoryUsage } from 'node:process';
import { totalmem } from 'node:os';
import { PortQueueEvent } from '../events/event-name.enum';
import type { SystemMonitorOptions } from '../options/common';
import type { EventBusService } from '../events/event-bus.service';
import type { Logger } from '../logging/logger.interface';

type EventLoopDelayMonitor = ReturnType<typeof monitorEventLoopDelay>;

/**
 * Samples event-loop lag / CPU / memory and sets a backpressure flag.
 * Workers with `respectSystemPressure` stop claiming while pressure is high. Uses only Node
 * built-ins. Pressure transitions are observed via the event bus, never a callback option.
 */
export class SystemMonitorService {
  private timer: NodeJS.Timeout | null = null;
  private histogram: EventLoopDelayMonitor | null = null;
  private lastCpu = cpuUsage();
  private lastSample = Date.now();
  private highSince = 0;
  private _pressureHigh = false;

  constructor(
    private readonly options: SystemMonitorOptions,
    private readonly events: EventBusService,
    private readonly logger: Logger,
    private readonly onResume: () => void,
  ) {}

  get pressureHigh(): boolean {
    return this._pressureHigh;
  }

  start(): void {
    this.histogram = monitorEventLoopDelay({ resolution: 20 });
    this.histogram.enable();
    const interval = this.options.sampleIntervalMs ?? 2000;
    this.timer = setInterval(() => this.sample(), interval);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.histogram?.disable();
    this.histogram = null;
  }

  private sample(): void {
    const now = Date.now();
    const { metric, value, threshold, over } = this.evaluate(now);
    this.lastSample = now;

    if (over) {
      if (!this._pressureHigh) {
        this._pressureHigh = true;
        this.highSince = now;
        this.logger.warn('System pressure high; workers will pause claiming.', {
          metric,
          value,
          threshold,
        });
        this.events.emit(PortQueueEvent.SYSTEM_PRESSURE_HIGH, { metric, value, threshold });
      }
    } else if (this._pressureHigh) {
      // Hysteresis: require a sustained recovery before resuming.
      const hysteresis = this.options.resumeHysteresis ?? 0.8;
      const recovered = value <= threshold * hysteresis;
      if (recovered) {
        this._pressureHigh = false;
        this.logger.info('System pressure normal; workers resume claiming.');
        this.events.emit(PortQueueEvent.SYSTEM_PRESSURE_NORMAL, {});
        this.onResume();
      }
    }
  }

  private evaluate(now: number): {
    metric: string;
    value: number;
    threshold: number;
    over: boolean;
  } {
    // Event-loop delay.
    if (this.options.maxEventLoopDelayMs != null && this.histogram) {
      const meanMs = this.histogram.mean / 1e6;
      this.histogram.reset();
      if (meanMs > this.options.maxEventLoopDelayMs) {
        return {
          metric: 'eventLoopDelayMs',
          value: meanMs,
          threshold: this.options.maxEventLoopDelayMs,
          over: true,
        };
      }
    }
    // CPU percent.
    if (this.options.maxCpuPercent != null) {
      const diff = cpuUsage(this.lastCpu);
      this.lastCpu = cpuUsage();
      const elapsedMicros = Math.max(1, (now - this.lastSample) * 1000);
      const percent = ((diff.user + diff.system) / elapsedMicros) * 100;
      if (percent > this.options.maxCpuPercent) {
        return {
          metric: 'cpuPercent',
          value: percent,
          threshold: this.options.maxCpuPercent,
          over: true,
        };
      }
    }
    // Memory.
    const rss = memoryUsage().rss;
    if (this.options.maxRssBytes != null && rss > this.options.maxRssBytes) {
      return { metric: 'rssBytes', value: rss, threshold: this.options.maxRssBytes, over: true };
    }
    if (this.options.maxMemoryPercent != null) {
      const percent = (rss / totalmem()) * 100;
      if (percent > this.options.maxMemoryPercent) {
        return {
          metric: 'memoryPercent',
          value: percent,
          threshold: this.options.maxMemoryPercent,
          over: true,
        };
      }
    }
    return { metric: 'none', value: 0, threshold: 1, over: false };
  }
}
