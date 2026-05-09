import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  parseTcmbXml,
  TcmbParseError,
} from '../../../../../supabase/functions/fx-rates-sync/tcmb-parser';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(
  join(here, '../../../../../supabase/functions/fx-rates-sync/_test_/fixtures/tcmb-sample.xml'),
  'utf-8',
);

describe('parseTcmbXml', () => {
  it('extracts USD and EUR ForexBuying rates and the bulletin date', () => {
    const result = parseTcmbXml(FIXTURE);
    expect(result.USD).toBe('45.1900');
    expect(result.EUR).toBe('53.1363');
    // Date attribute "05/08/2026" (MM/DD/YYYY) → 2026-05-08 UTC
    expect(result.rateDate).toBeInstanceOf(Date);
    expect(result.rateDate.getUTCFullYear()).toBe(2026);
    expect(result.rateDate.getUTCMonth()).toBe(4); // 0-indexed: May = 4
    expect(result.rateDate.getUTCDate()).toBe(8);
  });

  it('throws TcmbParseError when USD is missing from the XML', () => {
    const xmlWithoutUsd = FIXTURE.replace(
      /<Currency[^>]*CurrencyCode="USD"[\s\S]*?<\/Currency>/,
      '',
    );
    expect(() => parseTcmbXml(xmlWithoutUsd)).toThrow(TcmbParseError);
    expect(() => parseTcmbXml(xmlWithoutUsd)).toThrow(/USD/);
  });

  it('throws TcmbParseError when EUR is missing from the XML', () => {
    const xmlWithoutEur = FIXTURE.replace(
      /<Currency[^>]*CurrencyCode="EUR"[\s\S]*?<\/Currency>/,
      '',
    );
    expect(() => parseTcmbXml(xmlWithoutEur)).toThrow(TcmbParseError);
    expect(() => parseTcmbXml(xmlWithoutEur)).toThrow(/EUR/);
  });

  it('throws TcmbParseError when given malformed XML with no Tarih_Date root', () => {
    expect(() => parseTcmbXml('<not valid xml')).toThrow(TcmbParseError);
  });
});
