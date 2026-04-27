/**
 * Policy for the feature-boundary audit.
 *
 * The audit script collects every `@/features/<X>/...` -> `@/features/<Y>/...`
 * edge in the codebase. For each one, this function decides:
 *
 *   - 'error' -> fail the build (CI / pre-push); forces the import to be
 *                promoted before merge
 *   - 'warn'  -> log but do not fail; appropriate for transitional periods or
 *                for less-strict signals (e.g. type-only imports)
 *   - 'allow' -> silently permitted; reserved for explicit, audited exceptions
 *
 * Current policy (intentionally strict):
 *
 *   1. Runtime cross-feature imports are errors. They imply that two features
 *      share runtime logic, which means the symbol does not belong to either
 *      feature - it belongs in `apps/web/src/lib/` (utils/hooks) or
 *      `apps/web/src/components/patterns/` (components).
 *
 *   2. Type-only cross-feature imports are warnings. A shared type is a
 *      shared contract, and the long-term home for it is `packages/types/`
 *      (web + api) or a shared module under `apps/web/src/lib/`. Treating
 *      these as warnings creates a backlog without blocking PRs that simply
 *      reference an existing shape.
 *
 *   3. There are no aggregator exemptions. Even features like `dashboard`
 *      that compose data from multiple domains should compose at the API
 *      layer (a dedicated dashboard endpoint), not by reaching into another
 *      feature's source. Add an explicit `'allow'` here only after a
 *      conscious architectural decision, with a comment naming the reason.
 *
 * To tune strictness, edit this function. The audit script does not need to
 * change.
 */

import type { CrossFeatureImport, ViolationDecision } from './audit-feature-boundaries.types';

export function evaluateCrossFeatureImport(imp: CrossFeatureImport): ViolationDecision {
  if (imp.isTypeOnly) {
    return {
      severity: 'warn',
      message: `Type imported from "${imp.targetFeature}" into "${imp.sourceFeature}" - move the shared type to packages/types/ or apps/web/src/lib/`,
    };
  }
  return {
    severity: 'error',
    message: `Runtime import from "${imp.targetFeature}" into "${imp.sourceFeature}" crosses a feature boundary - promote the symbol to apps/web/src/lib/ (utils) or apps/web/src/components/patterns/ (components)`,
  };
}
