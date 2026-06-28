import { Decimal } from 'decimal.js';
import type { ColumnDef, PercentScale } from './types';

export type WriteCellType = 'String' | 'Number' | 'Boolean' | 'Date';

const CURRENCY_AND_NOISE = /[ \s%₺$]/g; // NBSP, space, %, ₺, $

export function normalizeDecimalString(raw: string): string {
  let s = raw.trim().replace(/TL$/i, '').replace(CURRENCY_AND_NOISE, '');
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    s = s.replace(/\./g, '').replace(',', '.'); // '.' is thousands separator, ',' is decimal
  } else if (hasComma) {
    s = s.replace(',', '.'); // lone ',' is the decimal separator
  }
  return s;
}

function toDecimal(raw: unknown): Decimal {
  if (typeof raw === 'number') return new Decimal(raw);
  if (typeof raw === 'string') return new Decimal(normalizeDecimalString(raw));
  throw new Error('not_a_number');
}

function losslessString(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number') return new Decimal(raw).toFixed(); // no scientific notation, no trailing decimal
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  throw new Error('invalid');
}

export function coerceInbound<TRow, K extends keyof TRow & string>(
  col: ColumnDef<TRow, K>,
  raw: unknown,
): unknown {
  switch (col.type) {
    case 'string':
      return col.stringifyLossless ? losslessString(raw) : String(raw);
    case 'integer': {
      const n = typeof raw === 'number' ? raw : Number(normalizeDecimalString(String(raw)));
      if (!Number.isInteger(n)) throw new Error('not_an_integer');
      return n;
    }
    case 'decimal':
      return toDecimal(raw);
    case 'percent': {
      const d = toDecimal(raw);
      const scale: PercentScale = col.percentScale ?? 'whole';
      return scale === 'whole' ? d.div(100) : d;
    }
    case 'boolean':
      return typeof raw === 'boolean' ? raw : String(raw).trim().toLowerCase() === 'true';
    case 'date':
      if (raw instanceof Date) return raw;
      throw new Error('invalid'); // textual dates must be handled via custom parse
    case 'string[]':
      return String(raw)
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    case 'custom':
      if (!col.parse) throw new Error('custom column requires parse()');
      return col.parse(raw);
    default: {
      const _exhaustive: never = col.type;
      throw new Error(`Unhandled cell type: ${String(_exhaustive)}`);
    }
  }
}

export function renderOutbound<TRow, K extends keyof TRow & string>(
  col: ColumnDef<TRow, K>,
  value: unknown,
): { value: string | number | boolean | Date | null; type: WriteCellType } {
  if (value === null || value === undefined) return { value: null, type: 'String' };
  switch (col.type) {
    case 'decimal':
    case 'percent': {
      const d = value instanceof Decimal ? value : new Decimal(String(value));
      return { value: d.toNumber(), type: 'Number' };
    }
    case 'integer':
      return { value: Number(value), type: 'Number' };
    case 'boolean':
      return { value: Boolean(value), type: 'Boolean' };
    case 'date': {
      if (!(value instanceof Date)) throw new Error('invalid_date');
      return { value, type: 'Date' };
    }
    case 'string':
    case 'string[]':
    case 'custom':
      return { value: String(value), type: 'String' };
    default: {
      const _exhaustive: never = col.type;
      throw new Error(`Unhandled cell type: ${String(_exhaustive)}`);
    }
  }
}
