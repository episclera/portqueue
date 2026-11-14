/** `assertBatchIds` — the single cap every public id-taking method enforces before any SQL runs. */
import { MAX_BATCH_IDS } from '../constants';
import { InvalidOptionsError } from '../errors/errors';
import { assertBatchIds } from './batch-ids';

describe('assertBatchIds', () => {
  it('accepts an empty batch and one exactly at the cap', () => {
    expect(() => assertBatchIds([], 'cancelJobs({ jobIds })')).not.toThrow();
    const atCap = Array.from({ length: MAX_BATCH_IDS }, (_, i) => `id-${i}`);
    expect(() => assertBatchIds(atCap, 'cancelJobs({ jobIds })')).not.toThrow();
  });

  it('rejects one past the cap, naming the option and the limit', () => {
    const over = Array.from({ length: MAX_BATCH_IDS + 1 }, (_, i) => `id-${i}`);
    expect(() => assertBatchIds(over, 'cancelJobs({ jobIds })')).toThrow(InvalidOptionsError);
    expect(() => assertBatchIds(over, 'cancelJobs({ jobIds })')).toThrow(
      new RegExp(`cancelJobs\\(\\{ jobIds \\}\\).*${MAX_BATCH_IDS}`),
    );
  });
});
