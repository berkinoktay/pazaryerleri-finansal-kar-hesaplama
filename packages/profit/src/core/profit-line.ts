import { Decimal } from 'decimal.js';
import {
  FxRateSource,
  ProfitLineLevel,
  type ProfitLineCertainty,
  type ProfitLineSource,
  type ProfitLineType,
} from '@pazarsync/db/enums';

import { type CurrencyCode } from './fx/currency-code';
import { getLineSpec } from './catalog/profit-line-catalog';

/** A line input value. Numbers travel as text (e.g. desi "2") to keep precision. */
export type ProfitLineInputValue = string | boolean | null;
export type ProfitLineInputs = Readonly<Record<string, ProfitLineInputValue>>;

export interface LineMoney {
  readonly gross: Decimal;
  readonly vat: Decimal;
}

export interface FxConversion {
  readonly currency: CurrencyCode; // original currency
  readonly original: LineMoney; // amount in the original currency
  readonly rate: Decimal; // original -> accounting currency
  readonly rateDate: string | null; // YYYY-MM-DD; null for NATIVE and MANUAL
  readonly source: FxRateSource;
}

export interface ExternalRecordRef {
  readonly recordId: string;
  readonly rawType: string;
}

export interface ProfitLine {
  readonly type: ProfitLineType;
  readonly level: ProfitLineLevel;
  readonly orderItemId: string | null; // required for ITEM, null for PARCEL
  readonly certainty: ProfitLineCertainty;
  readonly source: ProfitLineSource;
  readonly amount: LineMoney; // accounting currency, rounded to 2 decimals, non-negative
  readonly vatRatePct: Decimal | null; // informational only
  readonly fx: FxConversion;
  readonly inputs: ProfitLineInputs;
  readonly externalRecord: ExternalRecordRef | null;
}

export class InvalidProfitLineError extends Error {}

const MAX_MONEY_DECIMALS = 2;
const ZERO = new Decimal(0);
const ONE = new Decimal(1);

function assertRoundedNonNegative(value: Decimal, field: string): void {
  if (value.lt(ZERO)) {
    throw new InvalidProfitLineError(`${field} must not be negative`);
  }
  if (value.decimalPlaces() > MAX_MONEY_DECIMALS) {
    throw new InvalidProfitLineError(`${field} must not have more than two decimals`);
  }
}

/**
 * The single profit line constructor. Validates the four invariants in order and
 * throws `InvalidProfitLineError` naming the broken rule. A valid line is returned
 * as a shallow copy of its params.
 */
export function createProfitLine(params: ProfitLine): ProfitLine {
  const spec = getLineSpec(params.type);

  if (!spec.levels.includes(params.level)) {
    throw new InvalidProfitLineError(`level ${params.level} is not allowed for ${params.type}`);
  }

  if (params.level === ProfitLineLevel.ITEM) {
    if (params.orderItemId === null || params.orderItemId.length === 0) {
      throw new InvalidProfitLineError('an ITEM line requires a non-empty orderItemId');
    }
  } else if (params.orderItemId !== null) {
    throw new InvalidProfitLineError('a PARCEL line must have a null orderItemId');
  }

  assertRoundedNonNegative(params.amount.gross, 'amount.gross');
  assertRoundedNonNegative(params.amount.vat, 'amount.vat');

  if (params.fx.source === FxRateSource.NATIVE) {
    if (!params.fx.rate.equals(ONE)) {
      throw new InvalidProfitLineError('a NATIVE fx conversion must have a rate of 1');
    }
    if (params.fx.rateDate !== null) {
      throw new InvalidProfitLineError('a NATIVE fx conversion must have a null rateDate');
    }
  }

  return { ...params };
}

/** Builds a same-currency (NATIVE) fx conversion: rate 1, no rate date. */
export function nativeFx(amount: LineMoney, currency: CurrencyCode): FxConversion {
  return {
    currency,
    original: amount,
    rate: new Decimal(1),
    rateDate: null,
    source: FxRateSource.NATIVE,
  };
}
