// Pure derivations for the claims list endpoint — no Prisma, no I/O.
// Spec: docs/plans/2026-06-11-returns-surface-design.md §5.1.
// Item `status` strings come from Trendyol verbatim (Created /
// WaitingInAction / Accepted / Rejected / Cancelled / ...); only the three
// terminal values participate here because derivation runs on resolved
// claims (resolved === every item terminal — the CLAIMS sync invariant).

export type DerivedClaimStatus = 'OPEN' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'MIXED';
export type ClaimScope = 'FULL' | 'PARTIAL';

export interface ClaimItemForSummary {
  orderItem: { productVariant: { product: { title: string } } | null } | null;
}

export function deriveClaimStatus(
  resolved: boolean,
  itemStatuses: readonly string[],
): DerivedClaimStatus {
  if (!resolved) return 'OPEN';
  const unique = new Set(itemStatuses);
  if (unique.size === 1) {
    if (unique.has('Accepted')) return 'ACCEPTED';
    if (unique.has('Rejected')) return 'REJECTED';
    if (unique.has('Cancelled')) return 'CANCELLED';
  }
  return 'MIXED';
}

// `>=` is defensive: claim units exceeding order units would be a sync
// anomaly; surfacing it as PARTIAL would read as "more to come", FULL is
// the honest ceiling.
export function deriveScope(claimUnitCount: number, orderUnitTotal: number): ClaimScope {
  return claimUnitCount >= orderUnitTotal ? 'FULL' : 'PARTIAL';
}

export function deriveProductSummary(items: readonly ClaimItemForSummary[]): {
  firstName: string | null;
  units: number;
  otherCount: number;
} {
  if (items.length === 0) return { firstName: null, units: 0, otherCount: 0 };
  const groups = new Map<string | null, number>();
  for (const it of items) {
    const title = it.orderItem?.productVariant?.product.title ?? null;
    groups.set(title, (groups.get(title) ?? 0) + 1);
  }
  const first = [...groups.entries()][0];
  if (first === undefined) return { firstName: null, units: 0, otherCount: 0 }; // unreachable (guarded above), keeps TS strict happy without `as`
  return { firstName: first[0], units: first[1], otherCount: groups.size - 1 };
}

export function deriveReasonSummary(reasonNames: readonly string[]): {
  first: string;
  otherCount: number;
} {
  const distinct = [...new Set(reasonNames)];
  return { first: distinct[0] ?? '', otherCount: Math.max(0, distinct.length - 1) };
}
