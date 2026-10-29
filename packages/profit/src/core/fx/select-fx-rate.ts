import { Decimal } from 'decimal.js';
import { FxRateSource } from '@pazarsync/db/enums';

import { type CurrencyCode } from './currency-code';

/** A published rate for one currency on one business date, expressed against the base currency. */
export interface FxRateQuote {
  readonly currency: CurrencyCode;
  readonly rateDate: string; // YYYY-MM-DD
  readonly rateToBase: Decimal;
}

/** The rate chosen for an event date: original -> accounting currency. */
export interface SelectedFxRate {
  readonly rate: Decimal;
  readonly rateDate: string | null; // YYYY-MM-DD; null for NATIVE
  readonly source: FxRateSource;
}

/** Stored precision of a selected rate so recomputation from the stored rate is stable. */
export const FX_RATE_DECIMALS = 6;

const EVENT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Rounds a rate to the stored precision (ROUND_HALF_UP). */
function roundRate(rate: Decimal): Decimal {
  return rate.toDecimalPlaces(FX_RATE_DECIMALS, Decimal.ROUND_HALF_UP);
}

/**
 * Picks the rate for `eventDate`: converting `from` into `to` through `base`.
 *
 * A currency's rate is the quote with a matching `currency` and the greatest
 * `rateDate` that is still `<= eventDate` (ISO dates compare as plain text). An
 * event date earlier than the first quote yields `null`, which the caller turns
 * into a `MISSING_FX_RATE` issue. When neither side is the base, the two quotes
 * are crossed through the base and the older of the two dates is reported.
 */
export function selectFxRate(params: {
  readonly from: CurrencyCode;
  readonly to: CurrencyCode;
  readonly eventDate: string;
  readonly base: CurrencyCode;
  readonly quotes: readonly FxRateQuote[];
  readonly quoteSource: FxRateSource;
}): SelectedFxRate | null {
  const { from, to, eventDate, base, quotes, quoteSource } = params;

  if (!EVENT_DATE_PATTERN.test(eventDate)) {
    throw new RangeError(`eventDate must be in YYYY-MM-DD format: ${eventDate}`);
  }

  if (from === to) {
    return { rate: new Decimal(1), rateDate: null, source: FxRateSource.NATIVE };
  }

  const findQuote = (currency: CurrencyCode): FxRateQuote | null => {
    let best: FxRateQuote | null = null;
    for (const quote of quotes) {
      if (quote.currency !== currency || quote.rateDate > eventDate) {
        continue;
      }
      if (best === null || quote.rateDate > best.rateDate) {
        best = quote;
      }
    }
    return best;
  };

  if (to === base) {
    const quote = findQuote(from);
    if (quote === null) {
      return null;
    }
    return { rate: roundRate(quote.rateToBase), rateDate: quote.rateDate, source: quoteSource };
  }

  if (from === base) {
    const quote = findQuote(to);
    if (quote === null) {
      return null;
    }
    return {
      rate: roundRate(new Decimal(1).div(quote.rateToBase)),
      rateDate: quote.rateDate,
      source: quoteSource,
    };
  }

  const fromQuote = findQuote(from);
  const toQuote = findQuote(to);
  if (fromQuote === null || toQuote === null) {
    return null;
  }
  const rate = fromQuote.rateToBase.div(toQuote.rateToBase);
  const rateDate = fromQuote.rateDate < toQuote.rateDate ? fromQuote.rateDate : toQuote.rateDate;
  return { rate: roundRate(rate), rateDate, source: quoteSource };
}
