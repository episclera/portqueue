import { toMs } from './duration.js';
import { InvalidOptionsError } from '../errors/errors.js';

describe('toMs', () => {
  it('passes through numbers', () => {
    expect(toMs(1500)).toBe(1500);
  });
  it('parses duration strings', () => {
    expect(toMs('500ms')).toBe(500);
    expect(toMs('30s')).toBe(30_000);
    expect(toMs('5m')).toBe(300_000);
    expect(toMs('2h')).toBe(7_200_000);
    expect(toMs('1d')).toBe(86_400_000);
  });
  it('throws on garbage', () => {
    expect(() => toMs('soon')).toThrow(InvalidOptionsError);
    expect(() => toMs(-5)).toThrow(InvalidOptionsError);
  });
});
