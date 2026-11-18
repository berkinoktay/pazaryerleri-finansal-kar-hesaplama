// Every rule of the six workbook import forms answers a machine code, also for an input the
// web never sends: an import without a `file` part (or with a text where the file goes), an
// unknown discount type and an unknown value kind. The enum rules back the two config PATCH
// bodies too, so those are pinned here too.

import { z } from '@hono/zod-openapi';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { ImportAdvantageTariffFormSchema } from '@/validators/advantage-tariff.validator';
import { ImportTariffFormSchema } from '@/validators/commission-tariff.validator';
import {
  ImportDiscountListFormSchema,
  INVALID_DISCOUNT_TYPE,
  INVALID_VALUE_KIND,
  UpdateDiscountListBodySchema,
} from '@/validators/discount-list.validator';
import { ImportFlashProductsFormSchema } from '@/validators/flash-product.validator';
import {
  ImportMarketplaceCampaignFormSchema,
  UpdateMarketplaceCampaignBodySchema,
} from '@/validators/marketplace-campaign.validator';
import { ImportPlusTariffFormSchema } from '@/validators/plus-commission-tariff.validator';
import { FILE_REQUIRED } from '@/workbooks/form';

const FIELD_CODE_RE = /^[A-Z][A-Z0-9_]*$/;

interface FieldIssue {
  path: PropertyKey[];
  message: string;
}

/** The path and message of each issue of a parse; empty when it passes. */
function issuesOf(schema: z.ZodType, input: unknown): FieldIssue[] {
  const result = schema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
}

function workbookFile(): File {
  return new File([new Uint8Array([1, 2, 3])], 'list.xlsx');
}

const IMPORT_FORMS: ReadonlyArray<readonly [string, z.ZodType]> = [
  ['ImportTariffFormSchema', ImportTariffFormSchema],
  ['ImportPlusTariffFormSchema', ImportPlusTariffFormSchema],
  ['ImportAdvantageTariffFormSchema', ImportAdvantageTariffFormSchema],
  ['ImportFlashProductsFormSchema', ImportFlashProductsFormSchema],
  ['ImportDiscountListFormSchema', ImportDiscountListFormSchema],
  ['ImportMarketplaceCampaignFormSchema', ImportMarketplaceCampaignFormSchema],
];

describe('the shared workbook file field', () => {
  it('holds a machine code', () => {
    expect(FILE_REQUIRED).toBe('FILE_REQUIRED');
    expect(FILE_REQUIRED).toMatch(FIELD_CODE_RE);
  });

  it.each(IMPORT_FORMS)('%s: an import without a file answers FILE_REQUIRED', (_name, schema) => {
    expect(issuesOf(schema, { name: 'List' })).toContainEqual({
      path: ['file'],
      message: FILE_REQUIRED,
    });
  });

  it.each(IMPORT_FORMS)('%s: a text where the file goes answers FILE_REQUIRED', (_name, schema) => {
    expect(issuesOf(schema, { file: 'not-a-file', name: 'List' })).toContainEqual({
      path: ['file'],
      message: FILE_REQUIRED,
    });
  });

  it('keeps the File type of the parsed file', () => {
    expectTypeOf<z.infer<typeof ImportTariffFormSchema>['file']>().toEqualTypeOf<File>();
    expectTypeOf<z.infer<typeof ImportDiscountListFormSchema>['file']>().toEqualTypeOf<File>();
  });
});

// A valid NET config, the base each case below breaks in one field. The config rules only
// order the window bounds, so a fixed window never ages out.
const NET_CONFIG = {
  discountType: 'NET',
  valueKind: 'AMOUNT',
  value: '10',
  startsAt: '2026-07-21T05:00:00.000Z',
  endsAt: '2026-07-28T05:00:00.000Z',
};

const CONFIG_SCHEMAS: ReadonlyArray<readonly [string, z.ZodType, Record<string, unknown>]> = [
  ['ImportDiscountListFormSchema', ImportDiscountListFormSchema, { file: workbookFile() }],
  [
    'ImportMarketplaceCampaignFormSchema',
    ImportMarketplaceCampaignFormSchema,
    { file: workbookFile() },
  ],
  ['UpdateDiscountListBodySchema', UpdateDiscountListBodySchema, {}],
  ['UpdateMarketplaceCampaignBodySchema', UpdateMarketplaceCampaignBodySchema, {}],
];

describe('the discount and campaign config enums', () => {
  it('hold machine codes', () => {
    expect(INVALID_DISCOUNT_TYPE).toBe('INVALID_DISCOUNT_TYPE');
    expect(INVALID_VALUE_KIND).toBe('INVALID_VALUE_KIND');
    expect(INVALID_DISCOUNT_TYPE).toMatch(FIELD_CODE_RE);
    expect(INVALID_VALUE_KIND).toMatch(FIELD_CODE_RE);
  });

  it.each(CONFIG_SCHEMAS)('%s: the valid base config passes', (_name, schema, base) => {
    expect(issuesOf(schema, { ...base, ...NET_CONFIG })).toEqual([]);
  });

  it.each(CONFIG_SCHEMAS)(
    '%s: a missing discountType answers INVALID_DISCOUNT_TYPE',
    (_name, schema, base) => {
      const { discountType: _dropped, ...withoutType } = NET_CONFIG;

      expect(issuesOf(schema, { ...base, ...withoutType })).toContainEqual({
        path: ['discountType'],
        message: INVALID_DISCOUNT_TYPE,
      });
    },
  );

  it.each(CONFIG_SCHEMAS)(
    '%s: an unknown discountType answers INVALID_DISCOUNT_TYPE',
    (_name, schema, base) => {
      expect(issuesOf(schema, { ...base, ...NET_CONFIG, discountType: 'PCT' })).toContainEqual({
        path: ['discountType'],
        message: INVALID_DISCOUNT_TYPE,
      });
    },
  );

  it.each(CONFIG_SCHEMAS)(
    '%s: an unknown valueKind answers INVALID_VALUE_KIND',
    (_name, schema, base) => {
      expect(issuesOf(schema, { ...base, ...NET_CONFIG, valueKind: 'X' })).toContainEqual({
        path: ['valueKind'],
        message: INVALID_VALUE_KIND,
      });
    },
  );
});
