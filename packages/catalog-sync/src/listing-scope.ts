// Default listing scope of the products surface (design 2026-10-27, section 4):
// a variant that is still in Trendyol's feed (delistedAt IS NULL) and is not
// archived. The products list and its counters (apps/api) and the denormalized
// Product aggregates (refreshProductAggregates) all read this one definition, so
// every number on the products page counts the same variants. A product is
// listed when at least one of its variants matches.

import type { Prisma } from '@pazarsync/db';
import { ProductVariantStatus } from '@pazarsync/db/enums';

export const LISTED_VARIANT_WHERE = {
  delistedAt: null,
  status: { not: ProductVariantStatus.ARCHIVED },
} satisfies Prisma.ProductVariantWhereInput;
