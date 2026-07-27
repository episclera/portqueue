/**
 * @jest-environment node
 *
 * The thresholds are the whole point of this module being shared: the table and the detail page
 * must agree on when a reading is worth an operator's attention, and both metrics are now 0-100
 * shares of a ceiling the process cannot pass, so one pair of numbers covers both.
 */
import { METRIC_THRESHOLDS, formatPercent, metricTone } from './metrics';

describe('metricTone', () => {
  it('leaves a comfortable reading untoned', () => {
    expect(metricTone(0)).toBe('normal');
    expect(metricTone(74.9)).toBe('normal');
  });

  it('warns from 75 and turns dangerous from 85, boundaries included', () => {
    expect(metricTone(METRIC_THRESHOLDS.warn)).toBe('warn');
    expect(metricTone(84.9)).toBe('warn');
    expect(metricTone(METRIC_THRESHOLDS.danger)).toBe('danger');
    expect(metricTone(100)).toBe('danger');
  });

  it('treats "no heartbeat yet" as normal rather than alarming', () => {
    expect(metricTone(null)).toBe('normal');
  });
});

describe('formatPercent', () => {
  it('renders one decimal, and a dash before the first heartbeat', () => {
    expect(formatPercent(12.34)).toBe('12.3%');
    expect(formatPercent(null)).toBe('—');
  });
});
