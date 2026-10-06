import { describe, expect, it } from 'vitest';
import { reconstructText } from '../src/lib/text';

const item = (str: string, x: number, y: number, width: number, hasEOL = false) => ({
  str,
  transform: [1, 0, 0, 1, x, y],
  width,
  height: 12,
  hasEOL,
});
describe('PDF text reconstruction', () => {
  it('keeps separately encoded Polish characters inside words', () => {
    expect(
      reconstructText([
        item('Zamawiaj', 0, 100, 50),
        item('ą', 50, 100, 6),
        item('cy', 56, 100, 12),
      ]),
    ).toBe('Zamawiający');
  });
  it('separates table columns and lines while preserving decimal amounts', () => {
    expect(
      reconstructText([
        item('Wdrożenie', 0, 100, 60),
        item('184 500,00 PLN', 100, 100, 90, true),
        item('netto', 0, 80, 30),
      ]),
    ).toBe('Wdrożenie 184 500,00 PLN\nnetto');
  });
});
