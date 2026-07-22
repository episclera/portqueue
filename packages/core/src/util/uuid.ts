import { randomUUID } from 'node:crypto';

/** Generate a v4 UUID via `node:crypto` (build_plan/01.7). Used when the engine can't. */
export function uuid(): string {
  return randomUUID();
}
