// ProfitExclusionReason i18n coverage guard (plan PR-2c).
//
// The excluded-orders tab and the order-detail banner localize every
// exclusion reason from `exclusionReasons.<ProfitExclusionReason>.label`
// and `.detail`. A new enum value (PR-2c added the two desi reasons) could
// silently ship without copy and surface as a raw enum string in the UI.
// This test iterates Object.values(ProfitExclusionReason) against BOTH
// locale files (order-fee-type-i18n-coverage.test.ts pattern: enum-driven,
// so a new enum member fails CI until its copy exists).

import { describe, expect, it } from 'vitest';

import { ProfitExclusionReason } from '@pazarsync/db/enums';

import en from '../../messages/en.json';
import tr from '../../messages/tr.json';

const LOCALES = [
  { locale: 'tr', reasons: tr.exclusionReasons },
  { locale: 'en', reasons: en.exclusionReasons },
] as const;

const FIELDS = ['label', 'detail'] as const;

// Read `reasons[reason][field]` as unknown without a type assertion, so a
// missing reason or field yields undefined instead of a compile-time pass.
function readCopy(reasons: object, reason: string, field: string): unknown {
  const entry: unknown = Object.entries(reasons).find(([key]) => key === reason)?.[1];
  if (typeof entry !== 'object' || entry === null) return undefined;
  return Object.entries(entry).find(([key]) => key === field)?.[1];
}

describe('ProfitExclusionReason i18n coverage', () => {
  it.each(LOCALES)(
    '$locale has a label and a detail for every ProfitExclusionReason enum value',
    ({ reasons }) => {
      for (const reason of Object.values(ProfitExclusionReason)) {
        for (const field of FIELDS) {
          const copy = readCopy(reasons, reason, field);
          expect(copy, `Missing exclusionReasons.${reason}.${field}`).toBeTypeOf('string');
          expect(copy, `Empty exclusionReasons.${reason}.${field}`).not.toBe('');
        }
      }
    },
  );

  it('carries no orphan keys outside the enum domain', () => {
    for (const { locale, reasons } of LOCALES) {
      for (const key of Object.keys(reasons)) {
        expect(
          Object.values(ProfitExclusionReason),
          `${locale}: exclusionReasons.${key} has no matching ProfitExclusionReason enum value`,
        ).toContain(key);
      }
    }
  });
});
