export type Severity = 'error';

/** A single numeric-coercion hit inside the Decimal-only money core. */
export interface MoneyViolation {
  severity: Severity;
  /** Repo-relative path. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column of the matched token. */
  column: number;
  /** The coercion token that matched (e.g. `Number(`, `parseFloat(`, `unary +`). */
  pattern: string;
  /** The trimmed source line, for context. */
  snippet: string;
  message: string;
}

export interface MoneyAuditReport {
  /** Repo-relative roots that were scanned. */
  roots: string[];
  /** How many .ts source files were read. */
  scannedFiles: number;
  violations: MoneyViolation[];
}
