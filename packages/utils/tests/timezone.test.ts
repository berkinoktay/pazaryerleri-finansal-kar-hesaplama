import { describe, expect, it } from 'vitest';

import { getTodayInIstanbul, startOfDayInIstanbul } from '../src/timezone';

describe('getTodayInIstanbul', () => {
  it('returns a Date at 00:00:00.000 UTC representing today in Istanbul', () => {
    const result = getTodayInIstanbul();
    expect(result).toBeInstanceOf(Date);
    expect(result.getUTCHours()).toBe(0);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCSeconds()).toBe(0);
    expect(result.getUTCMilliseconds()).toBe(0);
  });
});

describe('startOfDayInIstanbul', () => {
  it('returns 00:00 UTC of the same Istanbul calendar day', () => {
    // 2026-05-27T20:30:00Z is 23:30 in Istanbul (GMT+3, no DST in May)
    const input = new Date('2026-05-27T20:30:00Z');
    const result = startOfDayInIstanbul(input);
    expect(result.toISOString()).toBe('2026-05-27T00:00:00.000Z');
  });

  it('crosses midnight correctly — 2026-05-27T22:00:00Z is 01:00 Istanbul next day', () => {
    // 22:00 UTC = 01:00 Istanbul on 2026-05-28
    const input = new Date('2026-05-27T22:00:00Z');
    const result = startOfDayInIstanbul(input);
    expect(result.toISOString()).toBe('2026-05-28T00:00:00.000Z');
  });

  it('handles March date stably (Turkey fixed GMT+3 since 2016, no DST shift)', () => {
    const input = new Date('2026-03-29T12:00:00Z');
    const result = startOfDayInIstanbul(input);
    expect(result.toISOString()).toBe('2026-03-29T00:00:00.000Z');
  });
});
