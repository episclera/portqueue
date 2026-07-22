import { randomUUID } from 'node:crypto';

/** Generate a v4 UUID via `node:crypto`. Used when the engine can't. */
export function uuid(): string {
  return randomUUID();
}
