/**
 * ISO 4217 currency code as a branded string. The brand keeps a raw `string`
 * from being passed where a validated currency code is expected, without ever
 * reaching for a type assertion: `toCurrencyCode` narrows through the guard.
 */
export type CurrencyCode = string & { readonly __brand: 'CurrencyCode' };

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

/** Thrown when a string is not a well-formed ISO 4217 currency code. */
export class InvalidCurrencyCodeError extends Error {}

/** Type guard: true when `value` is three uppercase ASCII letters. */
export function isCurrencyCode(value: string): value is CurrencyCode {
  return CURRENCY_CODE_PATTERN.test(value);
}

/** Validates and narrows a string to `CurrencyCode`; throws otherwise. */
export function toCurrencyCode(value: string): CurrencyCode {
  if (!isCurrencyCode(value)) {
    throw new InvalidCurrencyCodeError(`Invalid ISO 4217 currency code: ${value}`);
  }
  return value;
}

/** The accounting currency: Turkish lira. */
export const CURRENCY_TRY: CurrencyCode = toCurrencyCode('TRY');
