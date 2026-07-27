import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { cpuUsage } from 'node:process';
import { getHeapStatistics } from 'node:v8';
import { PortQueueEvent } from '../events/event-name.enum';
import type { SystemLimiterOptions } from '../options/common';
import type { EventBusService } from '../events/event-bus.service';
import type { Logger } from '../logging/logger.interface';

type EventLoopDelayMonitor = ReturnType<typeof monitorEventLoopDelay>;

/**
 * One sample of **this Node process's** health, not the machine's.
 *
 * Per-process is the only reading that means anything here. A host figure says "the box is at 92%"
 * on a machine where the OS has merely *allocated* nearly all of RAM to page cache and other
 * processes — which is what Linux and macOS both do, so `os.freemem()` sits above 90% used on an
 * idle laptop and a memory threshold fires forever. It also says nothing about the process that is
 * actually running the jobs: a container with a 512 MB cap on a 64 GB host reads as healthy right
 * up to the moment it is killed.
 */
export interface SystemMetrics {
  /**
   * CPU this process burned since the previous sample, as a percentage of **one core**'s wall time
   * — the same convention `top` and `ps` use. A pegged main thread reads ~100; work spread over
   * libuv threads or worker threads can exceed 100.
   */
  cpuPercent: number;
  /**
   * Heap this process is holding as a share of the heap V8 will let it grow to
   * (`v8.getHeapStatistics().heap_size_limit`, which `--max-old-space-size` sets), 0-100.
   * 100 is the OOM abort, so this is the memory number worth throttling on — unlike a share of
   * machine RAM, which a process is never allowed to reach.
   */
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

/**
 * Samples **this process's** health, and optionally throttles on it.
 *
 * **Monitoring is unconditional.** Process CPU and heap are sampled for as long as the client runs,
 * because the instance heartbeat persists them — that is what makes the dashboard's per-instance
 * metrics possible, so there is no option to turn it off. Both numbers belong to the process that
 * took them, so two PortQueue processes on one box report their own figures and the instance row
 * says whose reading it was.
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
  // `performance.now()` rather than the clock: a monotonic origin, so a system clock that steps
  // backwards mid-sample can't produce a negative window and a CPU percentage to match.
  private lastSampleAt = performance.now();
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
    // `cpuUsage()` is cumulative microseconds of CPU time (user + system) since the process
    // started. Divided by the wall time of the window it is "cores busy", where 100 is one core
    // saturated — the figure `top` shows for a process. Read the absolute value once and subtract,
    // rather than taking `cpuUsage(previous)` and re-reading: two reads would leave the microseconds
    // between them out of the next window.
    const now = performance.now();
    const current = cpuUsage();
    const elapsedMicros = (now - this.lastSampleAt) * 1000;
    const usedMicros = current.user - this.lastCpu.user + (current.system - this.lastCpu.system);
    this.lastCpu = current;
    this.lastSampleAt = now;
    // Two samples inside one timer resolution leave no wall time to divide by; keeping the previous
    // reading is honest, where reporting 0% would claim an idle process.
    const cpuPercent =
      elapsedMicros > 0 ? (usedMicros / elapsedMicros) * 100 : this._metrics.cpuPercent;

    // The heap limit, not machine RAM: it is the ceiling this process actually dies at, and the one
    // `--max-old-space-size` moves. `used_heap_size` is what V8 reports as live after its last GC.
    const heap = getHeapStatistics();

    let eventLoopDelaySeconds: number | null = null;
    if (this.histogram) {
      // The histogram reports nanoseconds and is reset each sample, so this is the mean since the
      // previous one rather than since the process started.
      eventLoopDelaySeconds = this.histogram.mean / 1e9;
      this.histogram.reset();
    }
    return {
      cpuPercent,
      memoryPercent: (heap.used_heap_size / heap.heap_size_limit) * 100,
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
