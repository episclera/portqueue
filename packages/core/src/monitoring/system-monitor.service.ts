import { monitorEventLoopDelay } from 'node:perf_hooks';
import { cpuUsage, memoryUsage } from 'node:process';
import { totalmem } from 'node:os';
import { PortQueueEvent } from '../events/event-name.enum';
import type { SystemLimiterOptions } from '../options/common';
import type { EventBusService } from '../events/event-bus.service';
import type { Logger } from '../logging/logger.interface';

type EventLoopDelayMonitor = ReturnType<typeof monitorEventLoopDelay>;

/** One sample of this process's own health. Percentages are 0-100; `rssBytes` is absolute. */
export interface SystemMetrics {
  /** Process CPU since the previous sample, summed across cores (so >100 is possible). */
  cpuPercent: number;
  /** RSS as a share of total machine memory (`os.totalmem()`), not of a container limit. */
  memoryPercent: number;
  rssBytes: number;
  /** Mean event-loop delay in seconds, or null when it isn't being watched. */
  eventLoopDelaySeconds: number | null;
}

/** A configured threshold and the reading taken against it. */
interface Reading {
  metric: string;
  value: number;
  threshold: number;
}

/**
 * Samples this process's own health, and optionally throttles on it.
 *
 * **Monitoring is unconditional.** CPU, memory share and RSS are sampled for as long as the client
 * runs, because the instance heartbeat persists them — that is what makes the dashboard's
 * per-instance metrics possible, so there is no option to turn it off.
 *
 * **Limiting is opt-in.** Only when the caller passes `systemLimiter` does a breached threshold
 * raise the backpressure flag that stops workers claiming (with hysteresis on the way down, so a
 * metric hovering at its limit doesn't flap). Event-loop delay is the one metric that isn't sampled
 * unless asked for: reading it means keeping a `perf_hooks` histogram enabled for the process's
 * lifetime, so it is enabled only when `maxEventLoopDelaySeconds` gives it a purpose.
 *
 * Uses only Node built-ins. Pressure transitions are observed via the event bus, never a callback.
 */
export class SystemMonitorService {
  private timer: NodeJS.Timeout | null = null;
  private histogram: EventLoopDelayMonitor | null = null;
  private lastCpu = cpuUsage();
  private lastSample = Date.now();
  private _pressureHigh = false;
  private _metrics: SystemMetrics = {
    cpuPercent: 0,
    memoryPercent: 0,
    rssBytes: 0,
    eventLoopDelaySeconds: null,
  };

  constructor(
    /** Thresholds that make workers pause. Undefined means monitor only, never throttle. */
    private readonly limiter: SystemLimiterOptions | undefined,
    private readonly events: EventBusService,
    private readonly logger: Logger,
    private readonly onResume: () => void,
  ) {}

  /** The most recent sample. Zeroed until the first one lands. */
  get metrics(): SystemMetrics {
    return this._metrics;
  }

  get pressureHigh(): boolean {
    return this._pressureHigh;
  }

  start(): void {
    if (this.limiter?.maxEventLoopDelaySeconds != null) {
      this.histogram = monitorEventLoopDelay({ resolution: 20 });
      this.histogram.enable();
    }
    const intervalSeconds = this.limiter?.sampleIntervalSeconds ?? 2;
    this.timer = setInterval(() => this.sample(), intervalSeconds * 1000);
    this.timer.unref?.();
    // Take one sample immediately so the first heartbeat has real numbers to persist.
    this.sample();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.histogram?.disable();
    this.histogram = null;
  }

  private sample(): void {
    const now = Date.now();
    this._metrics = this.measure(now);
    this.lastSample = now;
    if (!this.limiter) return; // monitoring only

    const readings = this.readings(this._metrics);
    const breached = readings.find((r) => r.value > r.threshold);

    if (breached) {
      if (!this._pressureHigh) {
        this._pressureHigh = true;
        this.logger.warn('System pressure high; workers pause claiming until it clears.', {
          metric: breached.metric,
          value: breached.value,
          threshold: breached.threshold,
        });
        this.events.emit(PortQueueEvent.SYSTEM_PRESSURE_HIGH, breached);
      }
      return;
    }

    // Hysteresis: every watched metric must fall to a fraction of its own threshold before workers
    // resume, so one hovering at its limit doesn't toggle pressure on alternate samples. Comparing
    // against the live readings is the point — an earlier version compared a "nothing breached"
    // sentinel, which made any dip below the threshold count as recovered.
    if (this._pressureHigh) {
      const hysteresis = this.limiter.resumeHysteresis ?? 0.8;
      if (readings.every((r) => r.value <= r.threshold * hysteresis)) {
        this._pressureHigh = false;
        this.logger.info('System pressure normal; workers resume claiming.');
        this.events.emit(PortQueueEvent.SYSTEM_PRESSURE_NORMAL, {});
        this.onResume();
      }
    }
  }

  /** Read every metric, whether or not a threshold watches it. */
  private measure(now: number): SystemMetrics {
    const diff = cpuUsage(this.lastCpu);
    this.lastCpu = cpuUsage();
    const elapsedMicros = Math.max(1, (now - this.lastSample) * 1000);
    const rssBytes = memoryUsage().rss;
    let eventLoopDelaySeconds: number | null = null;
    if (this.histogram) {
      // The histogram reports nanoseconds and is reset each sample, so this is the mean since the
      // previous one rather than since the process started.
      eventLoopDelaySeconds = this.histogram.mean / 1e9;
      this.histogram.reset();
    }
    return {
      cpuPercent: ((diff.user + diff.system) / elapsedMicros) * 100,
      memoryPercent: (rssBytes / totalmem()) * 100,
      rssBytes,
      eventLoopDelaySeconds,
    };
  }

  /**
   * The configured thresholds paired with this sample's values. Only thresholds the caller set are
   * included — an unset one is never a reason to throttle, and never blocks a recovery either.
   */
  private readings(metrics: SystemMetrics): Reading[] {
    const limiter = this.limiter;
    if (!limiter) return [];
    const readings: Reading[] = [];
    if (limiter.maxEventLoopDelaySeconds != null && metrics.eventLoopDelaySeconds != null) {
      readings.push({
        metric: 'eventLoopDelaySeconds',
        value: metrics.eventLoopDelaySeconds,
        threshold: limiter.maxEventLoopDelaySeconds,
      });
    }
    if (limiter.maxCpuPercent != null) {
      readings.push({
        metric: 'cpuPercent',
        value: metrics.cpuPercent,
        threshold: limiter.maxCpuPercent,
      });
    }
    if (limiter.maxRssBytes != null) {
      readings.push({
        metric: 'rssBytes',
        value: metrics.rssBytes,
        threshold: limiter.maxRssBytes,
      });
    }
    if (limiter.maxMemoryPercent != null) {
      readings.push({
        metric: 'memoryPercent',
        value: metrics.memoryPercent,
        threshold: limiter.maxMemoryPercent,
      });
    }
    return readings;
  }
}
