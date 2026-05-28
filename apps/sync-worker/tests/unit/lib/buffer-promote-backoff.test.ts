import { describe, expect, it } from 'vitest';

import {
  isRetryDue,
  MAX_ATTEMPTS,
  RETRY_BACKOFF_MINUTES,
} from '../../../src/lib/buffer-promote-backoff';

describe('RETRY_BACKOFF_MINUTES', () => {
  it('matches spec: [5, 15, 45] minutes', () => {
    expect(RETRY_BACKOFF_MINUTES).toEqual([5, 15, 45]);
  });

  it('MAX_ATTEMPTS is 3', () => {
    expect(MAX_ATTEMPTS).toBe(3);
  });
});

describe('isRetryDue', () => {
  const now = new Date('2026-05-27T12:00:00Z');

  it('attempt 1, last fail >= 5 min ago → due', () => {
    expect(isRetryDue({ attempts: 1, lastFailedAt: new Date('2026-05-27T11:55:00Z'), now })).toBe(
      true,
    );
  });

  it('attempt 1, last fail < 5 min ago → not due', () => {
    expect(isRetryDue({ attempts: 1, lastFailedAt: new Date('2026-05-27T11:56:00Z'), now })).toBe(
      false,
    );
  });

  it('attempt 2, last fail >= 15 min ago → due', () => {
    expect(isRetryDue({ attempts: 2, lastFailedAt: new Date('2026-05-27T11:45:00Z'), now })).toBe(
      true,
    );
  });

  it('attempt 2, last fail < 15 min ago → not due', () => {
    expect(isRetryDue({ attempts: 2, lastFailedAt: new Date('2026-05-27T11:50:00Z'), now })).toBe(
      false,
    );
  });

  it('attempt 3, last fail >= 45 min ago → due', () => {
    expect(isRetryDue({ attempts: 3, lastFailedAt: new Date('2026-05-27T11:15:00Z'), now })).toBe(
      true,
    );
  });

  it('attempt >= MAX+1 (4) → never due (already permanent failed)', () => {
    expect(isRetryDue({ attempts: 4, lastFailedAt: new Date('2026-05-27T11:00:00Z'), now })).toBe(
      false,
    );
  });

  it('attempt 0 (never failed) → not due', () => {
    expect(isRetryDue({ attempts: 0, lastFailedAt: new Date('2026-05-27T11:00:00Z'), now })).toBe(
      false,
    );
  });
});
