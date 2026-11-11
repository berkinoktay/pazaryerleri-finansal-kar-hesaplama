import { Decimal } from 'decimal.js';
import { type Prisma } from '@pazarsync/db';

import {
  createProfitLine,
  type ExternalRecordRef,
  type ProfitLine,
  type ProfitLineInputs,
  type ProfitLineInputValue,
} from '../core/profit-line';
import { InvalidStoredProfitDataError } from '../persistence/errors';

/**
 * The profit_lines columns needed to rebuild an engine `ProfitLine`. Matches the
 * writer's row shape minus the stamped-and-forgotten columns (ids, engineVersion,
 * timestamps): those do not feed the engine value.
 */
export const STORED_PROFIT_LINE_SELECT = {
  orderId: true,
  orderItemId: true,
  type: true,
  level: true,
  certainty: true,
  source: true,
  amountGross: true,
  amountVat: true,
  vatRatePct: true,
  inputs: true,
  externalRecordId: true,
  externalRecordType: true,
} as const satisfies Prisma.ProfitLineSelect;

/** A profit_lines row projected through STORED_PROFIT_LINE_SELECT. */
export type StoredProfitLineRow = Prisma.ProfitLineGetPayload<{
  select: typeof STORED_PROFIT_LINE_SELECT;
}>;

/**
 * Rebuilds the engine `ProfitLine` from a stored row, running it back through
 * `createProfitLine` so a row that violates a line invariant throws
 * `InvalidProfitLineError`. Decimal columns become decimal.js values; `inputs` must
 * be a flat JSON object of string/boolean/null values, and the external-record pair
 * is either both-null (no record) or both-set, never half-set.
 */
export function toProfitLine(row: StoredProfitLineRow): ProfitLine {
  return createProfitLine({
    type: row.type,
    level: row.level,
    orderItemId: row.orderItemId,
    certainty: row.certainty,
    source: row.source,
    amount: {
      gross: new Decimal(row.amountGross.toString()),
      vat: new Decimal(row.amountVat.toString()),
    },
    vatRatePct: row.vatRatePct === null ? null : new Decimal(row.vatRatePct.toString()),
    inputs: parseInputs(row.inputs),
    externalRecord: parseExternalRecord(row.externalRecordId, row.externalRecordType),
  });
}

/** A line input must be a string, boolean or null; a type guard, never a cast. */
function isInputValue(value: Prisma.JsonValue | undefined): value is ProfitLineInputValue {
  return value === null || typeof value === 'string' || typeof value === 'boolean';
}

/** Parses the `inputs` JSON into a flat record, throwing on a non-flat or wrong-typed value. */
function parseInputs(value: Prisma.JsonValue): ProfitLineInputs {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidStoredProfitDataError('profit line inputs must be a flat JSON object');
  }
  const inputs: Record<string, ProfitLineInputValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isInputValue(entry)) {
      throw new InvalidStoredProfitDataError(
        `profit line input ${key} must be a string, boolean or null`,
      );
    }
    inputs[key] = entry;
  }
  return inputs;
}

/** Rebuilds the external record ref: both columns null -> null, both set -> ref, half-set throws. */
function parseExternalRecord(
  recordId: string | null,
  rawType: string | null,
): ExternalRecordRef | null {
  if (recordId === null && rawType === null) {
    return null;
  }
  if (recordId === null || rawType === null) {
    throw new InvalidStoredProfitDataError(
      'a profit line external record needs both external_record_id and external_record_type',
    );
  }
  return { recordId, rawType };
}
