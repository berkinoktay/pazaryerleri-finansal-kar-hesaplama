// The SINGLE input resolver for Kampanyalar (seller participation in Trendyol-designed
// campaigns): for every campaign item it resolves, in one batch pass, everything a campaign
// price scenario needs -- the matched variant's scenario base (cost, shipping, fees, VAT,
// desi, from the shared engine loader), the first product image, and the three-tier
// commission chain inputs (tariff band, synced product rate, category rate fallback).
//
// Why one module: this is the INPUT side of the "the modal must not disagree with the row"
// invariant. If the detail view and the estimate / target-margin services each resolved
// their own inputs -- which they did for a while -- adding a chain tier, changing when a band
// counts, or moving the anchor would touch only ONE side and the other would silently keep
// the old chain, with no test failing. One resolver makes that drift structurally impossible.
//
// No financial math lives here: it only gathers data. The math is in
// `marketplace-campaign-compute.service.ts`. Every query filters by organizationId + storeId
// (tenant isolation).

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import type { Prisma, Store as PrismaStore } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';

import { resolveDiscountCommissionSource } from './discount-commission-source';
import type { DiscountCommissionInputs } from './discount-math-commons';
import {
  loadScreenScenarioBases,
  screenScenarioBaseFor,
  resolveCategoryRatesByKey,
  categoryRateKey,
} from './scenario-screen-commons';
import type { ScreenScenarioBase } from './scenario-screen-commons';

/** One item's resolved pricing inputs. */
export interface CampaignItemEconomics {
  /** How the matched variant reaches the engine: ready / no-product / degraded. */
  readonly base: ScreenScenarioBase;
  /** The product's first image -- every product surface shows an image (project rule). */
  readonly imageUrl: string | null;
  /** The three-tier chain inputs: tariff band -> synced product rate -> category rate. */
  readonly commission: DiscountCommissionInputs;
}

/** The batch resolution: per-item inputs + tariff-source transparency. */
export interface CampaignEconomics {
  readonly byItemId: ReadonlyMap<string, CampaignItemEconomics>;
  /** The commission tariff + period that fed the bands; null when no covering week. */
  readonly tariffName: string | null;
  readonly periodLabel: string | null;
  /** True only when the store has tariffs but none covers the anchor; false with no tariffs. */
  readonly tariffOutdated: boolean;
}

/** The only per-item fields the resolution needs: identity, variant link and barcode. */
export interface CampaignEconomicsRow {
  readonly id: string;
  readonly productVariantId: string | null;
  readonly barcode: string;
}

/** The slim variant columns the chain + display need (the scenario base carries the rest). */
interface CampaignVariantRow {
  id: string;
  syncedCommissionRate: Prisma.Decimal | null;
  product: {
    categoryId: bigint | null;
    brandId: bigint | null;
    imageUrls: string[];
  };
}

/**
 * Resolves the pricing inputs of the given items in ONE batch pass.
 *
 * In order: the matched variants (synced commission rate + category/brand + first image) in a
 * slim query, the per-variant scenario bases from the shared engine loader at `scenarioDate`,
 * the commission tariff bands anchored to `anchor` (the campaign start, or null for "now"),
 * and one category-rate fallback per distinct (category, brand) pair.
 *
 * Bands come ONLY from a tariff week that COVERS the anchor instant -- no covering week means
 * no bands and the chain falls to the product/category rate. The resolver is SHARED with
 * Indirimler (`resolveDiscountCommissionSource`); this vertical adds no resolver of its own.
 *
 * The image is fetched on EVERY call regardless of item count. The single-item estimate call
 * does not use it, but a conditional select would mean two query shapes and this module's
 * whole point is one shape; the cost is a negligible lateral join alongside the variant read.
 */
export async function resolveCampaignEconomics(
  orgId: string,
  storeId: string,
  store: PrismaStore,
  anchor: Date | null,
  scenarioDate: Date,
  items: ReadonlyArray<CampaignEconomicsRow>,
): Promise<CampaignEconomics> {
  const variantIds = items.map((i) => i.productVariantId).filter((id): id is string => id !== null);

  const variantMap = new Map<string, CampaignVariantRow>();
  if (variantIds.length > 0) {
    let variants;
    try {
      variants = await prisma.productVariant.findMany({
        where: { id: { in: variantIds }, organizationId: orgId, storeId },
        select: {
          id: true,
          syncedCommissionRate: true,
          product: { select: { categoryId: true, brandId: true, imageUrls: true } },
        },
      });
    } catch (err) {
      mapPrismaError(err);
    }
    for (const variant of variants) {
      variantMap.set(variant.id, variant);
    }
  }

  // One scenario-base load for the whole request; the screen passes its own rate as the
  // engine override, so the base carries no tariff lookup (anchor null inside the loader).
  const bases = await loadScreenScenarioBases({
    organizationId: orgId,
    storeId,
    scenarioDate,
    variantIds,
    surface: 'marketplace-campaign',
  });

  const { resolution: source, outdated } = await resolveDiscountCommissionSource(
    orgId,
    storeId,
    anchor,
    scenarioDate,
  );

  // Category-rate fallback (3rd tier) -- resolved once per distinct (category, brand) pair.
  const categoryRateByKey = await resolveCategoryRatesByKey({
    platform: store.platform,
    refs: [...variantMap.values()].map((variant) => variant.product),
  });

  const byItemId = new Map<string, CampaignItemEconomics>();
  for (const item of items) {
    const variantRow =
      item.productVariantId !== null ? variantMap.get(item.productVariantId) : undefined;
    const categoryRate =
      variantRow !== undefined && variantRow.product.categoryId !== null
        ? (categoryRateByKey.get(
            categoryRateKey(variantRow.product.categoryId, variantRow.product.brandId),
          ) ?? null)
        : null;

    byItemId.set(item.id, {
      base: screenScenarioBaseFor(bases, item.productVariantId),
      imageUrl: variantRow?.product.imageUrls[0] ?? null,
      commission: {
        // The item's own `hasCommissionTariff` flag is Trendyol's claim ABOUT the file, not
        // what the store actually uploaded -- the lookup never binds to it; the band map is
        // the single truth.
        bands: source?.bandsByBarcode.get(item.barcode) ?? null,
        productRate:
          variantRow !== undefined && variantRow.syncedCommissionRate !== null
            ? new Decimal(variantRow.syncedCommissionRate.toString())
            : null,
        categoryRate,
      },
    });
  }

  return {
    byItemId,
    tariffName: source?.tariffName ?? null,
    periodLabel: source?.periodLabel ?? null,
    tariffOutdated: outdated,
  };
}

/** A no-match item resolved to empty inputs, queryless -- the fallback for unmatched rows. */
export const EMPTY_ITEM_ECONOMICS: CampaignItemEconomics = {
  base: { kind: 'no-product' },
  imageUrl: null,
  commission: { bands: null, productRate: null, categoryRate: null },
};
