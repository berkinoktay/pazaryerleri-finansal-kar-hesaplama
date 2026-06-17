import type { Prisma } from '@pazarsync/db';

import type { OrderListItemResponse } from '../validators/order.validator';

/**
 * Wire shape for a single promotion display (spec ekleme #3). Identical across
 * the order list, the order detail, and the live-performance feed — they all
 * read the same `Order.promotionDisplays` JSON column.
 */
export type PromotionDisplayWire = NonNullable<OrderListItemResponse['promotionDisplays']>[number];

function isPromotionDisplay(value: unknown): value is PromotionDisplayWire {
  return (
    typeof value === 'object' &&
    value !== null &&
    'displayName' in value &&
    typeof value.displayName === 'string' &&
    'amountGross' in value &&
    typeof value.amountGross === 'string'
  );
}

/**
 * Coerce the stored `Order.promotionDisplays` JSON to the wire shape. The column
 * is `Json?` (the order upsert writes `[{ displayName, amountGross }]` or leaves
 * it null); we runtime-validate each element and drop malformed ones rather than
 * trusting the raw JSON. Empty/absent → null (the frontend hides the promotion
 * line / indicator). Single source of truth for every surface that serves
 * promotion names.
 */
export function toPromotionDisplays(value: Prisma.JsonValue | null): PromotionDisplayWire[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const displays = value.filter(isPromotionDisplay);
  return displays.length > 0 ? displays : null;
}
