import { describe, expect, it } from 'vitest';

import * as orderSync from '../index';

describe('@pazarsync/order-sync — public API surface', () => {
  it('exports upsertOrderWithSnapshot as an async function', () => {
    expect(orderSync.upsertOrderWithSnapshot).toBeTypeOf('function');
    // sync function olmadığını doğrula: Promise döndürmeli (storeId param
    // boş geçersek tx kuracak ama hemen tip kontrolünden geçmesi yeterli).
    expect(orderSync.upsertOrderWithSnapshot.constructor.name).toBe('AsyncFunction');
  });

  it('exposes exactly the intake + write + cost-window helpers (public API guard)', () => {
    // The package keeps a small runtime surface of four symbols: the order writer
    // (upsertOrderWithSnapshot), the shared intake routing (intakeOrder), the
    // cost-window criterion both exclusion writers ask (hadCostWithinOrderDay),
    // and the operator backfill that stamps existing orders by the same criterion
    // (stampCostWindowExclusions). OrderIntakeOutcome is a type-only export and is
    // invisible at runtime. This test fails if a private helper gets exported by accident.
    const keys = Object.keys(orderSync).sort();
    expect(keys).toEqual([
      'hadCostWithinOrderDay',
      'intakeOrder',
      'stampCostWindowExclusions',
      'upsertOrderWithSnapshot',
    ]);
  });
});
