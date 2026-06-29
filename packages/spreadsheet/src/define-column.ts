import type { Decimal } from 'decimal.js';
import type { CellType, ColumnDef } from './types';

// Maps CellType to the expected TS field type. Mismatch causes a compile error.
type ExpectedTsType<T extends CellType> = T extends 'decimal' | 'percent'
  ? Decimal
  : T extends 'integer'
    ? number
    : T extends 'boolean'
      ? boolean
      : T extends 'date'
        ? Date
        : T extends 'string'
          ? string
          : T extends 'string[]'
            ? readonly string[]
            : unknown; // 'custom' — shaped by parse()

type TypeMismatchBrand<K, T> = { readonly __TYPE_MISMATCH__: ['column', K, 'is', T] };

/**
 * Preserves K per-column and enforces CellType <-> TS type compatibility at compile time.
 * On mismatch the return type carries the brand -> compile error.
 */
export function defineColumn<TRow, K extends keyof TRow & string, T extends CellType>(
  def: ColumnDef<TRow, K> & { readonly type: T } & (TRow[K] extends ExpectedTsType<T>
      ? unknown
      : TypeMismatchBrand<K, T>),
): ColumnDef<TRow, K> {
  return def;
}
