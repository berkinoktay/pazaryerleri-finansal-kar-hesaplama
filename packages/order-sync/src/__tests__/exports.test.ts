import { describe, expect, it } from 'vitest';

import * as orderSync from '../index';

describe('@pazarsync/order-sync — public API surface', () => {
  it('exports upsertOrderWithSnapshot as an async function', () => {
    expect(orderSync.upsertOrderWithSnapshot).toBeTypeOf('function');
    // sync function olmadığını doğrula: Promise döndürmeli (storeId param
    // boş geçersek tx kuracak ama hemen tip kontrolünden geçmesi yeterli).
    expect(orderSync.upsertOrderWithSnapshot.constructor.name).toBe('AsyncFunction');
  });

  it('exposes exactly the intake + write helpers (public API guard)', () => {
    // Paketin scope'unu küçük tutmak için yalnız iki public runtime symbol:
    // order yazma (upsertOrderWithSnapshot) + paylaşılan intake routing
    // (intakeOrder, Slice 0). OrderIntakeOutcome type-only export — runtime'da
    // görünmez. Bu test ileride yanlışlıkla private helper export edilirse fail eder.
    const keys = Object.keys(orderSync).sort();
    expect(keys).toEqual(['intakeOrder', 'upsertOrderWithSnapshot']);
  });
});
