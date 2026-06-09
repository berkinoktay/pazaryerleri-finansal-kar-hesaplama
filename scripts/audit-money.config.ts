/**
 * Tuning knobs for `scripts/audit-money.ts`.
 *
 * The money gate scans the Decimal-only profit core for numeric-coercion
 * tokens that escape decimal.js (`Number(`, `parseFloat(`, `parseInt(`,
 * `.toNumber(`, and unary `+`). Money math MUST stay in Decimal end to end;
 * a single coercion in this surface silently reintroduces floating-point
 * error into the product's core promise ("how much did I actually make?").
 *
 * ROOTS is intentionally narrow. apps/api services legitimately coerce
 * integer row counts (`Number(row.profile_count)`) and the desi weight tier
 * (`Math.ceil(desi.toNumber())`) -- neither is money, both would be false
 * positives. Widen ROOTS only alongside an ALLOWED entry for each non-money
 * coercion you drag in.
 *
 * To exempt a genuinely-legitimate coercion, add an ALLOWED entry keyed by
 * repo-relative file + 1-based line, with a reason. An audited exception in
 * this file beats an unaudited `// eslint-disable` in the source.
 *
 * Policy lives here; the runner (`audit-money.ts`) does not change to tune.
 */

/** Repo-relative directories scanned recursively for `*.ts` (excluding tests). */
export const ROOTS = ['packages/profit/src', 'packages/order-sync/src'] as const;

export interface AllowedCoercion {
  /** Repo-relative path, exactly as the runner reports it. */
  readonly file: string;
  /** 1-based line number of the coercion to exempt. */
  readonly line: number;
  /** Why this coercion is not a money bug (non-money integer, index, etc.). */
  readonly reason: string;
}

/**
 * Audited exemptions. Empty today: the money core is coercion-free, which is
 * exactly the invariant this gate pins. Add entries here (never silence in
 * source) if a legitimate non-money coercion ever lands in ROOTS.
 */
export const ALLOWED: readonly AllowedCoercion[] = [] as const;
