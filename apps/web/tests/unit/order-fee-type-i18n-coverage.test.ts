// OrderFeeType i18n coverage guard (#300).
//
// The order-detail fee timeline localizes every fee row from
// `orderDetail.fees.types.<OrderFeeType>`. The COST_RETURN labels were
// hand-added during the 2026-06-11 audit — a future enum value could
// silently ship without labels and surface as a raw enum string in the
// UI. This test iterates Object.values(OrderFeeType) against BOTH
// locale files (registry-coverage.test.ts pattern: enum-driven, so a
// new enum member fails CI until its labels exist).

import { describe, expect, it } from 'vitest';

import { OrderFeeType } from '@pazarsync/db/enums';

import en from '../../messages/en.json';
import tr from '../../messages/tr.json';

const LOCALES = [
  { locale: 'tr', types: tr.orderDetail.fees.types },
  { locale: 'en', types: en.orderDetail.fees.types },
] as const;

describe('OrderFeeType i18n coverage', () => {
  it.each(LOCALES)('$locale has a label for every OrderFeeType enum value', ({ types }) => {
    for (const feeType of Object.values(OrderFeeType)) {
      const label: unknown = types[feeType];
      expect(label, `Missing orderDetail.fees.types.${feeType} label`).toBeTypeOf('string');
      expect(label, `Empty orderDetail.fees.types.${feeType} label`).not.toBe('');
    }
  });

  it('carries no orphan keys outside the enum domain', () => {
    for (const { locale, types } of LOCALES) {
      for (const key of Object.keys(types)) {
        expect(
          Object.values(OrderFeeType),
          `${locale}: orderDetail.fees.types.${key} has no matching OrderFeeType enum value`,
        ).toContain(key);
      }
    }
  });
});
