import { prisma } from './db';

/**
 * Seller-input history fixture helpers (same-day edit window, plan P1-06). The
 * history triggers stamp every desi change and every direct link delete with the
 * transaction instant. A test that seeds a past-dated order and then arranges its
 * fixture with a desi UPDATE or a link DELETE gets a log row stamped now, after that
 * order's business-day end, so the day-end reconstruction returns the value from
 * before the arrangement. These helpers tell the logs what the arrangement meant.
 * The worker suite imports them too.
 */

/**
 * Deletes the organization's rows from both seller-input history logs: "the writes
 * so far were fixture setup, not history".
 */
export async function clearSellerInputHistory(organizationId: string): Promise<void> {
  await prisma.costLinkRemoval.deleteMany({ where: { organizationId } });
  await prisma.variantDesiChange.deleteMany({ where: { organizationId } });
}

/**
 * Restamps the organization's seller-input history rows (`detached_at`,
 * `changed_at`) to `at`: "the writes so far happened at `at`".
 */
export async function backdateSellerInputHistory(organizationId: string, at: Date): Promise<void> {
  await prisma.costLinkRemoval.updateMany({
    where: { organizationId },
    data: { detachedAt: at },
  });
  await prisma.variantDesiChange.updateMany({
    where: { organizationId },
    data: { changedAt: at },
  });
}
