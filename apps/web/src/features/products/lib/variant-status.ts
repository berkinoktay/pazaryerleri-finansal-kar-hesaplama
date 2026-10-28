import { ProductVariantStatus } from '@pazarsync/db/enums';

/**
 * The chip a variant carries under its stock count in the products table.
 *
 * ON_SALE gets no chip: selling is the normal state, and a chip on every row
 * would bury the rows that need attention. NOT_ON_SALE is split by stock
 * because the seller's next step differs: an out-of-stock variant needs
 * restocking, while a variant that still has stock was closed for sale and
 * needs reopening.
 */
export type VariantStatusBadgeKind =
  | 'outOfStock'
  | 'closed'
  | 'locked'
  | 'blacklisted'
  | 'archived';

export function variantStatusBadgeKind(variant: {
  status: ProductVariantStatus;
  quantity: number;
}): VariantStatusBadgeKind | null {
  switch (variant.status) {
    case ProductVariantStatus.ON_SALE:
      return null;
    case ProductVariantStatus.NOT_ON_SALE:
      return variant.quantity === 0 ? 'outOfStock' : 'closed';
    case ProductVariantStatus.LOCKED:
      return 'locked';
    case ProductVariantStatus.BLACKLISTED:
      return 'blacklisted';
    case ProductVariantStatus.ARCHIVED:
      return 'archived';
    default: {
      const _exhaustive: never = variant.status;
      throw new Error(`Unhandled product variant status: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Lock / blacklist reason codes Trendyol sends in its undocumented
 * `lockReason` / `blacklistReason` fields (observed on stage, carried to the
 * wire as `statusReason`). Each one has a sentence under
 * `products.statusReasons.<code>`. Any other code keeps the badge as a plain
 * label, because there is no vetted explanation to show for it.
 */
export const KNOWN_STATUS_REASONS = [
  'CRITICAL_SALE_PRICE_CHANGE',
  'UNSUPPLIED_PRODUCT',
  'LOW_SALE_PRICING',
  'UNAPPROVED_BRAND_CATEGORY_SPM',
] as const;

export type KnownStatusReason = (typeof KNOWN_STATUS_REASONS)[number];

const KNOWN_STATUS_REASON_SET: ReadonlySet<string> = new Set(KNOWN_STATUS_REASONS);

export function isKnownStatusReason(value: string | null): value is KnownStatusReason {
  return value !== null && KNOWN_STATUS_REASON_SET.has(value);
}
