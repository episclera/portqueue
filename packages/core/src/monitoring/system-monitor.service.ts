import { monitorEventLoopDelay } from 'node:perf_hooks';
import { cpus, freemem, totalmem } from 'node:os';
import { PortQueueEvent } from '../events/event-name.enum';
import type { SystemLimiterOptions } from '../options/common';
import type { EventBusService } from '../events/event-bus.service';
import type { Logger } from '../logging/logger.interface';

type EventLoopDelayMonitor = ReturnType<typeof monitorEventLoopDelay>;

/**
 * One sample of the **machine's** health, not this process's. Both percentages are 0-100 shares of
 * the whole host: CPU is busy time across every core, memory is used memory over total memory.
 *
 * Machine-wide is the reading an operator acts on. A Node process at 30% of one core tells you
 * nothing about whether the box it shares with a database and three other services can take more
 * work — and a queue that throttles on its own CPU keeps claiming while the host thrashes.
 */
export interface SystemMetrics {
  /** Share of total CPU time the machine spent busy since the previous sample (0-100). */
  cpuPercent: number;
  /** Used machine memory as a share of `os.totalmem()`, not of a container limit. */
  memoryPercent: number;
  /** Mean event-loop delay in seconds, or null when it isn't being watched. */
  eventLoopDelaySeconds: number | null;
}

/** A configured threshold and the reading taken against it. */
interface Reading {
  metric: string;
  value: number;
  threshold: number;
}

/** Busy and total CPU time across every core, in the units `os.cpus()` reports. */
interface CpuTimes {
  idle: number;
  total: number;
}

/**
 * Sum every core's time counters. These are monotonic since boot, so a percentage only means
 * something as a difference between two reads.
 */
function readCpuTimes(): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const core of cpus()) {
    for (const [mode, milliseconds] of Object.entries(core.times)) {
      total += milliseconds;
      if (mode === 'idle') idle += milliseconds;
    }
  }
  return { idle, total };
}

/**
 * Samples the **machine's** health, and optionally throttles on it.
 *
 * **Monitoring is unconditional.** Host CPU and memory are sampled for as long as the client runs,
 * because the instance heartbeat persists them — that is what makes the dashboard's per-instance
 * metrics possible, so there is no option to turn it off. Both numbers describe the whole host, so
 * two PortQueue processes on one box report the same figures; the instance row says *where* the
 * reading was taken, not whose memory it was.
 *
 * **Limiting is opt-in.** Only when the caller passes `systemLimiter` does a breached threshold
 * raise the backpressure flag that stops workers claiming (with hysteresis on the way down, so a
 * metric hovering at its limit doesn't flap). Event-loop delay is the one metric that isn't sampled
 * unless asked for — and the one that is genuinely about this process rather than the host: reading
 * it means keeping a `perf_hooks` histogram enabled for the process's lifetime, so it is enabled
 * only when `maxEventLoopDelaySeconds` gives it a purpose.
 *
 * Uses only Node built-ins. Pressure transitions are observed via the event bus, never a callback.
 */
export class SystemMonitorService {
  private timer: NodeJS.Timeout | null = null;
  private histogram: EventLoopDelayMonitor | null = null;
  private lastCpuTimes = readCpuTimes();
  private _pressureHigh = false;
  private _metrics: SystemMetrics = {
    cpuPercent: 0,
    memoryPercent: 0,
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
    this._metrics = this.measure();
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
  private measure(): SystemMetrics {
    const previous = this.lastCpuTimes;
    const current = readCpuTimes();
    this.lastCpuTimes = current;
    const elapsed = current.total - previous.total;
    const busy = elapsed - (current.idle - previous.idle);
    // Two samples inside one clock tick leave no CPU time to divide by; keeping the previous
    // reading is honest, where reporting 0% would claim an idle machine.
    const cpuPercent = elapsed > 0 ? (busy / elapsed) * 100 : this._metrics.cpuPercent;

    const total = totalmem();
    let eventLoopDelaySeconds: number | null = null;
    if (this.histogram) {
      // The histogram reports nanoseconds and is reset each sample, so this is the mean since the
      // previous one rather than since the process started.
      eventLoopDelaySeconds = this.histogram.mean / 1e9;
      this.histogram.reset();
    }
    return {
      cpuPercent,
      memoryPercent: ((total - freemem()) / total) * 100,
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
