import type { Organization } from '@/features/organization/api/organizations.api';

/**
 * Whether a role may push a live price to the marketplace. Mirrors the backend
 * gate in `update-price.routes.ts` (`role !== 'OWNER' && role !== 'ADMIN'` →
 * 403): only OWNER/ADMIN may perform this irreversible write. This is UX gating
 * only — the backend remains the source of truth and 403s a MEMBER/VIEWER that
 * calls the endpoint directly.
 *
 * Note this is intentionally stricter than the `data:write` capability (granted
 * to MEMBER+): a live, one-per-day, irreversible price change is restricted to
 * the two highest roles by the owner's decision, not the generic write gate.
 */
export function canWriteMarketplacePrice(role: Organization['role']): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}
