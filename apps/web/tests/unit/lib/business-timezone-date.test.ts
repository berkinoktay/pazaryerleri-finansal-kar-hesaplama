import { describe, expect, it } from 'vitest';

import {
  businessZoneIsoToLocalWallClock,
  localWallClockAsBusinessZoneIso,
} from '@/lib/business-timezone-date';

describe('localWallClockAsBusinessZoneIso', () => {
  it('reinterprets the picker Date components as Istanbul wall clock (UTC+3)', () => {
    // A picker Date whose LOCAL components read 2026-07-21 08:00 must mean Istanbul
    // 08:00, i.e. the true instant 05:00Z. Building the input from component parts
    // (`new Date(y, m, d, h, min)`) proves the normalization is browser-tz-independent:
    // it reads the components, never the raw instant.
    const localWallClock = new Date(2026, 6, 21, 8, 0, 0, 0);
    expect(localWallClockAsBusinessZoneIso(localWallClock)).toBe('2026-07-21T05:00:00.000Z');
  });

  it('normalizes the end-of-window default (07:59) to the matching UTC instant', () => {
    const localWallClock = new Date(2026, 6, 28, 7, 59, 0, 0);
    expect(localWallClockAsBusinessZoneIso(localWallClock)).toBe('2026-07-28T04:59:00.000Z');
  });
});

describe('businessZoneIsoToLocalWallClock ↔ localWallClockAsBusinessZoneIso round-trip', () => {
  it('recovers the same local Y/M/D/H/M components a picker would display', () => {
    const original = new Date(2026, 6, 21, 8, 0, 0, 0);
    const iso = localWallClockAsBusinessZoneIso(original);
    const back = businessZoneIsoToLocalWallClock(iso);

    expect(back.getFullYear()).toBe(original.getFullYear());
    expect(back.getMonth()).toBe(original.getMonth());
    expect(back.getDate()).toBe(original.getDate());
    expect(back.getHours()).toBe(original.getHours());
    expect(back.getMinutes()).toBe(original.getMinutes());
  });

  it('formats a known UTC instant into Istanbul wall-clock components', () => {
    // 05:00Z is 08:00 in Istanbul — the picker must show hour 8 on the 21st.
    const local = businessZoneIsoToLocalWallClock('2026-07-21T05:00:00.000Z');
    expect(local.getFullYear()).toBe(2026);
    expect(local.getMonth()).toBe(6);
    expect(local.getDate()).toBe(21);
    expect(local.getHours()).toBe(8);
    expect(local.getMinutes()).toBe(0);
  });
});
