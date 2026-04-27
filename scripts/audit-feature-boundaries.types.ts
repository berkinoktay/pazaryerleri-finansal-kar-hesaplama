/**
 * Types for the feature-boundary audit.
 *
 * The audit walks `apps/web/src/features/<X>/...` and detects when one feature
 * imports from another (`@/features/<Y>/...`). Such an edge is a candidate for
 * promotion to a shared location (`apps/web/src/lib/`,
 * `apps/web/src/components/patterns/`, or `packages/utils/`).
 *
 * The decision of whether a given edge is a hard error, a soft warning, or an
 * accepted exception lives in `audit-feature-boundaries.config.ts` — that file
 * is the single source of truth for policy.
 */

export type Severity = 'error' | 'warn' | 'allow';

export interface CrossFeatureImport {
  /** Feature folder the importing file lives in (e.g. "stores") */
  sourceFeature: string;
  /** Feature folder the import points to (e.g. "organization") */
  targetFeature: string;
  /** True when the statement is `import type ...` (no runtime dependency) */
  isTypeOnly: boolean;
  /** Path string from the import statement, e.g. `@/features/organization/api/organizations.api` */
  importPath: string;
  /** Absolute path of the file containing the import */
  file: string;
  /** 1-based line number of the import statement */
  line: number;
}

export interface ViolationDecision {
  severity: Severity;
  /** English short reason printed in the report; localized copy is not needed here */
  message: string;
}

export interface AuditReport {
  scanned: number;
  edges: CrossFeatureImport[];
  errors: Array<CrossFeatureImport & { decision: ViolationDecision }>;
  warnings: Array<CrossFeatureImport & { decision: ViolationDecision }>;
  allowed: Array<CrossFeatureImport & { decision: ViolationDecision }>;
}
