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
import type { Command, Flags, Teardown } from '../commands/types';

beforeEach(() => setColorEnabled(false));

export interface CommandRun {
  stdout: string;
  stderr: string;
  calls: FakePqCalls;
  /** Teardowns the command registered, in the order the runner would call them. */
  teardowns: Teardown[];
}

/**
 * Drive `command.run` with `flags`. `overrides` shapes what the fake client answers, so a test can
 * exercise the not-found, refused and partial paths without a database.
 *
 * The teardowns a command registers are collected rather than run, so a test can assert that a
 * persistent command hands its server or interval over to be closed — the thing that used to be
 * dropped on the floor.
 */
export async function runCommand(
  command: Pick<Command, 'run'>,
  flags: Flags = {},
  overrides?: FakePqOverrides,
): Promise<CommandRun> {
  const fake = makeFakePq(overrides);
  const teardowns: Teardown[] = [];
  const output = await captureOutput(() =>
    command.run({ pq: fake.pq, flags, onExit: (fn) => void teardowns.unshift(fn) }),
  );
  return { ...output, calls: fake.calls, teardowns };
}

/** The fake client on its own, for the few assertions that need it before `run` is called. */
export { makeFakePq };
