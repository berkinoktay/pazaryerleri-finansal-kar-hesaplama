import { describe, expect, it } from 'vitest';

import * as orderSync from '../index';

describe('@pazarsync/order-sync — public API surface', () => {
  it('exports upsertOrderWithSnapshot as an async function', () => {
    expect(orderSync.upsertOrderWithSnapshot).toBeTypeOf('function');
    // sync function olmadığını doğrula: Promise döndürmeli (storeId param
    // boş geçersek tx kuracak ama hemen tip kontrolünden geçmesi yeterli).
    expect(orderSync.upsertOrderWithSnapshot.constructor.name).toBe('AsyncFunction');
  });

  it('exposes exactly the intake + write + cost-window + day-close helpers (public API guard)', () => {
    // The package keeps a small runtime surface of five symbols: the order writer
    // (upsertOrderWithSnapshot), the shared intake routing (intakeOrder), the
    // cost-window criterion both exclusion writers ask (hadCostWithinOrderDay),
    // the operator backfill that stamps existing orders by the same criterion
    // (stampCostWindowExclusions), and the day-close finaliser of one order
    // (finalizeOrderSellerInputs). OrderIntakeOutcome and FinalizeOutcome are type-only
    // exports and are invisible at runtime. This test fails if a private helper gets
    // exported by accident.
    const keys = Object.keys(orderSync).sort();
    expect(keys).toEqual([
      'finalizeOrderSellerInputs',
      'hadCostWithinOrderDay',
      'intakeOrder',
      'stampCostWindowExclusions',
      'upsertOrderWithSnapshot',
    ]);
  });
});
