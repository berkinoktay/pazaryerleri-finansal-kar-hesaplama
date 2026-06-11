import { parseAsInteger, parseAsString, parseAsStringEnum } from 'nuqs';

// Single source of truth for the URL ↔ React Query state binding on the
// returns page. Mirrors the backend's listClaimsQuerySchema — when the
// backend gains a new filter, add the parser here and the rest of the
// page reacts automatically.

export const CLAIM_STATUS_TABS = ['all', 'open', 'resolved'] as const;
export type ClaimStatusTabValue = (typeof CLAIM_STATUS_TABS)[number];

/** The wire values — `all` is a UI-only tab that maps to an ABSENT param. */
export type ClaimStatusFilterValue = Exclude<ClaimStatusTabValue, 'all'>;

export const RETURNS_PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;

// Empty string in the parsers means "no filter". Date parsers store ISO date
// strings (YYYY-MM-DD) — full date-time is unnecessary; the backend coerces
// to Date at the boundary.
export const returnsFiltersParsers = {
  q: parseAsString.withDefault(''),
  status: parseAsStringEnum<ClaimStatusTabValue>([...CLAIM_STATUS_TABS]).withDefault('all'),
  from: parseAsString.withDefault(''),
  to: parseAsString.withDefault(''),
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(25),
};

export interface ReturnsFilters {
  q: string;
  status: ClaimStatusTabValue;
  from: string;
  to: string;
  page: number;
  perPage: number;
}
