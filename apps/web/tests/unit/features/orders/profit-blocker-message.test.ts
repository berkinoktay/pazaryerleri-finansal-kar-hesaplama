// Profit blocker -> next-intl reason key resolver (plan PR-3a, Task 6).
//
// The API names WHY an order's profit is not computable (`profitBlockers`); the
// web only picks the sentence for each { code, detail } pair. Every path of the
// resolver is pinned here, and every key it can return is checked against BOTH
// locale files so a blocker never renders as a raw key.

import { describe, expect, it } from 'vitest';

import { ProfitIssueCode } from '@pazarsync/db/enums';

import {
  profitBlockerMessage,
  type ProfitBlocker,
  type ProfitBlockerMessage,
} from '@/features/orders/lib/profit-blocker-message';

import en from '../../../../messages/en.json';
import tr from '../../../../messages/tr.json';

const UNKNOWN_CARRIER = 'unknown-carrier-label';

function blocker(code: ProfitBlocker['code'], detail: string | null = null): ProfitBlocker {
  return { code, detail };
}

function resolve(code: ProfitBlocker['code'], detail: string | null = null): ProfitBlockerMessage {
  const message = profitBlockerMessage(blocker(code, detail), UNKNOWN_CARRIER);
  if (message === null) {
    throw new Error(`Expected a reason message for ${code} / ${String(detail)}`);
  }
  return message;
}

// Walk a dotted key through a message tree without a type assertion; a missing
// segment yields undefined instead of a compile-time pass.
function readPath(tree: unknown, dottedKey: string): unknown {
  let node: unknown = tree;
  for (const segment of dottedKey.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = Object.entries(node).find(([key]) => key === segment)?.[1];
  }
  return node;
}

describe('profitBlockerMessage', () => {
  describe('CARRIER_NOT_RECOGNIZED', () => {
    it('names the carrier the marketplace reported', () => {
      expect(resolve('CARRIER_NOT_RECOGNIZED', 'Alternative Delivery')).toEqual({
        key: 'reasons.CARRIER_NOT_RECOGNIZED',
        values: { providerName: 'Alternative Delivery' },
      });
    });

    it('falls back to the unknown carrier label without a detail', () => {
      expect(resolve('CARRIER_NOT_RECOGNIZED')).toEqual({
        key: 'reasons.CARRIER_NOT_RECOGNIZED',
        values: { providerName: UNKNOWN_CARRIER },
      });
    });

    it('falls back to the unknown carrier label for a blank detail', () => {
      expect(resolve('CARRIER_NOT_RECOGNIZED', '  ').values).toEqual({
        providerName: UNKNOWN_CARRIER,
      });
    });
  });

  describe('SHIPPING_ESTIMATE_UNAVAILABLE', () => {
    it.each([
      'NO_TARIFF_VERSION',
      'DESI_OVERFLOW',
      'UNKNOWN_DESI',
      'NO_CARRIER',
      'OWN_CONTRACT_EMPTY',
    ] as const)('uses the dedicated sentence for %s', (detail) => {
      expect(resolve('SHIPPING_ESTIMATE_UNAVAILABLE', detail)).toEqual({
        key: `reasons.SHIPPING_ESTIMATE_UNAVAILABLE.${detail}`,
      });
    });

    it.each(['RETURN_UNKNOWN_DESI', 'RETURN_DESI_OVERFLOW', 'RETURN_NO_TARIFF_VERSION'])(
      'uses the return sentence for the return leg detail %s',
      (detail) => {
        expect(resolve('SHIPPING_ESTIMATE_UNAVAILABLE', detail)).toEqual({
          key: 'reasons.SHIPPING_ESTIMATE_UNAVAILABLE.RETURN',
        });
      },
    );

    it.each([null, 'SOMETHING_NEW'])('falls back to the generic sentence for %s', (detail) => {
      expect(resolve('SHIPPING_ESTIMATE_UNAVAILABLE', detail)).toEqual({
        key: 'reasons.SHIPPING_ESTIMATE_UNAVAILABLE.other',
      });
    });
  });

  describe('REFERENCE_DATA_MISSING', () => {
    it('uses the export return tier sentence for EXPORT_RETURN_TIER', () => {
      expect(resolve('REFERENCE_DATA_MISSING', 'EXPORT_RETURN_TIER')).toEqual({
        key: 'reasons.REFERENCE_DATA_MISSING.EXPORT_RETURN_TIER',
      });
    });

    it.each(['FEE:PLATFORM_SERVICE', null])(
      'falls back to the generic fee sentence for %s',
      (detail) => {
        expect(resolve('REFERENCE_DATA_MISSING', detail)).toEqual({
          key: 'reasons.REFERENCE_DATA_MISSING.other',
        });
      },
    );
  });

  it('uses its own sentence for MISSING_COMMISSION_RATE', () => {
    expect(resolve('MISSING_COMMISSION_RATE', 'item-1')).toEqual({
      key: 'reasons.MISSING_COMMISSION_RATE',
    });
  });

  it('uses its own sentence for MISSING_COST', () => {
    expect(resolve('MISSING_COST', 'item-1')).toEqual({ key: 'reasons.MISSING_COST' });
  });

  it.each([
    'UNMAPPED_MARKETPLACE_RECORD',
    'AMBIGUOUS_RECORD_MATCH',
    'SELLER_CARGO_AGREEMENT_ESTIMATE',
  ] as const)('has no reason sentence for the non-blocking code %s', (code) => {
    expect(profitBlockerMessage(blocker(code, 'x'), UNKNOWN_CARRIER)).toBeNull();
  });

  describe('i18n coverage', () => {
    // Every detail the engine writes today plus a null and an unknown one, so each
    // branch of every code is exercised against both catalogs.
    const DETAILS = [
      null,
      'NO_TARIFF_VERSION',
      'DESI_OVERFLOW',
      'UNKNOWN_DESI',
      'NO_CARRIER',
      'OWN_CONTRACT_EMPTY',
      'RETURN_UNKNOWN_DESI',
      'EXPORT_RETURN_TIER',
      'FEE:PLATFORM_SERVICE',
      'SOMETHING_NEW',
    ];

    it.each([
      { locale: 'tr', messages: tr.profitBlockers },
      { locale: 'en', messages: en.profitBlockers },
    ])('$locale has copy for every key the resolver returns', ({ messages }) => {
      for (const code of Object.values(ProfitIssueCode)) {
        for (const detail of DETAILS) {
          const message = profitBlockerMessage(blocker(code, detail), UNKNOWN_CARRIER);
          if (message === null) continue;
          const copy = readPath(messages, message.key);
          expect(copy, `Missing profitBlockers.${message.key}`).toBeTypeOf('string');
          expect(copy, `Empty profitBlockers.${message.key}`).not.toBe('');
        }
      }
    });

    it.each([
      { locale: 'tr', messages: tr.profitBlockers },
      { locale: 'en', messages: en.profitBlockers },
    ])('$locale has the badge, title and unknown carrier copy', ({ messages }) => {
      for (const key of ['badge', 'title', 'unknownCarrier']) {
        expect(readPath(messages, key), `Missing profitBlockers.${key}`).toBeTypeOf('string');
      }
    });
  });
});
