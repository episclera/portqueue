/**
 * What a benchmarked library has to provide. The scenarios in `scenarios.ts` are written once
 * against this interface, so every library is timed by exactly the same code — only the calls into
 * the library differ.
 */
export interface JobData {
  i: number;
}

export interface Contender {
  /**
   * Boot a **new, empty, in-memory** PGLite, start the library on it and make sure the queue exists.
   * Never reuse a database between runs: every measurement starts from a clean one.
   */
  start(): Promise<void>;
  /** Jobs in the database, across every queue — `measure.ts` asserts it is 0 before measuring. */
  countJobs(): Promise<number>;
  /** Add one job and wait for the library to confirm it. */
  add(data: JobData): Promise<void>;
  /** Add many jobs in one library call. */
  addMany(data: JobData[]): Promise<void>;
  /**
   * Start consuming the queue with `handler`, `concurrency` jobs per claim and in flight. Resolves
   * once the consumer is live, so a job added right after is picked up by it.
   */
  consume(handler: (data: JobData) => Promise<void>, concurrency: number): Promise<void>;
  /** Resolve once `count` jobs are recorded as completed in the database. */
  waitForCompleted(count: number): Promise<void>;
  /** Stop the library and close the database. */
  stop(): Promise<void>;
}
