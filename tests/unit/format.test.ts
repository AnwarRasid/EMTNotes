import { describe, it, expect } from 'vitest';
import { formatSavedAt } from '../../src/lib/format';

// Local dates, so the expectations hold in any time zone.
describe('formatSavedAt', () => {
  it('gives the day, short month and 24-hour time', () => {
    expect(formatSavedAt(new Date(2026, 10, 9, 22, 10).toISOString())).toBe('9 Nov, 22:10');
  });

  it('pads the time and keeps midnight as 00', () => {
    expect(formatSavedAt(new Date(2026, 0, 3, 0, 5).toISOString())).toBe('3 Jan, 00:05');
  });

  it('says "an unknown time" for a string that is not a date', () => {
    expect(formatSavedAt('not a date')).toBe('an unknown time');
  });
});
