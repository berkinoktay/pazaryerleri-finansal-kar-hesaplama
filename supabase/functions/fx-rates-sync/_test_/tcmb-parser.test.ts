import { assertEquals, assertThrows } from 'jsr:@std/assert@^1';

import { parseTcmbXml, TcmbParseError } from '../tcmb-parser.ts';

const sampleXml = Deno.readTextFileSync(new URL('./fixtures/tcmb-sample.xml', import.meta.url));

Deno.test('parseTcmbXml extracts USD/EUR ForexBuying and the bulletin date', () => {
  const rates = parseTcmbXml(sampleXml);
  // ForexBuying (NOT BanknoteBuying/ForexSelling) for each currency, as raw
  // numeric strings so the caller converts with Decimal.js without float loss.
  assertEquals(rates.USD, '45.1900');
  assertEquals(rates.EUR, '53.1363');
  // Date="05/08/2026" (MM/DD/YYYY) -> UTC midnight 2026-05-08.
  assertEquals(rates.rateDate.toISOString(), '2026-05-08T00:00:00.000Z');
});

Deno.test('parseTcmbXml ignores other currencies present in the bulletin', () => {
  // The fixture also carries AUD (32.6057); the parser must not confuse it with
  // USD/EUR. Asserting the exact USD/EUR values already pins this, but make the
  // multi-currency expectation explicit.
  const rates = parseTcmbXml(sampleXml);
  assertEquals(rates.USD === '32.6057' || rates.EUR === '32.6057', false);
});

Deno.test('parseTcmbXml throws TcmbParseError when the Date attribute is missing', () => {
  assertThrows(
    () => parseTcmbXml('<Tarih_Date><Currency CurrencyCode="USD"></Currency></Tarih_Date>'),
    TcmbParseError,
  );
});

Deno.test('parseTcmbXml throws TcmbParseError when a required currency block is absent', () => {
  // Date + USD present, EUR missing -> must fail (both rates feed money math).
  const usdOnly =
    '<Tarih_Date Date="05/08/2026"><Currency CurrencyCode="USD">' +
    '<ForexBuying>45.1900</ForexBuying></Currency></Tarih_Date>';
  assertThrows(() => parseTcmbXml(usdOnly), TcmbParseError);
});

Deno.test('parseTcmbXml throws TcmbParseError when ForexBuying is empty', () => {
  const emptyRate =
    '<Tarih_Date Date="05/08/2026">' +
    '<Currency CurrencyCode="USD"><ForexBuying></ForexBuying></Currency>' +
    '<Currency CurrencyCode="EUR"><ForexBuying>53.1363</ForexBuying></Currency></Tarih_Date>';
  assertThrows(() => parseTcmbXml(emptyRate), TcmbParseError);
});
