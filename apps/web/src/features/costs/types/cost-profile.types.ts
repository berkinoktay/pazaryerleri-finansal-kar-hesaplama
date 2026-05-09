/**
 * Shared types for the costs feature slice.
 *
 * Re-exports API shapes from @pazarsync/api-client and domain enums from
 * @pazarsync/db/enums — single source of truth, no string-literal duplicates
 * per feedback_no_string_literal_enum_duplicates.
 */

import type { components } from '@pazarsync/api-client';

// ─── Domain enums (from Prisma-generated enums) ────────────────────────
// Never redeclare as string literals — the enum VALUES live exactly once
// in schema.prisma and flow here after `pnpm db:generate`.
export { CostProfileType, Currency, FxRateMode } from '@pazarsync/db/enums';

export type { CostProfileType as CostProfileTypeValue } from '@pazarsync/db/enums';

// ─── API response / request shapes ────────────────────────────────────
export type CostProfile = components['schemas']['CostProfile'];
export type CostProfileVersion = components['schemas']['CostProfileVersion'];
export type AttachedVariant = components['schemas']['AttachedVariant'];
export type CreateCostProfileInput = components['schemas']['CreateCostProfileInput'];
export type UpdateCostProfileInput = components['schemas']['UpdateCostProfileInput'];
export type ListCostProfilesResponse = components['schemas']['ListCostProfilesResponse'];
export type ListCostProfileVersionsResponse =
  components['schemas']['ListCostProfileVersionsResponse'];
export type ListAttachedVariantsResponse = components['schemas']['ListAttachedVariantsResponse'];
export type DetachResponse = components['schemas']['DetachResponse'];
export type CursorMeta = components['schemas']['CursorMeta'];

// ─── List filter shape ─────────────────────────────────────────────────
export interface ListCostProfileFilters {
  type?: string;
  archived?: 'true' | 'false';
  q?: string;
  cursor?: string;
  limit?: number;
}
