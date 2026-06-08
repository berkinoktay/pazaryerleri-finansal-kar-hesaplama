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
 *      shared contract: if web and api both consume it, its home is
 *      `@pazarsync/api-client` (generated from the backend OpenAPI spec); if
 *      only web consumes it, a shared module under `apps/web/src/lib/`. Treating
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
  // The `sync` feature is an audited cross-feature provider, by design.
  // OrgSyncsProvider is mounted once at the dashboard layout and every
  // domain page (products today, orders / settlements next) consumes
  // `useStoreSyncs(storeId)` to project the org-wide subscription onto
  // its surface. Promoting these to `lib/` would dilute the feature
  // boundary the other way (the api layer + provider + hooks belong
  // together as one slice). The shared `SyncLog` type is sourced from
  // `@pazarsync/api-client` schemas inside the feature; downstream
  // consumers re-export rather than reach into the api file directly.
  // See docs/plans/2026-04-27-sync-engine-architecture-design.md.
  if (imp.targetFeature === 'sync') {
    return {
      severity: 'allow',
      message: `Cross-feature consumption of the "sync" feature is permitted by design (org-wide subscription provider mounted at the dashboard layout)`,
    };
  }

  // The `costs` feature is an audited cross-feature provider, by design.
  // Cost profiles are org-scoped primitives consumed by `products` (cost cell
  // + popover), `dashboard` (missing-cost widget), `orders`, and `settlements`.
  // Promoting hooks into `lib/` would break the vertical-slice cohesion of the
  // feature — the api layer + hooks + types belong together under `features/costs`.
  // Cross-feature consumers import hooks only (never api/, lib/, or components/
  // internals) from `@/features/costs/hooks/...`. This mirrors the `sync` precedent.
  // See docs/superpowers/specs/2026-05-09-cost-profiles-design.md §2 implicit decisions.
  if (imp.targetFeature === 'costs') {
    return {
      severity: 'allow',
      message: `Cross-feature consumption of the "costs" feature is permitted by design (org-wide reusable cost primitives).`,
    };
  }

  // The `shipping` feature is an audited cross-feature provider, by design.
  // The shipping config is a store-scoped primitive consumed by `stores`
  // (settings page embeds the carrier picker form) and `products` (the
  // Tahmini Net Kar column reads the estimate / carrier chip / popover
  // states piped through the products list response). Promoting hooks or
  // components into `lib/` / `patterns/` would split the slice across three
  // homes for a feature that owns a single coherent domain — config GET/PATCH,
  // 5-state estimate rendering, and the own-contract empty state belong
  // together. Cross-feature consumers import only from `hooks/`, `lib/`,
  // and `components/` public surfaces — never `api/` directly. Mirrors the
  // `sync` and `costs` precedents.
  // See docs/superpowers/specs/2026-05-17-shipping-cost-estimation-design.md §7.3.
  if (imp.targetFeature === 'shipping') {
    return {
      severity: 'allow',
      message: `Cross-feature consumption of the "shipping" feature is permitted by design (store-scoped reusable shipping primitives).`,
    };
  }

  // `live-performance` reuses the canonical `orders` detail view (OrderDetailClient
  // in a modal/Sheet chrome) for the in-page order detail. PAIR-SPECIFIC, audited
  // exception: ONLY live-performance may import from orders - every other source
  // still errors. If a THIRD feature needs the order detail, do NOT widen this
  // rule; promote OrderDetailClient (or an extracted read-only panel) to
  // components/patterns/ instead.
  // See docs/superpowers/specs/2026-06-05-live-performance-slice-c-order-detail-design.md s1.
  if (imp.targetFeature === 'orders' && imp.sourceFeature === 'live-performance') {
    return {
      severity: 'allow',
      message: `order detail modal reuses the canonical orders detail view (live-performance -> orders, audited)`,
    };
  }

  if (imp.isTypeOnly) {
    return {
      severity: 'warn',
      message: `Type imported from "${imp.targetFeature}" into "${imp.sourceFeature}" - move the shared type to @pazarsync/api-client (web+api) or apps/web/src/lib/ (web-only)`,
    };
  }
  return {
    severity: 'error',
    message: `Runtime import from "${imp.targetFeature}" into "${imp.sourceFeature}" crosses a feature boundary - promote the symbol to apps/web/src/lib/ (utils) or apps/web/src/components/patterns/ (components)`,
  };
}
