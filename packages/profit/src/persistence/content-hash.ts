import { createHash } from 'node:crypto';
import { type Decimal } from 'decimal.js';
import { type ResolvedProfitSettings } from '@pazarsync/utils';

import { type ProfitLineAllocation } from '../core/allocation/allocate-parcel-line';
import { type ProfitIssue } from '../core/profit-issue';
import { type ProfitLine } from '../core/profit-line';
import { type ProfitStatement } from '../core/profit-statement';

/** An allocation paired with the index of the line it splits (into `lines`). */
export interface ContentHashAllocation {
  readonly lineIndex: number;
  readonly allocation: ProfitLineAllocation;
}

/** Everything a recompute would persist for a parcel, as the hash sees it. */
export interface ProfitContentHashInput {
  readonly engineVersion: number;
  readonly settings: ResolvedProfitSettings;
  readonly lines: readonly ProfitLine[];
  readonly allocations: readonly ContentHashAllocation[];
  readonly statements: readonly ProfitStatement[];
}

/** Thrown when the input cannot be turned into a deterministic canonical form. */
export class InvalidContentHashInputError extends Error {}

/**
 * A value in the canonical form. Decimals and dates are already text by the time a
 * value gets here; only these kinds survive into the serializer.
 */
type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

/** True for a bare object (`{}` / null-prototype); false for a Decimal, Date, Map, etc. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Serializes a value to canonical JSON: object keys sorted in code-unit order, arrays
 * left in their already-sorted order, strings and booleans via `JSON.stringify`, `null`
 * as `null`. The only number is the integer engine version. Any other kind (undefined,
 * a function, a non-finite number, or a Decimal that was not converted upstream) is a
 * programming error and throws, so a future field is covered rather than silently lost.
 */
function canonicalize(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new InvalidContentHashInputError('cannot hash a non-finite number');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((item: unknown) => canonicalize(item));
    return `[${items.join(',')}]`;
  }
  if (isPlainObject(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  throw new InvalidContentHashInputError('cannot hash this value kind');
}

/** Orders values that have no natural order by their own canonical JSON string. */
function sortByCanonicalJson<T>(values: readonly T[]): T[] {
  return values
    .map((value) => ({ value, json: canonicalize(value) }))
    .sort((left, right) => (left.json < right.json ? -1 : left.json > right.json ? 1 : 0))
    .map((entry) => entry.value);
}

/** A Decimal at full precision (never exponent notation), or `null` passed through. */
function decimalText(value: Decimal | null): string | null {
  return value === null ? null : value.toFixed();
}

/** One item's share of a parcel line: the amounts and the basis used to derive them. */
function allocationToCanonical(allocation: ProfitLineAllocation): CanonicalValue {
  return {
    orderItemId: allocation.orderItemId,
    amountGross: allocation.amount.gross.toFixed(),
    amountVat: allocation.amount.vat.toFixed(),
    basis: allocation.basisUsed,
  };
}

/**
 * A profit line with its allocations nested under it. Nesting (rather than referencing
 * lines by index) makes the hash independent of line order: the whole line object,
 * allocations included, is sorted as one unit.
 */
function lineToCanonical(
  profitLine: ProfitLine,
  allocations: readonly ProfitLineAllocation[],
): CanonicalValue {
  return {
    type: profitLine.type,
    level: profitLine.level,
    orderItemId: profitLine.orderItemId,
    certainty: profitLine.certainty,
    source: profitLine.source,
    amountGross: profitLine.amount.gross.toFixed(),
    amountVat: profitLine.amount.vat.toFixed(),
    vatRatePct: decimalText(profitLine.vatRatePct),
    fx: {
      currency: profitLine.fx.currency,
      originalGross: profitLine.fx.original.gross.toFixed(),
      originalVat: profitLine.fx.original.vat.toFixed(),
      rate: profitLine.fx.rate.toFixed(),
      rateDate: profitLine.fx.rateDate,
      source: profitLine.fx.source,
    },
    inputs: profitLine.inputs,
    externalRecord:
      profitLine.externalRecord === null
        ? null
        : {
            recordId: profitLine.externalRecord.recordId,
            rawType: profitLine.externalRecord.rawType,
          },
    allocations: sortByCanonicalJson(allocations.map(allocationToCanonical)),
  };
}

/** A single calculation problem, in the shape the statement row persists. */
function issueToCanonical(issue: ProfitIssue): CanonicalValue {
  return {
    code: issue.code,
    orderItemId: issue.orderItemId,
    detail: issue.detail,
  };
}

/**
 * A profit statement as the `order_profit_statements` row stores it. `selectedLines`
 * and `rows` are left out: both are derived from the lines and are not persisted.
 */
function statementToCanonical(statement: ProfitStatement): CanonicalValue {
  return {
    view: statement.view,
    status: statement.status,
    saleGross: statement.saleGross.toFixed(),
    costGross: statement.costGross.toFixed(),
    vatOutput: statement.vat.output.toFixed(),
    vatInput: statement.vat.input.toFixed(),
    vatNet: statement.vat.net.toFixed(),
    vatEffective: statement.vat.effective.toFixed(),
    stoppageGross: statement.stoppageGross.toFixed(),
    stoppageIncluded: statement.stoppageIncluded,
    netProfit: decimalText(statement.netProfit),
    saleMarginPct: decimalText(statement.saleMarginPct),
    costMarkupPct: decimalText(statement.costMarkupPct),
    issues: sortByCanonicalJson(statement.issues.map(issueToCanonical)),
  };
}

/**
 * Buckets allocations under the line they point at. A `lineIndex` that is not an
 * integer in `[0, lineCount)` is a broken input and throws.
 */
function groupAllocationsByLine(
  allocations: readonly ContentHashAllocation[],
  lineCount: number,
): ProfitLineAllocation[][] {
  const buckets: ProfitLineAllocation[][] = [];
  for (let index = 0; index < lineCount; index += 1) {
    buckets.push([]);
  }
  for (const entry of allocations) {
    const { lineIndex } = entry;
    if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lineCount) {
      throw new InvalidContentHashInputError(
        `allocation lineIndex ${lineIndex} is out of range [0, ${lineCount})`,
      );
    }
    const bucket = buckets[lineIndex];
    if (bucket === undefined) {
      throw new InvalidContentHashInputError(`allocation lineIndex ${lineIndex} has no line`);
    }
    bucket.push(entry.allocation);
  }
  return buckets;
}

/**
 * A stable SHA-256 content hash over everything a recompute would persist for a parcel:
 * the engine version, the settings snapshot, the profit lines (each with its allocations
 * nested under it), and both statements. The writer stores this hash and skips a rewrite
 * when a fresh recompute produces the same one.
 *
 * The hash is independent of input ordering: lines and the allocations under a line are
 * sorted by their own canonical JSON, statements by view. Decimal values are written at
 * full precision; dates are already strings. Returns a 64-character lowercase hex digest.
 */
export function profitContentHash(input: ProfitContentHashInput): string {
  const allocationsByLine = groupAllocationsByLine(input.allocations, input.lines.length);

  const canonicalLines = sortByCanonicalJson(
    input.lines.map((profitLine, index) =>
      lineToCanonical(profitLine, allocationsByLine[index] ?? []),
    ),
  );
  const canonicalStatements = [...input.statements]
    .sort((left, right) => (left.view < right.view ? -1 : left.view > right.view ? 1 : 0))
    .map(statementToCanonical);

  const envelope = {
    engineVersion: input.engineVersion,
    settings: input.settings,
    lines: canonicalLines,
    statements: canonicalStatements,
  };

  return createHash('sha256').update(canonicalize(envelope), 'utf8').digest('hex');
}
