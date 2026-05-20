import { describe, expect, it } from 'vitest';

import * as orderSync from '../index';

describe('@pazarsync/order-sync — public API surface', () => {
  it('exports upsertOrderWithSnapshot as an async function', () => {
    expect(orderSync.upsertOrderWithSnapshot).toBeTypeOf('function');
    // sync function olmadığını doğrula: Promise döndürmeli (storeId param
    // boş geçersek tx kuracak ama hemen tip kontrolünden geçmesi yeterli).
    expect(orderSync.upsertOrderWithSnapshot.constructor.name).toBe('AsyncFunction');
  });

  it('exposes exactly the one public symbol (single responsibility guard)', () => {
    // Promotion'da paketin scope'unu küçük tutmak için tek bir public symbol.
    // Bu test ileride yanlışlıkla private helper'lar export edilirse fail eder.
    const keys = Object.keys(orderSync).sort();
    expect(keys).toEqual(['upsertOrderWithSnapshot']);
  });
});
