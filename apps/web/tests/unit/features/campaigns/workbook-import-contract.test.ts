import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { WORKBOOK_PAGES, type WorkbookPage } from '@pazarsync/utils';

import { WORKBOOK_VERTICALS } from '@/features/campaigns/lib/workbook-verticals';

import { emittedImportFields } from '../../../helpers/workbook-import-fields';

/*
 * The upload dialog builds its multipart body by hand (`toFormData`), and the generated
 * client type only checks a dummy body, so the compiler never compares the field names the
 * web sends with the ones the API reads. The API drops a key it does not know, so a rename
 * on one side would silently lose that field (a pinned commission source becomes the
 * category commission, a funding rate becomes 0 %). This test reads the API's own spec and
 * checks every name the web can emit against each page's import body.
 */

// From apps/web/tests/unit/features/campaigns up to the repository root.
const SPEC_URL = new URL('../../../../../../packages/api-client/openapi.json', import.meta.url);

/** The import route of each page, written out: a seventh page is a compile error here. */
const IMPORT_PATHS: Readonly<Record<WorkbookPage, string>> = {
  COMMISSION_TARIFF: '/v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/import',
  PLUS_COMMISSION_TARIFF:
    '/v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/import',
  ADVANTAGE_TARIFF: '/v1/organizations/{orgId}/stores/{storeId}/advantage-tariffs/import',
  FLASH_PRODUCT_LIST: '/v1/organizations/{orgId}/stores/{storeId}/flash-products/import',
  DISCOUNT_LIST: '/v1/organizations/{orgId}/stores/{storeId}/discount-lists/import',
  MARKETPLACE_CAMPAIGN_LIST:
    '/v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/import',
};

type JsonObject = Readonly<Record<string, unknown>>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** The member `key` of an object, or undefined when `value` is not an object. */
function member(value: unknown, key: string): unknown {
  return isJsonObject(value) ? value[key] : undefined;
}

function requireObject(value: unknown, what: string): JsonObject {
  if (!isJsonObject(value)) throw new Error(`${what} is not an object in the spec`);
  return value;
}

const spec: unknown = JSON.parse(readFileSync(SPEC_URL, 'utf8'));
const specPaths = requireObject(member(spec, 'paths'), 'paths');

/** A schema, or the schema a local `$ref` (`#/components/schemas/...`) points at. */
function resolveSchema(schema: JsonObject): JsonObject {
  const ref = schema['$ref'];
  if (!isString(ref)) return schema;
  if (!ref.startsWith('#/')) throw new Error(`unsupported $ref ${ref}`);
  let node: unknown = spec;
  for (const segment of ref.slice(2).split('/')) node = member(node, segment);
  return requireObject(node, ref);
}

interface MultipartBody {
  readonly properties: readonly string[];
  readonly required: readonly string[];
}

/** The property names and the required names of an import route's multipart body. */
function multipartBody(path: string): MultipartBody {
  const content = member(member(member(specPaths[path], 'post'), 'requestBody'), 'content');
  const schema = resolveSchema(
    requireObject(member(member(content, 'multipart/form-data'), 'schema'), `${path} body`),
  );
  const properties = requireObject(schema['properties'], `${path} body properties`);
  const required = schema['required'];
  return {
    properties: Object.keys(properties),
    required: Array.isArray(required) ? required.filter(isString) : [],
  };
}

const PAGES: readonly WorkbookPage[] = Object.values(WORKBOOK_PAGES);

describe('the workbook import fields the web sends', () => {
  it.each(PAGES)('%s: the import route is in the spec', (page) => {
    expect(Object.keys(specPaths)).toContain(IMPORT_PATHS[page]);
  });

  it.each(PAGES)('%s: every field the upload form can send is a body property', (page) => {
    const { properties } = multipartBody(IMPORT_PATHS[page]);
    const emitted = emittedImportFields(WORKBOOK_VERTICALS[page].extras);
    expect(emitted.filter((field) => !properties.includes(field))).toEqual([]);
  });

  it.each(PAGES)('%s: every required body property is sent', (page) => {
    const { required } = multipartBody(IMPORT_PATHS[page]);
    const emitted = emittedImportFields(WORKBOOK_VERTICALS[page].extras);
    expect(required.filter((field) => !emitted.includes(field))).toEqual([]);
  });

  // The two fields whose silent loss changes profit: guards the test itself against an
  // emitted list that went empty.
  it('sends the funding rate on the campaign page and the commission source on Advantage', () => {
    expect(
      emittedImportFields(WORKBOOK_VERTICALS[WORKBOOK_PAGES.MARKETPLACE_CAMPAIGN_LIST].extras),
    ).toContain('trendyolFundingPct');
    expect(
      emittedImportFields(WORKBOOK_VERTICALS[WORKBOOK_PAGES.ADVANTAGE_TARIFF].extras),
    ).toContain('commissionSourceTariffId');
  });
});
