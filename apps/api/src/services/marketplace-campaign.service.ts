// Read / update / selection / delete service for the Kampanyalar (Trendyol-designed
// campaign participation) feature.
//
// list       -> one row per saved campaign (config fields incl. the Trendyol funding rate,
//              item + selected counts, exported flag).
// detail     -> the campaign with its items (sortOrder asc), each carrying the THREE price
//              scenarios (current / max / custom) plus the basket settlement block.
// update     -> full-replace of the config fields on the campaign row (name only if given).
// selections -> bulk write of the per-item price choice: mode 'set' (per row), 'all' (MAX),
//              'none' (clear).
// delete     -> hard delete (cascades to items via the schema FK).
//
// The İndirimler sibling (`discount-list.service.ts`) is the structural template; the two
// differences are that a campaign item has three scenarios instead of two and that the
// campaign's Trendyol funding rate rides into the compute. The commission source is resolved
// by the SHARED `resolveDiscountCommissionSource` — this vertical adds no resolver of its own.
//
// Every query is scoped by organizationId + storeId (tenant isolation). Money is serialized to
// GROSS decimal strings at the DTO edge; the frontend renders, never computes.

import { Decimal } from 'decimal.js';

import { Prisma, prisma } from '@pazarsync/db';
import type { DiscountType, Store as PrismaStore } from '@pazarsync/db';
import { CampaignPriceSelection } from '@pazarsync/db/enums';
import { mapPrismaError } from '@pazarsync/sync-core';

import { NotFoundError, ValidationError, type ValidationIssue } from '../lib/errors';
import { assertScopedWrite } from '../workbooks/scoped-write';
import { scenarioPresentation } from './discount-math-commons';
import { computeCampaignItem } from './marketplace-campaign-compute.service';
import { resolveCampaignEconomics, EMPTY_ITEM_ECONOMICS } from './marketplace-campaign-economics';
import { createRequestFailureLog, serializeCommissionBandLadder } from './scenario-screen-commons';
import {
  campaignConfigFromListRow,
  isCampaignDiscountType,
  type CampaignCommissionBand,
  type CampaignSelection,
  type CampaignWireDiscountType,
  type MarketplaceCampaignDetail,
  type MarketplaceCampaignDetailItem,
  type MarketplaceCampaignListItem,
  type UpdateMarketplaceCampaignBody,
} from '../validators/marketplace-campaign.validator';

/** Reduces a string config field to the list row's Int column (null when absent). */
function intOrNull(value: string | undefined): number | null {
  return value === undefined ? null : Number(value);
}

/**
 * Narrows the SHARED `DiscountType` column down to the five types Kampanyalar exposes on
 * the wire. The write path (`MarketplaceCampaignConfigFieldsSchema`) cannot produce a CODE
 * row, but the column is the six-member enum shared with İndirimler and cannot express
 * "five of six" — so a row read back needs an explicit narrowing (`as` is banned repo-wide).
 * Throwing mirrors `campaignConfigFromListRow`: a hand-edited or migrated CODE row is a data
 * bug, and answering with a silently wrong discount type would be worse than a 500.
 */
function toWireDiscountType(value: DiscountType, campaignId: string): CampaignWireDiscountType {
  if (!isCampaignDiscountType(value)) {
    throw new Error(
      `Marketplace campaign ${campaignId} carries an unsupported discount type: ${value}. ` +
        'Kampanyalar only supports NET, CONDITIONAL_BASKET, CONDITIONAL_QUANTITY, ' +
        'BUY_X_PAY_Y, NTH_PRODUCT — CODE is İndirimler-only.',
    );
  }
  return value;
}

// --- List ---
/** Lists every saved campaign for a store with item + selected counts. */
export async function listMarketplaceCampaigns(
  orgId: string,
  storeId: string,
): Promise<MarketplaceCampaignListItem[]> {
  // Counts stay in the database: `_count` for the total and a `groupBy` for the selected total
  // per campaign — no item row crosses the ORM boundary just to be counted. Both are
  // store-scoped; the groupBy only returns campaigns with >= 1 chosen item, so a campaign
  // absent from it has zero selected.
  let result;
  try {
    result = await Promise.all([
      prisma.marketplaceCampaignList.findMany({
        where: { organizationId: orgId, storeId },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          discountType: true,
          valueKind: true,
          value: true,
          minBasketAmount: true,
          minQuantity: true,
          buyQuantity: true,
          payQuantity: true,
          nthIndex: true,
          trendyolFundingPct: true,
          startsAt: true,
          endsAt: true,
          exportedAt: true,
          updatedAt: true,
          _count: { select: { items: true } },
        },
      }),
      prisma.marketplaceCampaignItem.groupBy({
        by: ['listId'],
        where: {
          organizationId: orgId,
          storeId,
          selection: { not: CampaignPriceSelection.NONE },
        },
        _count: true,
      }),
    ]);
  } catch (err) {
    mapPrismaError(err);
  }

  const [lists, selectedGroups] = result;
  const selectedByListId = new Map<string, number>();
  for (const group of selectedGroups) {
    selectedByListId.set(group.listId, group._count);
  }

  return lists.map((list): MarketplaceCampaignListItem => {
    return {
      id: list.id,
      name: list.name,
      discountType: toWireDiscountType(list.discountType, list.id),
      valueKind: list.valueKind,
      value: list.value !== null ? list.value.toFixed(2) : null,
      minBasketAmount: list.minBasketAmount !== null ? list.minBasketAmount.toFixed(2) : null,
      minQuantity: list.minQuantity,
      buyQuantity: list.buyQuantity,
      payQuantity: list.payQuantity,
      nthIndex: list.nthIndex,
      trendyolFundingPct: list.trendyolFundingPct.toFixed(2),
      startsAt: list.startsAt !== null ? list.startsAt.toISOString() : null,
      endsAt: list.endsAt !== null ? list.endsAt.toISOString() : null,
      itemCount: list._count.items,
      selectedCount: selectedByListId.get(list.id) ?? 0,
      exported: list.exportedAt !== null,
      updatedAt: list.updatedAt.toISOString(),
    };
  });
}

// --- Detail ---
/** Serializes a computed scenario (Decimal price) to the wire scenario (money 2dp). */
function serializeScenario(
  s: ReturnType<typeof computeCampaignItem>['current'],
): MarketplaceCampaignDetailItem['current'] {
  return {
    price: s.price.toFixed(2),
    commissionPct: s.commissionPct,
    commissionSource: s.commissionSource,
    netProfit: s.netProfit,
    marginPct: s.marginPct,
  };
}

/**
 * Returns one campaign with its items, each carrying the three price SCENARIOS computed on
 * read. Throws `NotFoundError` when it does not belong to this store. Resolves the store's
 * commission tariff bands anchored to the campaign start, batch-loads the matched variants +
 * their synced commission + cost + shipping + a category-rate fallback, then runs the
 * three-tier commission chain per item.
 *
 * The campaign's `trendyolFundingPct` rides into every scenario: it decides how much of the
 * campaign discount Trendyol absorbs and therefore what the seller's settlement base is.
 *
 * Each price option carries its OWN basket/order block (`maxBasket`, `customBasket`) — on an
 * ORDER-presentation row both price cards headline their own order, whichever option the seller
 * has marked, so the persisted `selection` does not enter the compute.
 *
 * Money math is Decimal, serialized at the DTO edge (the frontend never computes).
 */
export async function getMarketplaceCampaignDetail(
  orgId: string,
  storeId: string,
  store: PrismaStore,
  campaignId: string,
): Promise<MarketplaceCampaignDetail> {
  let list;
  try {
    list = await prisma.marketplaceCampaignList.findFirst({
      where: { id: campaignId, organizationId: orgId, storeId },
      select: {
        id: true,
        name: true,
        discountType: true,
        valueKind: true,
        value: true,
        minBasketAmount: true,
        minQuantity: true,
        buyQuantity: true,
        payQuantity: true,
        nthIndex: true,
        trendyolFundingPct: true,
        startsAt: true,
        endsAt: true,
        exportedAt: true,
        items: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            productVariantId: true,
            barcode: true,
            productCode: true,
            externalId: true,
            productTitle: true,
            brand: true,
            color: true,
            size: true,
            category: true,
            stock: true,
            currentPrice: true,
            maxPrice: true,
            hasCommissionTariff: true,
            selection: true,
            customPrice: true,
          },
        },
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  if (list === null) {
    throw new NotFoundError('MarketplaceCampaign', campaignId);
  }

  const config = campaignConfigFromListRow(list);
  const fundingPct = new Decimal(list.trendyolFundingPct.toString());
  const now = new Date();

  // Every priced input — matched variant scenario base, image and the three commission tiers
  // anchored to the campaign start — comes from the SHARED resolver, the same one the estimate
  // and target-margin services call. The detail layers only its own presentation extras (the
  // band ladder below) on top; it never forks the resolution, so the modal cannot end up on a
  // different chain than the row.
  const economics = await resolveCampaignEconomics(
    orgId,
    storeId,
    store,
    list.startsAt,
    now,
    list.items,
  );

  // A per-item engine throw degrades only that item; collect and log once (decision 9).
  const failureLog = createRequestFailureLog({
    surface: 'marketplace-campaign',
    organizationId: orgId,
  });

  const items = list.items.map((item): MarketplaceCampaignDetailItem => {
    const inputs = economics.byItemId.get(item.id) ?? EMPTY_ITEM_ECONOMICS;
    const { base, commission } = inputs;

    // The band ladder surfaced to the UI popover ("which band does this price land in?").
    // Reuses the bands ALREADY resolved for the compute — no extra query. Money at 2 decimals,
    // percent at 4. Null when there is no ladder for the barcode.
    const commissionBands: CampaignCommissionBand[] | null =
      commission.bands === null ? null : serializeCommissionBandLadder(commission.bands);

    const currentPrice = new Decimal(item.currentPrice.toString());
    const maxPrice = new Decimal(item.maxPrice.toString());
    const customPrice = item.customPrice !== null ? new Decimal(item.customPrice.toString()) : null;
    // A per-item engine throw degrades only that item (reason null, profits empty) and is
    // collected to log once after the pass (decision 9).
    let computed: ReturnType<typeof computeCampaignItem>;
    try {
      computed = computeCampaignItem({
        base,
        commission,
        currentPrice,
        maxPrice,
        customPrice,
        config,
        fundingPct,
      });
    } catch (err) {
      failureLog.record(err);
      computed = computeCampaignItem({
        base: { kind: 'degraded' },
        commission,
        currentPrice,
        maxPrice,
        customPrice,
        config,
        fundingPct,
      });
    }

    return {
      id: item.id,
      barcode: item.barcode,
      productCode: item.productCode,
      externalId: item.externalId,
      productTitle: item.productTitle,
      brand: item.brand,
      color: item.color,
      size: item.size,
      category: item.category,
      stock: item.stock,
      imageUrl: inputs.imageUrl,
      currentPrice: item.currentPrice.toFixed(2),
      maxPrice: item.maxPrice.toFixed(2),
      hasCommissionTariff: item.hasCommissionTariff,
      selection: item.selection,
      customPrice: item.customPrice !== null ? item.customPrice.toFixed(2) : null,
      calculable: computed.calculable,
      reason: computed.reason,
      current: serializeScenario(computed.current),
      maxScenario: serializeScenario(computed.maxScenario),
      customScenario:
        computed.customScenario !== null ? serializeScenario(computed.customScenario) : null,
      commissionBands,
      // Passthrough: the compute already serialized both basket blocks to wire strings.
      maxBasket: computed.maxBasket,
      customBasket: computed.customBasket,
    };
  });

  failureLog.flush();

  return {
    id: list.id,
    name: list.name,
    discountType: toWireDiscountType(list.discountType, list.id),
    valueKind: list.valueKind,
    value: list.value !== null ? list.value.toFixed(2) : null,
    minBasketAmount: list.minBasketAmount !== null ? list.minBasketAmount.toFixed(2) : null,
    minQuantity: list.minQuantity,
    buyQuantity: list.buyQuantity,
    payQuantity: list.payQuantity,
    nthIndex: list.nthIndex,
    trendyolFundingPct: list.trendyolFundingPct.toFixed(2),
    startsAt: list.startsAt !== null ? list.startsAt.toISOString() : null,
    endsAt: list.endsAt !== null ? list.endsAt.toISOString() : null,
    exported: list.exportedAt !== null,
    // Transparency: which tariff/period actually fed the bands (null when none resolved).
    commissionTariffName: economics.tariffName,
    commissionPeriodLabel: economics.periodLabel,
    // True only when the store has commission tariffs but none covers the anchor.
    commissionTariffOutdated: economics.tariffOutdated,
    // UNIT vs ORDER row layout this config calls for; computed once for the campaign.
    scenarioPresentation: scenarioPresentation(config),
    items,
  };
}

// --- Update config ---
/**
 * Full-replaces the campaign configuration on the list row (name only when provided).
 *
 * FULL-REPLACE, not a merge: every config column is written from the body on every call, so a
 * field the caller omits is RESET, not preserved. `trendyolFundingPct` is the sharp edge —
 * its schema default is `'0'`, so omitting it zeroes the seller's funding rate rather than
 * leaving it alone. That is deliberate (it matches the sibling's PATCH convention and keeps
 * one config write path), and the frontend edit dialog must therefore always submit the whole
 * config. An integration test pins the behaviour.
 *
 * `findFirst` first so a foreign campaign id is a 404 indistinguishable from a missing one.
 */
export async function updateMarketplaceCampaign(
  orgId: string,
  storeId: string,
  campaignId: string,
  patch: UpdateMarketplaceCampaignBody,
): Promise<{ id: string }> {
  const existing = await prisma.marketplaceCampaignList.findFirst({
    where: { id: campaignId, organizationId: orgId, storeId },
    select: { id: true },
  });
  if (existing === null) {
    throw new NotFoundError('MarketplaceCampaign', campaignId);
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const data = {
        discountType: patch.discountType,
        valueKind: patch.valueKind ?? null,
        value: patch.value ?? null,
        minBasketAmount: patch.minBasketAmount ?? null,
        minQuantity: intOrNull(patch.minQuantity),
        buyQuantity: intOrNull(patch.buyQuantity),
        payQuantity: intOrNull(patch.payQuantity),
        nthIndex: intOrNull(patch.nthIndex),
        // Always present after validation (schema default '0') — see the full-replace note.
        trendyolFundingPct: patch.trendyolFundingPct,
        startsAt: patch.startsAt ?? null,
        endsAt: patch.endsAt ?? null,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
      };
      await assertScopedWrite(
        tx.marketplaceCampaignList.updateMany({
          where: { id: campaignId, organizationId: orgId, storeId },
          data,
        }),
        'MarketplaceCampaign',
        campaignId,
      );
      // updateMany returns no row: the stored id is read back in the same transaction.
      const row = await tx.marketplaceCampaignList.findFirst({
        where: { id: campaignId, organizationId: orgId, storeId },
        select: { id: true },
      });
      if (row === null) throw new NotFoundError('MarketplaceCampaign', campaignId);
      return row;
    });
    return { id: updated.id };
  } catch (err) {
    mapPrismaError(err);
  }
}

// --- Update selections ---
/**
 * Rejects any requested custom price above the item's "Maksimum Girebileceğin Fiyat".
 *
 * That cell is Trendyol's hard ceiling: a campaign price above it is refused when the seller
 * re-uploads the exported sheet. Nothing downstream re-checks it (the export writes whatever
 * is stored), so the persistence boundary is the only place that can stop an unusable file
 * from being produced. Item ids that do not belong to this campaign are ignored here exactly
 * as the bulk UPDATE below ignores them.
 */
function assertCustomPricesWithinMax(
  requested: ReadonlyMap<string, CampaignSelection>,
  items: ReadonlyArray<{ id: string; maxPrice: Prisma.Decimal }>,
): void {
  const issues: ValidationIssue[] = [];
  for (const item of items) {
    const selection = requested.get(item.id);
    if (selection === undefined || selection.customPrice === null) continue;
    if (new Decimal(selection.customPrice).gt(item.maxPrice.toString())) {
      issues.push({
        field: 'selections',
        code: 'CUSTOM_PRICE_ABOVE_MAX',
        meta: { itemId: item.id, maxPrice: item.maxPrice.toFixed(2) },
      });
    }
  }
  if (issues.length > 0) {
    throw new ValidationError(issues);
  }
}

/**
 * Persists the seller's per-item price choice. 404 when the campaign is not in this store.
 *
 * mode 'all' / 'none' flips the WHOLE campaign in one `updateMany` — 'all' applies the MAX
 * price option (the API cannot know which rows the seller wanted a custom price on) and
 * 'none' clears participation. Neither touches `customPrice`: it is stored independently of
 * the selection, so a seller who cleared their choice keeps the price they typed.
 *
 * mode 'set' writes the given rows in one bulk UPDATE gated on
 * `(organization_id, store_id, list_id)`, so a foreign itemId is silently skipped.
 */
export async function updateCampaignSelections(
  orgId: string,
  storeId: string,
  campaignId: string,
  selections: ReadonlyArray<CampaignSelection>,
  mode: 'set' | 'all' | 'none',
): Promise<{ updated: number }> {
  const list = await prisma.marketplaceCampaignList.findFirst({
    where: { id: campaignId, organizationId: orgId, storeId },
    select: { id: true },
  });
  if (list === null) {
    throw new NotFoundError('MarketplaceCampaign', campaignId);
  }

  if (mode === 'all' || mode === 'none') {
    try {
      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.marketplaceCampaignItem.updateMany({
          where: { listId: campaignId, organizationId: orgId, storeId },
          data: {
            selection: mode === 'all' ? CampaignPriceSelection.MAX : CampaignPriceSelection.NONE,
          },
        });
        // Bump the parent so `listMarketplaceCampaigns` (ordered by updatedAt desc) floats the
        // edited campaign to the top — a selection save otherwise only touches item rows.
        // The bump carries its own scope.
        await assertScopedWrite(
          tx.marketplaceCampaignList.updateMany({
            where: { id: campaignId, organizationId: orgId, storeId },
            data: { updatedAt: new Date() },
          }),
          'MarketplaceCampaign',
          campaignId,
        );
        return result.count;
      });
      return { updated };
    } catch (err) {
      mapPrismaError(err);
    }
  }

  if (selections.length === 0) return { updated: 0 };

  // Dedupe last-wins: the same itemId may appear twice in one payload. A VALUES table with a
  // duplicate id would join the target row against both source rows, letting Postgres pick
  // either value nondeterministically — collapse to one row per id so the LAST choice wins.
  const byItemId = new Map<string, CampaignSelection>();
  for (const s of selections) byItemId.set(s.itemId, s);

  let ceilingRows;
  try {
    ceilingRows = await prisma.marketplaceCampaignItem.findMany({
      where: {
        id: { in: [...byItemId.keys()] },
        organizationId: orgId,
        storeId,
        listId: campaignId,
      },
      select: { id: true, maxPrice: true },
    });
  } catch (err) {
    mapPrismaError(err);
  }
  assertCustomPricesWithinMax(byItemId, ceilingRows);

  const rows = [...byItemId.values()].map(
    (s) =>
      Prisma.sql`(${s.itemId}::uuid, ${s.selection}::"CampaignPriceSelection", ${s.customPrice}::numeric)`,
  );

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const count = await tx.$executeRaw`
        UPDATE marketplace_campaign_items AS i
        SET selection = v.selection, custom_price = v.custom_price, updated_at = now()
        FROM (VALUES ${Prisma.join(rows)}) AS v(id, selection, custom_price)
        WHERE i.id = v.id
          AND i.organization_id = ${orgId}::uuid
          AND i.store_id = ${storeId}::uuid
          AND i.list_id = ${campaignId}::uuid
      `;
      // Same parent bump as the all/none path.
      await assertScopedWrite(
        tx.marketplaceCampaignList.updateMany({
          where: { id: campaignId, organizationId: orgId, storeId },
          data: { updatedAt: new Date() },
        }),
        'MarketplaceCampaign',
        campaignId,
      );
      return count;
    });
    return { updated };
  } catch (err) {
    mapPrismaError(err);
  }
}

// --- Delete ---
/** Hard-deletes a campaign (items cascade). 404 when not in this store. */
export async function deleteMarketplaceCampaign(
  orgId: string,
  storeId: string,
  campaignId: string,
): Promise<void> {
  const existing = await prisma.marketplaceCampaignList.findFirst({
    where: { id: campaignId, organizationId: orgId, storeId },
    select: { id: true },
  });
  if (existing === null) {
    throw new NotFoundError('MarketplaceCampaign', campaignId);
  }

  await assertScopedWrite(
    prisma.marketplaceCampaignList.deleteMany({
      where: { id: campaignId, organizationId: orgId, storeId },
    }),
    'MarketplaceCampaign',
    campaignId,
  );
}
