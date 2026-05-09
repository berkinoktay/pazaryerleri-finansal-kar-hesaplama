/**
 * TCMB (Türkiye Cumhuriyet Merkez Bankası) XML parser.
 *
 * Pure function — no I/O, no external dependencies, no Deno-specific APIs.
 * Works identically in the Deno Edge Function runtime and in the Node.js
 * Vitest test runner.
 *
 * TCMB publishes daily FX rates at https://www.tcmb.gov.tr/kurlar/today.xml.
 * We extract ForexBuying (NOT BanknoteBuying — they reflect different market
 * segments; ForexBuying is the interbank electronic rate, more representative
 * of the rate AUTO-mode cost profiles should use for cost accounting).
 *
 * Example XML shape (abbreviated):
 *   <Tarih_Date Tarih="08.05.2026" Date="05/08/2026" Bulten_No="2026/87">
 *     <Currency CurrencyCode="USD">
 *       <ForexBuying>45.1900</ForexBuying>
 *     </Currency>
 *     <Currency CurrencyCode="EUR">
 *       <ForexBuying>53.1363</ForexBuying>
 *     </Currency>
 *   </Tarih_Date>
 */

export class TcmbParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TcmbParseError';
  }
}

/**
 * Parsed TCMB rates. Rates are returned as decimal strings to avoid any
 * floating-point loss before the caller converts them with Decimal.js.
 */
export interface TcmbRates {
  /** ForexBuying rate for USD as a numeric string (e.g. "45.1900"). */
  USD: string;
  /** ForexBuying rate for EUR as a numeric string (e.g. "53.1363"). */
  EUR: string;
  /** Bulletin date parsed from the `Date` attribute (UTC midnight). */
  rateDate: Date;
}

/**
 * Parse a TCMB XML bulletin string and return USD/EUR ForexBuying rates.
 *
 * @throws {TcmbParseError} If the XML is malformed, or USD or EUR is absent.
 */
export function parseTcmbXml(xml: string): TcmbRates {
  const rateDate = extractRateDate(xml);
  const USD = extractForexBuying(xml, 'USD');
  const EUR = extractForexBuying(xml, 'EUR');
  return { USD, EUR, rateDate };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Extract the bulletin date from the `Date` attribute of `<Tarih_Date>`.
 * TCMB uses MM/DD/YYYY format (e.g. `Date="05/08/2026"`).
 * We construct as UTC midnight to avoid local-timezone date shifts.
 */
function extractRateDate(xml: string): Date {
  const match = xml.match(/Date="(\d{2})\/(\d{2})\/(\d{4})"/);
  if (!match) {
    throw new TcmbParseError(
      'TCMB XML missing or malformed Date attribute on <Tarih_Date> root element',
    );
  }
  const [, mm, dd, yyyy] = match as [string, string, string, string];
  const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  if (isNaN(date.getTime())) {
    throw new TcmbParseError(`TCMB XML has unparseable date: ${mm}/${dd}/${yyyy}`);
  }
  return date;
}

/**
 * Returns the raw ForexBuying numeric string for the given currency code.
 * Caller is responsible for Decimal conversion.
 */
function extractForexBuying(xml: string, code: 'USD' | 'EUR'): string {
  const blockRe = new RegExp(`<Currency[^>]*CurrencyCode="${code}"[\\s\\S]*?<\\/Currency>`);
  const blockMatch = xml.match(blockRe);
  if (!blockMatch) {
    throw new TcmbParseError(
      `TCMB XML is missing the ${code} currency block. ` +
        `Bulletin may be incomplete or the XML format has changed.`,
    );
  }

  const rateMatch = blockMatch[0].match(/<ForexBuying>([\d.]+)<\/ForexBuying>/);
  if (!rateMatch?.[1]) {
    throw new TcmbParseError(`TCMB XML has ${code} block but <ForexBuying> is empty or malformed.`);
  }
  return rateMatch[1];
}
