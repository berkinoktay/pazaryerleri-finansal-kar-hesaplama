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
    // Paketin scope'unu küçük tutmak için yalnız üç public runtime symbol: order
    // yazma (upsertOrderWithSnapshot), paylaşılan intake routing (intakeOrder,
    // Slice 0) ve maliyet-penceresi ölçütü (hadCostWithinOrderDay, Faz 3E — iki
    // dışlama yazıcısının ortak sorusu). OrderIntakeOutcome type-only export —
    // runtime'da görünmez. Bu test yanlışlıkla private helper export edilirse fail eder.
    const keys = Object.keys(orderSync).sort();
    expect(keys).toEqual(['hadCostWithinOrderDay', 'intakeOrder', 'upsertOrderWithSnapshot']);
  });
});
