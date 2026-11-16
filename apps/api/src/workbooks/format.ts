// A marketplace workbook format as data: which sheet a page reads, its layout, the
// rule that keeps a data row, how a kept row maps to the page's row type, and the
// columns an export writes back. One format per marketplace file version; the generic
// import and export read everything they need from here.

import type { Platform } from '@pazarsync/db/enums';
import type {
  BlockKey,
  ColumnKey,
  LayoutSpec,
  RowPredicate,
  RowReader,
  SheetSelector,
} from '@pazarsync/spreadsheet';
import type { WorkbookPage } from '@pazarsync/utils';

import { assertWriteValue, probeText } from './write-columns';

/** A stored format id, such as `TRENDYOL:DISCOUNT_LIST:v1`; a value is never renamed. */
export type WorkbookFormatId = `${Platform}:${WorkbookPage}:v${number}`;

/**
 * Four or more headers of a page's sheet; at least FINGERPRINT_MIN_HEADERS of them
 * recognise its file.
 */
export type Fingerprint = readonly [string, string, string, ...string[]];

/**
 * What an export may write into a write column, and so what the import rehearsal
 * probes it with (`probeValue`):
 *   - number: a plain non-negative decimal, with exactly `scale` fraction digits when
 *     given; the probe is PROBE_INTEGER_DIGITS nines plus `scale` nines;
 *   - text from an allow list; the probe is the member with the most UTF-8 bytes;
 *   - text matching `pattern`; the probe is the longest value the column can get,
 *     given by the format author, and must match the pattern.
 */
export type WriteValueSpec =
  | { readonly kind: 'number'; readonly scale?: number }
  | { readonly kind: 'text'; readonly allow: readonly [string, ...string[]] }
  | { readonly kind: 'text'; readonly pattern: RegExp; readonly probe: string };

/** Where a write column sits: a layout column, or a lookup of every block of a repeated block. */
export type WriteTarget<S extends LayoutSpec> =
  | { readonly kind: 'column'; readonly key: ColumnKey<S> }
  | { readonly kind: 'blockLookup'; readonly block: BlockKey<S>; readonly lookup: string };

export interface WriteBackColumn<S extends LayoutSpec> {
  readonly target: WriteTarget<S>;
  readonly value: WriteValueSpec;
  /** The export may overwrite a formula cell of this column (true in every Trendyol format). */
  readonly overwritesFormula: boolean;
  /** The source file's own value is the list's starting value (true only for discounts `included`). */
  readonly seededFromSource: boolean;
  /** An unselected item clears the cell (false in every format). */
  readonly clearWhenUnselected: boolean;
}

/** How an export names its download. */
export type FilenamePolicy =
  | { readonly kind: 'fixed'; readonly base: string }
  | {
      readonly kind: 'window';
      readonly base: string;
      readonly labelUnit: string;
      readonly fileUnit: string;
    }
  | {
      readonly kind: 'source';
      readonly fallback:
        | { readonly kind: 'fixed'; readonly base: string }
        | { readonly kind: 'list-name' };
    };

export interface WorkbookFormat<S extends LayoutSpec, TRow, TWrite extends string> {
  readonly id: WorkbookFormatId;
  readonly platform: Platform;
  readonly page: WorkbookPage;
  /** The engine's strict selector: by name, or by index. */
  readonly sheet: SheetSelector;
  readonly layout: S;
  readonly keep: RowPredicate<ColumnKey<S>>;
  /** The match key column (the barcode in every Trendyol format). */
  readonly anchor: ColumnKey<S>;
  readonly fingerprint: Fingerprint;
  mapRow(reader: RowReader<S>, anchor: string): TRow;
  readonly writeBack: Readonly<Record<TWrite, WriteBackColumn<S>>>;
  /**
   * CNF over write keys: every group needs at least one resolved write column.
   * `NoInfer`: the write keys are inferred from `writeBack` alone, so a group may name
   * a subset of them.
   */
  readonly exportRequires: readonly (readonly NoInfer<TWrite>[])[];
  readonly prefilled: 'ignore' | 'reject';
  readonly defaultName: string;
  readonly filename: FilenamePolicy;
}

/** A programmer error in a format definition, thrown at module load. */
function invalidFormat(id: WorkbookFormatId, problem: string, cause?: unknown): Error {
  return new Error(`Workbook format ${id}: ${problem}`, { cause });
}

function assertValidWriteColumn(id: WorkbookFormatId, key: string, spec: WriteValueSpec): void {
  if (spec.kind === 'text' && 'pattern' in spec && (spec.pattern.global || spec.pattern.sticky)) {
    // A g or y pattern carries lastIndex from one test to the next.
    throw invalidFormat(id, `write column "${key}" pattern must not carry the g or y flag`);
  }
  try {
    assertWriteValue(spec, probeText(spec));
  } catch (err) {
    throw invalidFormat(id, `write column "${key}" probe fails its own value rule`, err);
  }
}

/**
 * Returns the format unchanged, with its layout keys literal, after checking what the
 * generic import and export rely on: every write column's probe passes its own value
 * rule (so a negative or fractional scale fails too), a pattern carries no g or y flag,
 * and no `exportRequires` group is empty. Throws Error at module load otherwise.
 */
export function defineFormat<const S extends LayoutSpec, TRow, TWrite extends string>(
  format: WorkbookFormat<S, TRow, TWrite>,
): WorkbookFormat<S, TRow, TWrite> {
  for (const [key, column] of Object.entries<WriteBackColumn<S>>(format.writeBack)) {
    assertValidWriteColumn(format.id, key, column.value);
  }
  for (const group of format.exportRequires) {
    if (group.length === 0) throw invalidFormat(format.id, 'an exportRequires group is empty');
  }
  return format;
}
