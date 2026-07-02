// Generic Advanced Filtering engine contracts (Option A). Shared by the
// patterns/ editor components and any feature's filter catalog (products today,
// orders once its page infra settles). Pure types + the dataType→operator map;
// no React, no feature knowledge.

// Operators a chip can carry. The dataType constrains which apply (see
// DATATYPE_OPERATORS). `isTrue` is the single-tap flag (no value editor).
export const FILTER_OPERATORS = [
  'eq',
  'gte',
  'lte',
  'between',
  'contains',
  'equals',
  'startsWith',
  'in',
  'isTrue',
] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export function isFilterOperator(value: unknown): value is FilterOperator {
  return typeof value === 'string' && (FILTER_OPERATORS as readonly string[]).includes(value);
}

// Drives operator set + value editor. money/percent/number → RangeInput;
// text → Input; date → DateRangePicker; enumMulti/enumFixed → multi-select
// Command; enumSingle → single-select Command (radio semantics — for backend
// params that accept ONE value, e.g. product status); flag → toggle chip
// (no editor).
export type FilterDataType =
  | 'money'
  | 'percent'
  | 'number'
  | 'text'
  | 'date'
  | 'enumMulti'
  | 'enumFixed'
  | 'enumSingle'
  | 'flag';

// A single applied filter. `value` shape follows the operator:
//   between → [min, max] · in → string[] · isTrue → '' · otherwise → string.
export interface FilterRow {
  id: string; // stable React key (client-generated on add)
  field: string; // FilterFieldDef.key
  operator: FilterOperator;
  value: string | string[];
}

// One filterable dimension. The catalog (one array per table) drives the
// add-menu grouping, the editor selection, and the chip sentence. `label` /
// `groupLabel` / enum option `label`s arrive already-localized (the catalog is
// built inside a hook with access to next-intl).
export interface FilterFieldDef {
  key: string;
  label: string;
  groupLabel: string;
  dataType: FilterDataType;
  operators: FilterOperator[];
  enumValues?: { value: string; label: string }[];
  unit?: '₺' | '%';
}

// Runtime guard for the nuqs parseAsJson value — a hostile/stale URL must never
// crash the page. Validates each entry's shape and drops anything malformed
// (an unknown operator, a non-string value member, …). Used as the
// parseAsJson reviver so the page degrades to "no filters" on bad input.
export function parseFilterRows(value: unknown): FilterRow[] {
  if (!Array.isArray(value)) return [];
  const rows: FilterRow[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const record: Record<string, unknown> = { ...item };
    const { id, field, operator, value: rowValue } = record;
    if (typeof id !== 'string' || typeof field !== 'string' || !isFilterOperator(operator))
      continue;
    if (typeof rowValue === 'string') {
      rows.push({ id, field, operator, value: rowValue });
    } else if (
      Array.isArray(rowValue) &&
      rowValue.every((entry): entry is string => typeof entry === 'string')
    ) {
      rows.push({ id, field, operator, value: rowValue });
    }
  }
  return rows;
}

// dataType → its allowed operators, in display order. The first entry is the
// default operator a freshly-added chip starts with.
export const DATATYPE_OPERATORS: Record<FilterDataType, readonly FilterOperator[]> = {
  money: ['between', 'gte', 'lte', 'eq'],
  percent: ['between', 'gte', 'lte'],
  number: ['between', 'gte', 'lte', 'eq'],
  text: ['contains', 'equals', 'startsWith'],
  date: ['between', 'gte', 'lte'],
  enumMulti: ['in'],
  enumFixed: ['in'],
  enumSingle: ['eq'],
  flag: ['isTrue'],
};

export function defaultOperatorFor(dataType: FilterDataType): FilterOperator {
  return DATATYPE_OPERATORS[dataType][0];
}

// The empty value a freshly-added chip starts with, per dataType.
export function emptyValueFor(dataType: FilterDataType): FilterRow['value'] {
  return dataType === 'enumMulti' || dataType === 'enumFixed' ? [] : '';
}

// Interpret a range-style chip (money/percent/number/date) as inclusive
// [min, max] bounds. between → both; gte → min only; lte → max only; eq →
// both equal. Blank strings collapse to undefined so an empty side is "open".
export function rangeBounds(row: FilterRow): [string | undefined, string | undefined] {
  const value = row.value;
  const at = (i: number): string | undefined => {
    const raw = Array.isArray(value) ? value[i] : i === 0 ? value : undefined;
    const trimmed = raw?.trim();
    return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
  };
  switch (row.operator) {
    case 'between':
      return [at(0), at(1)];
    case 'gte':
      return [at(0), undefined];
    case 'lte':
      return [undefined, at(0)];
    case 'eq': {
      const v = at(0);
      return [v, v];
    }
    default:
      return [undefined, undefined];
  }
}

// Re-shape a row's value when its operator changes, WITHOUT flipping which side
// a bound lives on. The scalar slot is operator-dependent — it is the MIN for
// gte/eq but the MAX for lte — so naively carrying the string across would turn
// "≤ 90" into "≥ 90". We resolve the real [min, max] from the SOURCE row first
// (rangeBounds reads row.operator), then re-emit per the target operator; a
// bound with no counterpart in the new shape is dropped, never relocated. Text
// operators carry a plain scalar (rangeBounds returns no bounds → the default
// branch preserves the raw string).
export function convertRowValue(row: FilterRow, toOperator: FilterOperator): FilterRow['value'] {
  const [min, max] = rangeBounds(row);
  switch (toOperator) {
    case 'between':
      return [min ?? '', max ?? ''];
    case 'gte':
      return min ?? '';
    case 'lte':
      return max ?? '';
    case 'eq':
      return min ?? max ?? '';
    default:
      return Array.isArray(row.value) ? (row.value[0] ?? '') : row.value;
  }
}

// A numeric bound the API will accept. The editor inputs only set `inputMode`
// (a soft-keyboard HINT — it never restricts typed or pasted characters), so
// without this guard "abc" / "1.2.3" / "50,90" would mark a chip complete, the
// commit would fire, and the backend's decimal/int validator would reject it
// with a 422 the global error layer silences — a chip that looks applied while
// the table silently shows stale data.
function isNumericBound(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && Number.isFinite(Number(trimmed));
}

// A chip is "complete" (worth sending to the API) when it carries a usable
// value — at least one range bound, a non-empty (multi- or single-)select,
// or a set flag.
export function isFilterRowComplete(row: FilterRow, dataType: FilterDataType): boolean {
  if (dataType === 'flag') return row.operator === 'isTrue';
  if (dataType === 'enumMulti' || dataType === 'enumFixed') {
    return Array.isArray(row.value) && row.value.length > 0;
  }
  if (dataType === 'text' || dataType === 'enumSingle') {
    const v = Array.isArray(row.value) ? row.value[0] : row.value;
    return (v?.trim().length ?? 0) > 0;
  }
  const [min, max] = rangeBounds(row);
  const present = [min, max].filter((bound): bound is string => bound !== undefined);
  if (present.length === 0) return false;
  // money / number / percent must be numeric; date bounds are date strings.
  if (dataType === 'money' || dataType === 'number' || dataType === 'percent') {
    return present.every(isNumericBound);
  }
  return true;
}
