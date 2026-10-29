// Pure unit test for the PRODUCTS_CHANGES window math. No DB: the anchors
// (startedAt of the last COMPLETED runs) are plain arguments, so every case
// builds its timestamps from one injected run start. The functions never read
// the wall clock, so a fixed run start cannot rot into a time bomb; the last
// case of the window suite proves that with a fake system time.

import { PRODUCTS_CHANGES_PHASES } from '@pazarsync/sync-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  computeProductsChangesQueryRange,
  computeProductsChangesWindow,
} from '../../../src/handlers/products-changes-window';

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

// Mirrors the handler constants on purpose (not imported), so these tests pin
// the durations themselves and not only the formula.
const SAFETY_MARGIN_MS = 15 * MS_PER_MINUTE;
const MAX_LOOKBACK_MS = 48 * MS_PER_HOUR;
const END_ALLOWANCE_MS = 3 * MS_PER_HOUR;
const CREATED_LOOKBACK_MS = 7 * MS_PER_DAY;

// The run's startedAt, injected. It becomes windowEnd.
const RUN_STARTED_AT_MS = Date.UTC(2026, 9, 29, 9, 45, 0);

describe('computeProductsChangesWindow', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when the store has no COMPLETED changes run and no COMPLETED full scan', () => {
    const window = computeProductsChangesWindow({
      runStartedAtMs: RUN_STARTED_AT_MS,
      lastChangesRunStartedAtMs: null,
      lastFullScanStartedAtMs: null,
    });

    expect(window).toBeNull();
  });

  it('first run: anchors on the last full scan startedAt minus the 15 min margin', () => {
    const fullScanStartedAtMs = RUN_STARTED_AT_MS - 3 * MS_PER_HOUR;

    const window = computeProductsChangesWindow({
      runStartedAtMs: RUN_STARTED_AT_MS,
      lastChangesRunStartedAtMs: null,
      lastFullScanStartedAtMs: fullScanStartedAtMs,
    });

    expect(window).toEqual({
      windowStart: fullScanStartedAtMs - SAFETY_MARGIN_MS,
      windowEnd: RUN_STARTED_AT_MS,
    });
  });

  it('later run: the last changes run wins over an older full scan', () => {
    const changesStartedAtMs = RUN_STARTED_AT_MS - MS_PER_HOUR;

    const window = computeProductsChangesWindow({
      runStartedAtMs: RUN_STARTED_AT_MS,
      lastChangesRunStartedAtMs: changesStartedAtMs,
      lastFullScanStartedAtMs: RUN_STARTED_AT_MS - 20 * MS_PER_HOUR,
    });

    expect(window).toEqual({
      windowStart: changesStartedAtMs - SAFETY_MARGIN_MS,
      windowEnd: RUN_STARTED_AT_MS,
    });
  });

  it('later run: the last changes run wins over a NEWER full scan (fallback, not max)', () => {
    // A COMPLETED full scan may have skipped pages or stopped at the 10k cap,
    // so its startedAt does not prove every change was seen. It must never
    // move the changes anchor forward.
    const changesStartedAtMs = RUN_STARTED_AT_MS - MS_PER_HOUR;

    const window = computeProductsChangesWindow({
      runStartedAtMs: RUN_STARTED_AT_MS,
      lastChangesRunStartedAtMs: changesStartedAtMs,
      lastFullScanStartedAtMs: RUN_STARTED_AT_MS - 10 * MS_PER_MINUTE,
    });

    expect(window).toEqual({
      windowStart: changesStartedAtMs - SAFETY_MARGIN_MS,
      windowEnd: RUN_STARTED_AT_MS,
    });
  });

  it('a changes run anchors the window even when no COMPLETED full scan is found', () => {
    const changesStartedAtMs = RUN_STARTED_AT_MS - MS_PER_HOUR;

    const window = computeProductsChangesWindow({
      runStartedAtMs: RUN_STARTED_AT_MS,
      lastChangesRunStartedAtMs: changesStartedAtMs,
      lastFullScanStartedAtMs: null,
    });

    expect(window).toEqual({
      windowStart: changesStartedAtMs - SAFETY_MARGIN_MS,
      windowEnd: RUN_STARTED_AT_MS,
    });
  });

  it('caps an anchor older than 48 h at windowEnd minus 48 h', () => {
    const window = computeProductsChangesWindow({
      runStartedAtMs: RUN_STARTED_AT_MS,
      lastChangesRunStartedAtMs: RUN_STARTED_AT_MS - 72 * MS_PER_HOUR,
      lastFullScanStartedAtMs: RUN_STARTED_AT_MS - 96 * MS_PER_HOUR,
    });

    expect(window).toEqual({
      windowStart: RUN_STARTED_AT_MS - MAX_LOOKBACK_MS,
      windowEnd: RUN_STARTED_AT_MS,
    });
  });

  it('exact 48 h boundary: anchor minus margin equal to the cap gives the cap', () => {
    const window = computeProductsChangesWindow({
      runStartedAtMs: RUN_STARTED_AT_MS,
      lastChangesRunStartedAtMs: RUN_STARTED_AT_MS - MAX_LOOKBACK_MS + SAFETY_MARGIN_MS,
      lastFullScanStartedAtMs: null,
    });

    expect(window).toEqual({
      windowStart: RUN_STARTED_AT_MS - MAX_LOOKBACK_MS,
      windowEnd: RUN_STARTED_AT_MS,
    });
  });

  it('just inside the 48 h cap: the anchor wins by 1 ms', () => {
    const window = computeProductsChangesWindow({
      runStartedAtMs: RUN_STARTED_AT_MS,
      lastChangesRunStartedAtMs: RUN_STARTED_AT_MS - MAX_LOOKBACK_MS + SAFETY_MARGIN_MS + 1,
      lastFullScanStartedAtMs: null,
    });

    expect(window).toEqual({
      windowStart: RUN_STARTED_AT_MS - MAX_LOOKBACK_MS + 1,
      windowEnd: RUN_STARTED_AT_MS,
    });
  });

  it('anchor equal to the run start still gives a 15 min window', () => {
    const window = computeProductsChangesWindow({
      runStartedAtMs: RUN_STARTED_AT_MS,
      lastChangesRunStartedAtMs: RUN_STARTED_AT_MS,
      lastFullScanStartedAtMs: null,
    });

    expect(window).toEqual({
      windowStart: RUN_STARTED_AT_MS - SAFETY_MARGIN_MS,
      windowEnd: RUN_STARTED_AT_MS,
    });
  });

  it('anchor at windowEnd + 15 min gives no window (start would equal end)', () => {
    const window = computeProductsChangesWindow({
      runStartedAtMs: RUN_STARTED_AT_MS,
      lastChangesRunStartedAtMs: RUN_STARTED_AT_MS + SAFETY_MARGIN_MS,
      lastFullScanStartedAtMs: null,
    });

    expect(window).toBeNull();
  });

  it('anchor at windowEnd + 15 min - 1 ms gives a 1 ms window', () => {
    const window = computeProductsChangesWindow({
      runStartedAtMs: RUN_STARTED_AT_MS,
      lastChangesRunStartedAtMs: RUN_STARTED_AT_MS + SAFETY_MARGIN_MS - 1,
      lastFullScanStartedAtMs: null,
    });

    expect(window).toEqual({
      windowStart: RUN_STARTED_AT_MS - 1,
      windowEnd: RUN_STARTED_AT_MS,
    });
  });

  it('a full-scan anchor far after the run start gives no window', () => {
    // A retried first run whose fallback full scan started after this run's
    // startedAt: the start lands past the end, so the run finishes empty.
    const window = computeProductsChangesWindow({
      runStartedAtMs: RUN_STARTED_AT_MS,
      lastChangesRunStartedAtMs: null,
      lastFullScanStartedAtMs: RUN_STARTED_AT_MS + 2 * MS_PER_HOUR,
    });

    expect(window).toBeNull();
  });

  it('windowEnd is the run start, never the wall clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(RUN_STARTED_AT_MS + 5 * MS_PER_DAY);

    const window = computeProductsChangesWindow({
      runStartedAtMs: RUN_STARTED_AT_MS,
      lastChangesRunStartedAtMs: RUN_STARTED_AT_MS - MS_PER_HOUR,
      lastFullScanStartedAtMs: null,
    });

    expect(window).toEqual({
      windowStart: RUN_STARTED_AT_MS - MS_PER_HOUR - SAFETY_MARGIN_MS,
      windowEnd: RUN_STARTED_AT_MS,
    });
  });
});

describe('computeProductsChangesQueryRange', () => {
  const windowStart = RUN_STARTED_AT_MS - MS_PER_HOUR - SAFETY_MARGIN_MS;
  const windowEnd = RUN_STARTED_AT_MS;

  it.each(['VARIANT_MODIFIED_DATE', 'CONTENT_MODIFIED_DATE'] as const)(
    '%s queries [windowStart, windowEnd + 3 h]',
    (phase) => {
      const range = computeProductsChangesQueryRange({ phase, windowStart, windowEnd });

      expect(range).toEqual({
        startDate: windowStart,
        endDate: windowEnd + END_ALLOWANCE_MS,
      });
    },
  );

  it('VARIANT_CREATED_DATE queries [windowEnd - 7 days, windowEnd + 3 h]', () => {
    const range = computeProductsChangesQueryRange({
      phase: 'VARIANT_CREATED_DATE',
      windowStart,
      windowEnd,
    });

    expect(range).toEqual({
      startDate: windowEnd - CREATED_LOOKBACK_MS,
      endDate: windowEnd + END_ALLOWANCE_MS,
    });
  });

  it('VARIANT_CREATED_DATE ignores windowStart (a capped 48 h window gives the same range)', () => {
    const narrow = computeProductsChangesQueryRange({
      phase: 'VARIANT_CREATED_DATE',
      windowStart: windowEnd - 1,
      windowEnd,
    });
    const capped = computeProductsChangesQueryRange({
      phase: 'VARIANT_CREATED_DATE',
      windowStart: windowEnd - MAX_LOOKBACK_MS,
      windowEnd,
    });

    expect(narrow).toEqual(capped);
  });

  it.each(PRODUCTS_CHANGES_PHASES)(
    '%s gives a forward, non-negative range that covers the whole window',
    (phase) => {
      const range = computeProductsChangesQueryRange({ phase, windowStart, windowEnd });

      expect(range.startDate).toBeGreaterThanOrEqual(0);
      expect(range.startDate).toBeLessThanOrEqual(windowStart);
      expect(range.endDate).toBeGreaterThan(windowEnd);
    },
  );
});
