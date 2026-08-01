/**
 * `Wakeup` — the per-queue signal that wakes claim loops.
 *
 * Small enough to test exhaustively, and worth it: the unsubscribe path had a leak (an emptied set
 * left in the map, which `signalAll` then walked forever) and a resubscribe hazard that only shows up
 * with the exact ordering below.
 */
import { Wakeup } from './wakeup';

describe('Wakeup', () => {
  it('signals only the queue that was named', () => {
    const wakeup = new Wakeup();
    const emails: string[] = [];
    const reports: string[] = [];
    wakeup.subscribe('emails', () => emails.push('hit'));
    wakeup.subscribe('reports', () => reports.push('hit'));

    wakeup.signal('emails');

    expect(emails).toEqual(['hit']);
    expect(reports).toEqual([]);
  });

  it('signals every subscriber of one queue', () => {
    const wakeup = new Wakeup();
    const hits: string[] = [];
    wakeup.subscribe('emails', () => hits.push('a'));
    wakeup.subscribe('emails', () => hits.push('b'));

    wakeup.signal('emails');

    expect(hits).toEqual(['a', 'b']);
  });

  it('is a no-op for a queue nobody subscribed to', () => {
    expect(() => new Wakeup().signal('nobody')).not.toThrow();
  });

  it('signalAll wakes every queue', () => {
    const wakeup = new Wakeup();
    const hits: string[] = [];
    wakeup.subscribe('emails', () => hits.push('emails'));
    wakeup.subscribe('reports', () => hits.push('reports'));

    wakeup.signalAll();

    expect(hits.sort()).toEqual(['emails', 'reports']);
  });

  it('stops signalling an unsubscribed callback', () => {
    const wakeup = new Wakeup();
    const hits: string[] = [];
    const unsubscribe = wakeup.subscribe('emails', () => hits.push('hit'));

    unsubscribe();
    wakeup.signal('emails');

    expect(hits).toEqual([]);
  });

  it('forgets a queue once its last subscriber leaves, so signalAll stops walking it', () => {
    // The leak: an emptied set stayed in the map for the life of the process, and `signalAll`
    // iterated one dead entry per queue a process had ever declared and torn down.
    const wakeup = new Wakeup();
    const unsubscribe = wakeup.subscribe('emails', () => {});
    expect(wakeup.queueCount).toBe(1);

    unsubscribe();

    expect(wakeup.queueCount).toBe(0);
  });

  it('keeps a queue that was resubscribed before the old unsubscribe ran', () => {
    // The hazard the guard closes: unsubscribing after a resubscribe must not delete the *new*
    // subscriber's set and strand a live worker with a signal it never receives.
    const wakeup = new Wakeup();
    const first = wakeup.subscribe('emails', () => {});
    first();
    const hits: string[] = [];
    wakeup.subscribe('emails', () => hits.push('hit'));

    first(); // a stale unsubscribe, called twice
    wakeup.signal('emails');

    expect(hits).toEqual(['hit']);
  });
});
