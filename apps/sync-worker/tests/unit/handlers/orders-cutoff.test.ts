import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computeDeltaCutoffMs } from '../../../src/handlers/orders';

// Pure function — no DB. `storeCreatedAt` and `lastCompletedAtMs` are plain
// arguments, so these cases construct dates directly instead of seeding a store.
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
// Mirrors ORDERS_DELTA_OVERLAP_MS in the handler — the last completed run's
// final hour is re-swept to absorb edge races.
const DELTA_OVERLAP_MS = MS_PER_HOUR;
const ORIGINAL_ENV = process.env;

describe('computeDeltaCutoffMs — self-healing delta window', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, SYNC_SAFETY_NET_HOURS: '8' };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('(a) last completed 48h ago → cutoff walks back to lastCompleted − overlap (outage healed)', () => {
    const endDate = Date.now();
    const oldCreatedAt = new Date(endDate - 90 * MS_PER_DAY);
    const lastCompletedAtMs = endDate - 48 * MS_PER_HOUR;

    const cutoff = computeDeltaCutoffMs({
      storeCreatedAt: oldCreatedAt,
      endDate,
      lastCompletedAtMs,
    });

    // 48h > 8h safety net → the last-completed anchor (minus 1h overlap) wins,
    // so the tick after a long outage sweeps the whole gap, not just 8h.
    expect(cutoff).toBe(lastCompletedAtMs - DELTA_OVERLAP_MS);
  });

  it('(b) last completed 10min ago → cutoff floored at endDate − SAFETY_NET_HOURS', () => {
    const endDate = Date.now();
    const oldCreatedAt = new Date(endDate - 90 * MS_PER_DAY);
    const lastCompletedAtMs = endDate - 10 * 60 * 1000; // 10 minutes ago

    const cutoff = computeDeltaCutoffMs({
      storeCreatedAt: oldCreatedAt,
      endDate,
      lastCompletedAtMs,
    });

    // lastCompleted − 1h overlap (≈ now − 70min) is NEWER than the 8h floor,
    // so the safety-net floor still wins — the window never shrinks below it.
    expect(cutoff).toBe(endDate - 8 * MS_PER_HOUR);
  });

  it('(c) both anchors older than store.createdAt → clamped to store.createdAt', () => {
    const endDate = Date.now();
    const recentCreatedAt = new Date(endDate - 2 * MS_PER_HOUR); // 2h < 8h floor
    const lastCompletedAtMs = endDate - 48 * MS_PER_HOUR;

    const cutoff = computeDeltaCutoffMs({
      storeCreatedAt: recentCreatedAt,
      endDate,
      lastCompletedAtMs,
    });

    // Store connected 2h ago → both the safety-net floor (8h) and the
    // last-completed anchor (48h) precede store connection → clamp wins.
    expect(cutoff).toBe(recentCreatedAt.getTime());
  });

  it('(d) lastCompletedAtMs null → legacy behavior (safety-net floor clamped by store.createdAt)', () => {
    const endDate = Date.now();
    const oldCreatedAt = new Date(endDate - 90 * MS_PER_DAY);

    const cutoff = computeDeltaCutoffMs({
      storeCreatedAt: oldCreatedAt,
      endDate,
      lastCompletedAtMs: null,
    });

    // Defensive fallback (COMPLETED row with a null completedAt): plain trailing
    // safety-net window, exactly the pre-change behavior.
    expect(cutoff).toBe(endDate - 8 * MS_PER_HOUR);
  });

  it('(d) lastCompletedAtMs null + recent store → clamped to store.createdAt (legacy clamp)', () => {
    const endDate = Date.now();
    const recentCreatedAt = new Date(endDate - 2 * MS_PER_HOUR); // 2h < 8h

    const cutoff = computeDeltaCutoffMs({
      storeCreatedAt: recentCreatedAt,
      endDate,
      lastCompletedAtMs: null,
    });

    expect(cutoff).toBe(recentCreatedAt.getTime());
  });

  it('(e) lastCompletedAtMs in the future (clock skew) → plain safety-net floor', () => {
    const endDate = Date.now();
    const oldCreatedAt = new Date(endDate - 90 * MS_PER_DAY);
    // A COMPLETED row stamped AHEAD of endDate (worker/DB clock skew). The
    // last-completed anchor (future − 1h overlap) is newer than the 8h floor,
    // so min() picks the floor and the window never inverts — the safety-net
    // floor (endDate − 8h) is returned unchanged.
    const lastCompletedAtMs = endDate + 2 * MS_PER_HOUR;

    const cutoff = computeDeltaCutoffMs({
      storeCreatedAt: oldCreatedAt,
      endDate,
      lastCompletedAtMs,
    });

    expect(cutoff).toBe(endDate - 8 * MS_PER_HOUR);
  });
});
