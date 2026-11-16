// The write columns of a format resolved against one file's layout, and the value
// rules every written cell follows. The import rehearsal and the export both work
// from `resolveWriteColumns`, so they patch exactly the same cells.

import {
  SpreadsheetFileError,
  type CellPatchValue,
  type LayoutSpec,
  type ResolvedLayout,
} from '@pazarsync/spreadsheet';

import { PROBE_INTEGER_DIGITS } from '../config/workbook-limits';
import type { WorkbookFormat, WriteValueSpec } from './format';
import { WorkbookInvariantError } from './workbook-errors';

/** One write column found in a file: its key, its block tag (null for a plain column), its column. */
export interface ResolvedWriteColumn<TWrite extends string> {
  readonly key: TWrite;
  readonly tag: number | null;
  readonly col: number;
  readonly spec: WriteValueSpec;
}

/** `meta.reason` of the MALFORMED_SHEET `resolveWriteColumns` throws. */
export const WRITE_COLUMN_CLASH_REASONS = {
  // Two write columns resolved to one cell column.
  SHARED_COLUMN: 'write-column-shared',
  // Two blocks of one lookup carry the same tag, so (key, tag) names two columns.
  SHARED_TAG: 'write-column-tag',
} as const;

/** `meta.reason` of the MALFORMED_SHEET `requireWritableValue` throws. */
export const UNWRITABLE_VALUE_REASON = 'unwritable-value';

// A written number: a plain non-negative decimal (the engine's PLAIN_DECIMAL_RE
// without the sign). Group 1 is the integer part, group 2 the fraction digits.
const UNSIGNED_DECIMAL_RE = /^(0|[1-9]\d*)(?:\.(\d+))?$/;

const PROBE_DIGIT = '9';
const UTF8 = new TextEncoder();

function writeKeys<S extends LayoutSpec, TRow, TWrite extends string>(
  format: WorkbookFormat<S, TRow, TWrite>,
): TWrite[] {
  return Object.keys(format.writeBack).filter((key): key is TWrite =>
    Object.hasOwn(format.writeBack, key),
  );
}

function malformed(reason: string, message: string): SpreadsheetFileError {
  return new SpreadsheetFileError('MALFORMED_SHEET', message, { reason });
}

/**
 * The write columns of `format` found in `layout`: a `column` target gives one entry
 * when its column resolved; a `blockLookup` gives one entry per block whose lookup
 * header resolved, tagged with that block's tag. Entries come in write-key order,
 * blocks in column order.
 *
 * Throws SpreadsheetFileError MALFORMED_SHEET when two entries land on one column,
 * or two blocks of one lookup carry the same tag: the export could not tell which
 * value goes where, and two patches on one cell are a plain Error in the engine.
 */
export function resolveWriteColumns<S extends LayoutSpec, TRow, TWrite extends string>(
  format: WorkbookFormat<S, TRow, TWrite>,
  layout: ResolvedLayout,
): readonly ResolvedWriteColumn<TWrite>[] {
  const resolved: ResolvedWriteColumn<TWrite>[] = [];
  for (const key of writeKeys(format)) {
    const { target, value: spec } = format.writeBack[key];
    switch (target.kind) {
      case 'column': {
        const col = layout.columns.get(target.key) ?? null;
        if (col !== null) resolved.push({ key, tag: null, col, spec });
        break;
      }
      case 'blockLookup': {
        const tags = new Set<number>();
        for (const block of layout.blocks.get(target.block) ?? []) {
          const col = block.lookups.get(target.lookup) ?? null;
          if (col === null) continue;
          if (tags.has(block.tag)) {
            throw malformed(
              WRITE_COLUMN_CLASH_REASONS.SHARED_TAG,
              `Two blocks carry tag ${block.tag} for write column "${key}"`,
            );
          }
          tags.add(block.tag);
          resolved.push({ key, tag: block.tag, col, spec });
        }
        break;
      }
      default: {
        const exhaustive: never = target;
        throw new Error(`Unhandled write target: ${JSON.stringify(exhaustive)}`);
      }
    }
  }
  const columns = new Set<number>();
  for (const entry of resolved) {
    if (columns.has(entry.col)) {
      throw malformed(
        WRITE_COLUMN_CLASH_REASONS.SHARED_COLUMN,
        `Two write columns resolve to column ${entry.col}`,
      );
    }
    columns.add(entry.col);
  }
  return resolved;
}

/** The resolved columns whose write column may overwrite a formula cell, ascending. */
export function overwriteFormulaColumns<S extends LayoutSpec, TRow, TWrite extends string>(
  format: WorkbookFormat<S, TRow, TWrite>,
  resolved: readonly ResolvedWriteColumn<TWrite>[],
): readonly number[] {
  return resolved
    .filter((entry) => format.writeBack[entry.key].overwritesFormula)
    .map((entry) => entry.col)
    .sort((a, b) => a - b);
}

/** True when some `exportRequires` group has no resolved write column: nothing to export into. */
export function missingExportRequirement<S extends LayoutSpec, TRow, TWrite extends string>(
  format: WorkbookFormat<S, TRow, TWrite>,
  resolved: readonly ResolvedWriteColumn<TWrite>[],
): boolean {
  const present = new Set<string>(resolved.map((entry) => entry.key));
  return format.exportRequires.some((group) => !group.some((key) => present.has(key)));
}

function utf8Length(text: string): number {
  return UTF8.encode(text).length;
}

/**
 * The text of the largest value a column of `spec` can receive: PROBE_INTEGER_DIGITS
 * nines (plus `.` and `scale` nines), the allow-list member with the most UTF-8 bytes
 * (the first one on a tie), or the pattern's author-given probe.
 */
export function probeText(spec: WriteValueSpec): string {
  if (spec.kind === 'number') {
    const integer = PROBE_DIGIT.repeat(PROBE_INTEGER_DIGITS);
    const scale = spec.scale ?? 0;
    return scale > 0 ? `${integer}.${PROBE_DIGIT.repeat(scale)}` : integer;
  }
  if ('pattern' in spec) return spec.probe;
  let widest = spec.allow[0];
  for (const member of spec.allow) {
    if (utf8Length(member) > utf8Length(widest)) widest = member;
  }
  return widest;
}

/**
 * The value the import rehearsal writes into a column of `spec`: the largest the
 * export can write, so the rehearsal meets the engine's growth cap whenever an export
 * could.
 */
export function probeValue(spec: WriteValueSpec): CellPatchValue {
  const value = probeText(spec);
  if (spec.kind === 'text') return { kind: 'text', value };
  return spec.scale === undefined
    ? { kind: 'number', value }
    : { kind: 'number', value, scale: spec.scale };
}

/**
 * Why a column of `spec` may not receive `value`, or null when it may. The kind rule
 * comes first, the width against `probeText(spec)` last. The value never appears in
 * the message.
 */
function writeValueProblem(spec: WriteValueSpec, value: string): string | null {
  if (spec.kind === 'number') {
    const match = UNSIGNED_DECIMAL_RE.exec(value);
    if (match === null) return 'A written number is not a plain non-negative decimal';
    const integer = match[1] ?? '';
    const fraction = match[2] ?? '';
    if (integer.length > PROBE_INTEGER_DIGITS) {
      return `A written number has more than ${PROBE_INTEGER_DIGITS} integer digits`;
    }
    if (spec.scale !== undefined && fraction.length !== spec.scale) {
      return `A written number does not have exactly ${spec.scale} fraction digits`;
    }
  } else if ('pattern' in spec) {
    if (!spec.pattern.test(value)) return 'A written text does not match its column pattern';
  } else if (!spec.allow.includes(value)) {
    return "A written text is not in its column's allow list";
  }
  if (utf8Length(value) > utf8Length(probeText(spec))) {
    return 'A written value is wider than the rehearsal probe of its column';
  }
  return null;
}

/**
 * Throws WorkbookInvariantError unless `value` is one a column of `spec` may receive:
 * a plain non-negative decimal of at most PROBE_INTEGER_DIGITS integer digits (and
 * exactly `scale` fraction digits when given), an allow-list member, or a text that
 * matches the pattern; and, for every kind, no more UTF-8 bytes than `probeText(spec)`,
 * so no export writes a wider value than the import rehearsal proved fits. The value
 * never appears in the message. A format's module-load probe check runs it.
 */
export function assertWriteValue(spec: WriteValueSpec, value: string): void {
  const problem = writeValueProblem(spec, value);
  if (problem !== null) throw new WorkbookInvariantError(problem);
}

/**
 * A planned export write its column's rule refuses (`assertPlannedWriteValue`). The
 * value comes from a stored record, and a record stored before the upload checked its
 * values can hold one the rule refuses (a negative campaign maximum price, a window
 * wider than a week): the export answers it as a stored file it cannot write, 409
 * STORED_FILE_UNREADABLE, never a 500.
 */
export class UnwritableStoredValueError extends Error {
  readonly reason = UNWRITABLE_VALUE_REASON;

  constructor(message: string) {
    super(message);
    this.name = 'UnwritableStoredValueError';
  }
}

/**
 * The rule of `assertWriteValue` on a write `planExport` planned from a stored record.
 * Throws UnwritableStoredValueError (never a plain WorkbookInvariantError) for a value a
 * column of `spec` may not receive. The value never appears in the message.
 */
export function assertPlannedWriteValue(spec: WriteValueSpec, value: string): void {
  const problem = writeValueProblem(spec, value);
  if (problem !== null) throw new UnwritableStoredValueError(problem);
}

/**
 * `value`, read from the uploaded file, when a column of `spec` may receive it under
 * the export's own rule (the rule `assertWriteValue` states and the export runs as
 * `assertPlannedWriteValue`). A value an export may later write into
 * a column of `spec` (the campaign maximum price today; tier and band prices of later
 * pages) is refused at upload unless that rule would accept it, so a stored list never
 * holds a value its export cannot write.
 *
 * Throws SpreadsheetFileError MALFORMED_SHEET (reason UNWRITABLE_VALUE_REASON), a 422
 * on `file` at upload. The value never appears in the message.
 */
export function requireWritableValue(spec: WriteValueSpec, value: string): string {
  const problem = writeValueProblem(spec, value);
  if (problem !== null) throw malformed(UNWRITABLE_VALUE_REASON, problem);
  return value;
}
