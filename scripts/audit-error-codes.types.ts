/**
 * Types for the error-code drift audit.
 *
 * The audit reads four loosely-coupled lists of RFC 7807 / domain error
 * codes spread across the backend, the frontend toast pipeline, and the
 * i18n translations, then reports any mismatches between them. Each
 * mismatch is a candidate for either a missing translation, an orphaned
 * key, or a code drift between the API and the consumers.
 *
 * The decision of whether a given mismatch is a hard error or a soft
 * warning is encoded in the runner against the policy in
 * `audit-error-codes.config.ts`. To tune strictness, edit the config —
 * the runner does not need to change.
 */

export type Severity = 'error' | 'warn';

/**
 * A single drift edge — one specific kind of mismatch between two
 * sources. Each edge carries enough context to point a reader at both
 * sources of truth and explain what's missing on which side.
 */
export interface ErrorCodeViolation {
  severity: Severity;
  /**
   * Identifier for the kind of drift, e.g.
   * `missing_translation` / `language_drift` / `orphaned_translation`.
   * Stable across runs — useful for snapshot diffs in CI.
   */
  kind: string;
  /** The error code that's misaligned (e.g. `'MARKETPLACE_AUTH_FAILED'`). */
  code: string;
  /** Human-readable explanation, English. */
  message: string;
}

export interface AuditReport {
  /** Names of the source files the audit read, for the report header. */
  sources: string[];
  errors: ErrorCodeViolation[];
  warnings: ErrorCodeViolation[];
}
