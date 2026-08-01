/**
 * The mechanism `BaseDriver` owns — no SQL, so these are pure functions with pure answers: the bind
 * chunking every batch depends on, the search pattern escaping, and the affinity scan arithmetic.
 *
 * Exercised through a minimal subclass rather than a real driver, which is the point: none of this
 * needs a database, and it used to be covered only indirectly through engines that do.
 */
import { BaseDriver } from './base-driver';
import { MAX_BATCH_IDS } from '../../constants';
import { capabilities, DriverCapability, type DriverCapabilitySet } from '../driver-capabilities';
import type { PageWindow } from '../driver.interface';
import type { RawResult, Session } from './base-driver';

/** The four per-engine pieces, stubbed: nothing under test here issues a statement. */
class TestDriver extends BaseDriver {
  readonly capabilities: DriverCapabilitySet = capabilities({
    [DriverCapability.TRANSACTIONS]: true,
  });

  // Overridden as fields, the same way a real driver narrows its engine's limits.
  protected override readonly maxBindParams: number;
  protected override readonly maxInListItems: number;

  constructor(limits: { maxBindParams?: number; maxInListItems?: number } = {}) {
    super({});
    this.maxBindParams = limits.maxBindParams ?? 30_000;
    this.maxInListItems = limits.maxInListItems ?? MAX_BATCH_IDS;
  }

  protected execute(): Promise<RawResult> {
    return Promise.resolve({ rows: [], rowCount: 0 });
  }
  protected transaction<T>(fn: (session: Session) => Promise<T>): Promise<T> {
    return fn(undefined);
  }
  protected ph(index0: number): string {
    return `$${index0 + 1}`;
  }
  protected window(_page: PageWindow, _params: unknown[]): string {
    return '';
  }

  // Expose the protected mechanism the tests are about.
  chunk(ids: readonly string[]): string[][] {
    return this.chunkIds(ids);
  }
  overChunks<R>(ids: readonly string[], fn: (chunk: string[]) => Promise<R[]>): Promise<R[]> {
    return this.overIdChunks(ids, fn);
  }
  pattern(term: string): string {
    return this.likePattern(term);
  }
  plan(limit: number): { pageSize: number; maxScan: number } {
    return this.affinityPlan(limit);
  }
  bindChunks<T>(items: T[], perItem: number): T[][] {
    return this.chunkForBind(items, perItem);
  }
}

const ids = (count: number): string[] => Array.from({ length: count }, (_, i) => `id-${i}`);

describe('chunkIds', () => {
  it('keeps a batch inside the cap as one chunk, so a capped call is one statement', () => {
    const driver = new TestDriver();
    expect(driver.chunk(ids(MAX_BATCH_IDS))).toHaveLength(1);
  });

  it('splits past the engine IN-list limit rather than emitting an oversized statement', () => {
    // Oracle's real ceiling. 1001 ids in one `IN (...)` is ORA-01795.
    const driver = new TestDriver({ maxInListItems: 1000 });
    const chunks = driver.chunk(ids(1001));
    expect(chunks.map((c) => c.length)).toEqual([1000, 1]);
    expect(chunks.flat()).toHaveLength(1001);
  });

  it('honours the bind budget when it is tighter than the IN-list limit', () => {
    // Headroom is left for the binds a statement carries beside the list, so the chunk is under 100.
    const driver = new TestDriver({ maxBindParams: 100, maxInListItems: 1000 });
    const chunks = driver.chunk(ids(200));
    expect(chunks[0]!.length).toBeLessThan(100);
    expect(chunks.flat()).toHaveLength(200);
  });

  it('never produces an empty chunk, even with an absurd limit', () => {
    const driver = new TestDriver({ maxBindParams: 1, maxInListItems: 1 });
    const chunks = driver.chunk(ids(3));
    expect(chunks).toEqual([['id-0'], ['id-1'], ['id-2']]);
  });

  it('returns one empty chunk for no ids, so a caller loops zero statements', () => {
    expect(new TestDriver().chunk([])).toEqual([[]]);
  });
});

describe('overIdChunks', () => {
  it('runs one call for a single chunk — the guard costs a capped batch nothing', async () => {
    const driver = new TestDriver();
    const seen: number[] = [];
    const out = await driver.overChunks(ids(5), async (chunk) => {
      seen.push(chunk.length);
      return chunk;
    });
    expect(seen).toEqual([5]);
    expect(out).toHaveLength(5);
  });

  it('concatenates the results of every chunk, in order', async () => {
    const driver = new TestDriver({ maxInListItems: 2 });
    const out = await driver.overChunks(ids(5), async (chunk) =>
      chunk.map((id) => id.toUpperCase()),
    );
    expect(out).toEqual(['ID-0', 'ID-1', 'ID-2', 'ID-3', 'ID-4']);
  });
});

describe('chunkForBind', () => {
  it('sizes chunks by the parameters each item binds', () => {
    const driver = new TestDriver({ maxBindParams: 100 });
    // 30 params per row → 3 rows per statement.
    expect(driver.bindChunks(ids(7), 30).map((c) => c.length)).toEqual([3, 3, 1]);
  });
});

describe('likePattern', () => {
  it('wraps the term in wildcards and lower-cases it', () => {
    expect(new TestDriver().pattern('Emails')).toBe('%emails%');
  });

  it('escapes the wildcards a user typed, so `100%` searches for that text', () => {
    // Without this, `100%` matches every row — a search box that silently means "everything".
    expect(new TestDriver().pattern('100%')).toBe('%100!%%');
    expect(new TestDriver().pattern('a_b')).toBe('%a!_b%');
    expect(new TestDriver().pattern('!')).toBe('%!!%');
  });
});

describe('affinityPlan', () => {
  it('pages generously for a small batch, so one round trip is worth making', () => {
    const { pageSize, maxScan } = new TestDriver().plan(1);
    expect(pageSize).toBeGreaterThan(1);
    expect(maxScan).toBeGreaterThanOrEqual(pageSize);
  });

  it('caps the page and the total scan, so one tick cannot become a table sweep', () => {
    const big = new TestDriver().plan(10_000);
    expect(big.pageSize).toBeLessThanOrEqual(500);
    expect(big.maxScan).toBeLessThanOrEqual(500 * 20);
  });
});
