// Reusable, value-side Prisma where fragments for the Advanced Filtering query
// API (PR-B2). Each helper builds the FILTER VALUE — the right-hand side of a
// where field (`{ gte, lte }`, `{ in }`) — not the field itself, so it is
// model-agnostic and shared by the orders + products list services. Field- and
// relation-specific shapes (search OR across columns, relation-existence flags)
// stay inline in each service: forcing them through a generic helper fights
// Prisma's typed where inputs for no real gain.

// Range over a comparable column. Each bound is optional, so one helper covers
// every range operator the chip UI exposes: between (min+max), gte (min only),
// lte (max only), and eq (caller passes min === max). Returns undefined when
// both bounds are absent, so the caller can `if (r) where.field = r` without
// emitting an empty filter. Generic over T → serves Decimal (money/percent),
// number (stock/desi), and Date (date ranges) alike.
export function rangeWhere<T>(
  min: T | undefined,
  max: T | undefined,
): { gte?: T; lte?: T } | undefined {
  if (min === undefined && max === undefined) return undefined;
  return {
    ...(min !== undefined ? { gte: min } : {}),
    ...(max !== undefined ? { lte: max } : {}),
  };
}

// Multi-value enum membership (`{ in: [...] }`). Returns undefined for an absent
// or empty list — an empty `{ in: [] }` matches nothing and would silently
// empty the table, which is never what an omitted filter is meant to do.
export function enumInWhere<T>(values: readonly T[] | undefined): { in: T[] } | undefined {
  if (values === undefined || values.length === 0) return undefined;
  return { in: [...values] };
}
