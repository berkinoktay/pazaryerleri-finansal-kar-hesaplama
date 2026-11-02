import { type Decimal } from 'decimal.js';
import {
  ProfitLineLevel,
  type ProfitLineCertainty,
  type ProfitLineSource,
  type ProfitLineType,
} from '@pazarsync/db/enums';

import { kurusAmountViolation } from '../money';
import { getLineSpec } from './catalog/profit-line-catalog';

/** A line input value. Numbers travel as text (e.g. desi "2") to keep precision. */
export type ProfitLineInputValue = string | boolean | null;
export type ProfitLineInputs = Readonly<Record<string, ProfitLineInputValue>>;

export interface LineMoney {
  readonly gross: Decimal;
  readonly vat: Decimal;
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
  readonly amount: LineMoney; // Turkish lira, rounded to 2 decimals, non-negative
  readonly vatRatePct: Decimal | null; // informational only
  readonly inputs: ProfitLineInputs;
  readonly externalRecord: ExternalRecordRef | null;
}

export class InvalidProfitLineError extends Error {}

function assertRoundedNonNegative(value: Decimal, field: string): void {
  const violation = kurusAmountViolation(value);
  if (violation === 'NOT_FINITE') {
    throw new InvalidProfitLineError(`${field} must be a finite number`);
  }
  if (violation === 'NEGATIVE') {
    throw new InvalidProfitLineError(`${field} must not be negative`);
  }
  if (violation === 'TOO_MANY_DECIMALS') {
    throw new InvalidProfitLineError(`${field} must not have more than two decimals`);
  }
}

/**
 * The single profit line constructor. Validates the invariants in order and throws
 * `InvalidProfitLineError` naming the broken rule. A valid line is returned as a
 * shallow copy of its params.
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

  return { ...params };
}
