/** Logical pub/sub channels. Never a string literal at a notify/subscribe site. */
export enum PubSubChannel {
  /** New/changed jobs — carries a lightweight `{ queue }` signal, never the payload. */
  JOBS = 'jobs',
}
