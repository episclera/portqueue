/**
 * Run one command against a fresh fake `PortQueue`, capturing what it printed and what it called.
 *
 * Every command test needs the same three things — a fake client, captured output, and a record of
 * the calls made — so they live here rather than being re-declared per file, where they would drift.
 *
 * Importing this also turns colour off for the suite: ANSI escapes would bury every assertion in
 * control characters, and no test cares what shade a heading is.
 */
import { setColorEnabled } from '../output';
import { captureOutput } from './capture';
import { makeFakePq, type FakePqCalls, type FakePqOverrides } from './fake-pq';
import type { Command, Flags } from '../commands/types';

beforeEach(() => setColorEnabled(false));

export interface CommandRun {
  stdout: string;
  stderr: string;
  calls: FakePqCalls;
}

/**
 * Drive `command.run` with `flags`. `overrides` shapes what the fake client answers, so a test can
 * exercise the not-found, refused and partial paths without a database.
 */
export async function runCommand(
  command: Pick<Command, 'run'>,
  flags: Flags = {},
  overrides?: FakePqOverrides,
): Promise<CommandRun> {
  const fake = makeFakePq(overrides);
  const output = await captureOutput(() => command.run({ pq: fake.pq, flags }));
  return { ...output, calls: fake.calls };
}

/** The fake client on its own, for the few assertions that need it before `run` is called. */
export { makeFakePq };
