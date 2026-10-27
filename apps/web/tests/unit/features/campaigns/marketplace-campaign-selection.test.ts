import { describe, expect, it } from 'vitest';

import type { EstimateCampaignItemResult } from '@/features/campaigns/api/estimate-campaign-item.api';
import type {
  CampaignBasketScenario,
  CampaignScenario,
  MarketplaceCampaignRow,
} from '@/features/campaigns/lib/adapt-marketplace-campaign';
import {
  applyCustomPrice,
  applyTargetMarginSuggestions,
  bestCampaignOption,
  campaignOptionFigures,
  campaignRowBestOption,
  clearSelections,
  countCampaignChoices,
  customOptionFigures,
  customPriceStatus,
  estimateOptionFigures,
  filterCampaignRows,
  hasActiveCampaignFilters,
  hasCommissionTariffWarning,
  seedCampaignChoices,
  selectAllMax,
  selectProfitable,
  toCampaignSelectionsPayload,
  toggleCampaignChoice,
  type CampaignChoiceState,
  type CampaignFilterState,
  type CampaignOptionFigures,
} from '@/features/campaigns/lib/marketplace-campaign-selection';

function scenario(price: string, netProfit: string | null): CampaignScenario {
  return {
    price,
    commissionPct: '18.0000',
    commissionSource: 'product',
    netProfit,
    marginPct: netProfit,
  };
}

function basket(
  n: number,
  paidTotal: string,
  orderNetProfit: string | null,
): NonNullable<CampaignBasketScenario> {
  return {
    assumedQuantity: n,
    basketTotal: paidTotal,
    basketPaidTotal: paidTotal,
    basketDiscountTotal: '0.00',
    trendyolFundedTotal: '0.00',
    orderNetProfit,
    orderMarginPct: orderNetProfit,
    currentOrderNetProfit: '90.00',
  };
}

/** A calculable row: current 250, maximum 200 — no custom price saved yet. */
function makeRow(over: Partial<MarketplaceCampaignRow> = {}): MarketplaceCampaignRow {
  return {
    id: 'row-1',
    barcode: '8681234567890',
    productCode: null,
    externalId: null,
    productTitle: 'Kampanya Ürünü',
    brand: null,
    color: null,
    size: null,
    category: null,
    stock: null,
    imageUrl: null,
    currentPrice: '250.00',
    maxPrice: '200.00',
    hasCommissionTariff: false,
    selection: 'NONE',
    customPrice: null,
    calculable: true,
    reason: null,
    current: scenario('250.00', '60.00'),
    maxScenario: scenario('200.00', '30.00'),
    customScenario: null,
    commissionBands: null,
    maxBasket: null,
    customBasket: null,
    ...over,
  };
}

const unitFigures = (netProfit: string | null): CampaignOptionFigures => ({
  netProfit,
  marginPct: netProfit,
  baselineNetProfit: '60.00',
  order: null,
});

const orderFigures = (n: number, netProfit: string | null): CampaignOptionFigures => ({
  netProfit,
  marginPct: netProfit,
  baselineNetProfit: '90.00',
  order: { quantity: n, paidTotal: '300.00' },
});

describe('customPriceStatus', () => {
  const row = makeRow();

  it('accepts a price up to and including the maximum', () => {
    expect(customPriceStatus('150.00', row)).toBe('valid');
    expect(customPriceStatus('200.00', row)).toBe('valid');
  });

  it('flags a price above the maximum and a non-positive price; empty is its own state', () => {
    expect(customPriceStatus('200.01', row)).toBe('aboveMax');
    expect(customPriceStatus('0.00', row)).toBe('notPositive');
    expect(customPriceStatus(null, row)).toBe('empty');
  });
});

describe('seedCampaignChoices', () => {
  it('seeds every saved choice and every saved custom price — NONE as no choice', () => {
    const rows = [
      makeRow({ id: 'a', selection: 'MAX', customPrice: '150.00' }),
      makeRow({ id: 'b', selection: 'CUSTOM', customPrice: '180.00' }),
      makeRow({ id: 'c' }),
    ];
    expect(seedCampaignChoices(rows)).toEqual({
      selection: { a: 'MAX', b: 'CUSTOM', c: null },
      customPrices: { a: '150.00', b: '180.00', c: null },
    });
  });

  it('seeds a saved CUSTOM choice whose price could not be exported as no choice', () => {
    const rows = [
      makeRow({ id: 'priceless', selection: 'CUSTOM', customPrice: null }),
      makeRow({ id: 'too-high', selection: 'CUSTOM', customPrice: '250.00' }),
    ];
    const { selection } = seedCampaignChoices(rows);
    expect(selection).toEqual({ priceless: null, 'too-high': null });
  });
});

describe('applyCustomPrice', () => {
  const row = makeRow();
  const state = (choice: 'MAX' | 'CUSTOM' | null, price: string | null): CampaignChoiceState => ({
    selection: { [row.id]: choice },
    customPrices: { [row.id]: price },
  });

  it('stores the typed price and keeps a CUSTOM choice while the price stays valid', () => {
    expect(applyCustomPrice(state('CUSTOM', '150.00'), row, '120.00')).toEqual(
      state('CUSTOM', '120.00'),
    );
  });

  it('drops a CUSTOM choice once the price is cleared or leaves the allowed range', () => {
    expect(applyCustomPrice(state('CUSTOM', '150.00'), row, null)).toEqual(state(null, null));
    expect(applyCustomPrice(state('CUSTOM', '150.00'), row, '250.00')).toEqual(
      state(null, '250.00'),
    );
  });

  it('never touches a MAX choice — the typed price is only a comparison then', () => {
    expect(applyCustomPrice(state('MAX', null), row, '250.00')).toEqual(state('MAX', '250.00'));
  });
});

describe('toggleCampaignChoice', () => {
  const row = makeRow();
  const empty: CampaignChoiceState = { selection: {}, customPrices: {} };

  it('joins with an option, clears it when chosen again, and switches between options', () => {
    const joined = toggleCampaignChoice(empty, row, 'MAX');
    expect(joined.selection[row.id]).toBe('MAX');
    expect(toggleCampaignChoice(joined, row, 'MAX').selection[row.id]).toBeNull();

    const priced = { ...joined, customPrices: { [row.id]: '150.00' } };
    expect(toggleCampaignChoice(priced, row, 'CUSTOM').selection[row.id]).toBe('CUSTOM');
  });

  it('refuses CUSTOM while the buffered price is empty or above the maximum', () => {
    expect(toggleCampaignChoice(empty, row, 'CUSTOM')).toBe(empty);
    const tooHigh = { selection: {}, customPrices: { [row.id]: '250.00' } };
    expect(toggleCampaignChoice(tooHigh, row, 'CUSTOM')).toBe(tooHigh);
  });
});

describe('countCampaignChoices', () => {
  it('counts the joining rows per price option; a row without a choice counts for neither', () => {
    const rows = [
      makeRow({ id: 'a' }),
      makeRow({ id: 'b' }),
      makeRow({ id: 'c' }),
      makeRow({ id: 'd' }),
    ];
    const state: CampaignChoiceState = {
      selection: { a: 'MAX', b: 'CUSTOM', c: null, d: 'MAX' },
      customPrices: { b: '150.00' },
    };
    expect(countCampaignChoices(rows, state)).toEqual({ max: 2, custom: 1 });
  });
});

describe('toCampaignSelectionsPayload', () => {
  it('writes every row, carrying a valid custom price even when the row stays on MAX', () => {
    const rows = [makeRow({ id: 'a' }), makeRow({ id: 'b' }), makeRow({ id: 'c' })];
    const state: CampaignChoiceState = {
      selection: { a: 'MAX', b: 'CUSTOM' },
      customPrices: { a: '150.00', b: '180.00' },
    };
    expect(toCampaignSelectionsPayload(rows, state)).toEqual([
      { itemId: 'a', selection: 'MAX', customPrice: '150.00' },
      { itemId: 'b', selection: 'CUSTOM', customPrice: '180.00' },
      { itemId: 'c', selection: 'NONE', customPrice: null },
    ]);
  });

  it('never sends a price the backend would refuse, nor a CUSTOM choice without its price', () => {
    const rows = [makeRow({ id: 'draft' }), makeRow({ id: 'broken' })];
    const state: CampaignChoiceState = {
      selection: { draft: 'MAX', broken: 'CUSTOM' },
      customPrices: { draft: '250.00', broken: null },
    };
    expect(toCampaignSelectionsPayload(rows, state)).toEqual([
      { itemId: 'draft', selection: 'MAX', customPrice: null },
      { itemId: 'broken', selection: 'NONE', customPrice: null },
    ]);
  });
});

describe('campaignOptionFigures', () => {
  it('a UNIT row headlines the unit scenario against the current unit profit', () => {
    const row = makeRow();
    expect(campaignOptionFigures('UNIT', row.maxScenario, null, row.current)).toEqual({
      netProfit: '30.00',
      marginPct: '30.00',
      baselineNetProfit: '60.00',
      order: null,
    });
  });

  it('an ORDER row headlines its own basket against the same order campaign-free', () => {
    const row = makeRow({ maxBasket: basket(3, '300.00', '45.00') });
    expect(campaignOptionFigures('ORDER', row.maxScenario, row.maxBasket, row.current)).toEqual({
      netProfit: '45.00',
      marginPct: '45.00',
      baselineNetProfit: '90.00',
      order: { quantity: 3, paidTotal: '300.00' },
    });
  });

  it('an ORDER row without a basket (a non-positive price) falls back to the unit scenario', () => {
    const row = makeRow();
    expect(campaignOptionFigures('ORDER', row.maxScenario, null, row.current).order).toBeNull();
  });
});

describe('estimateOptionFigures', () => {
  const row = makeRow();
  const result = (over: Partial<EstimateCampaignItemResult>): EstimateCampaignItemResult => ({
    itemId: row.id,
    scenario: 'custom',
    price: '150.00',
    customerPaidUnitPrice: null,
    trendyolFundedUnitAmount: null,
    commissionPct: '18.0000',
    commissionSource: 'product',
    calculable: true,
    reason: null,
    breakdown: null,
    breakdownScope: 'unit',
    basket: null,
    commissionTariffName: null,
    commissionPeriodLabel: null,
    ...over,
  });

  it('an order-scoped estimate headlines its basket', () => {
    const figures = estimateOptionFigures(
      result({ breakdownScope: 'order', basket: basket(3, '270.00', '28.00') }),
      row.current,
    );
    expect(figures.order).toEqual({ quantity: 3, paidTotal: '270.00' });
    expect(figures.netProfit).toBe('28.00');
    expect(figures.baselineNetProfit).toBe('90.00');
  });

  it('a not-calculable unit estimate carries no profit, only the current baseline', () => {
    expect(estimateOptionFigures(result({ calculable: false }), row.current)).toEqual({
      netProfit: null,
      marginPct: null,
      baselineNetProfit: '60.00',
      order: null,
    });
  });
});

describe('customOptionFigures', () => {
  const row = makeRow({ customPrice: '180.00', customScenario: scenario('180.00', '20.00') });

  it('uses the live what-if only for exactly the price it priced', () => {
    const live = { price: '150.00', figures: unitFigures('12.00') };
    expect(customOptionFigures(row, 'UNIT', '150.00', live)?.netProfit).toBe('12.00');
    // A late answer for an older price never describes the one in the input.
    expect(customOptionFigures(row, 'UNIT', '140.00', live)).toBeNull();
  });

  it('falls back to the saved figures while the buffer still holds the saved price', () => {
    expect(customOptionFigures(row, 'UNIT', '180.00', undefined)?.netProfit).toBe('20.00');
    expect(customOptionFigures(row, 'UNIT', null, undefined)).toBeNull();
  });
});

describe('bestCampaignOption', () => {
  it('crowns nobody without a custom figure to compare against', () => {
    expect(bestCampaignOption(unitFigures('30.00'), null)).toBeNull();
  });

  it('crowns the more profitable option; a tie stays on the maximum', () => {
    expect(bestCampaignOption(unitFigures('30.00'), unitFigures('35.00'))).toBe('custom');
    expect(bestCampaignOption(unitFigures('30.00'), unitFigures('25.00'))).toBe('max');
    expect(bestCampaignOption(unitFigures('30.00'), unitFigures('30.00'))).toBe('max');
  });

  it('never crowns a loss — the only profitable option wins, two losses crown nobody', () => {
    expect(bestCampaignOption(unitFigures('-5.00'), unitFigures('10.00'))).toBe('custom');
    expect(bestCampaignOption(unitFigures('10.00'), unitFigures('-5.00'))).toBe('max');
    expect(bestCampaignOption(unitFigures('-5.00'), unitFigures('-1.00'))).toBeNull();
  });

  it('does not compare two orders of a different size', () => {
    expect(bestCampaignOption(orderFigures(4, '40.00'), orderFigures(5, '45.00'))).toBeNull();
    expect(bestCampaignOption(orderFigures(3, '40.00'), orderFigures(3, '45.00'))).toBe('custom');
  });
});

describe('campaignRowBestOption', () => {
  it('races the maximum against the saved custom price on an ORDER row', () => {
    const row = makeRow({
      customPrice: '180.00',
      customScenario: scenario('180.00', '20.00'),
      maxBasket: basket(3, '300.00', '45.00'),
      customBasket: basket(3, '270.00', '50.00'),
    });
    expect(campaignRowBestOption(row, 'ORDER', '180.00', undefined)).toBe('custom');
    // A different typed price has no figures yet, so the ribbon waits for its estimate.
    expect(campaignRowBestOption(row, 'ORDER', '170.00', undefined)).toBeNull();
  });
});

// ─── G16: filters + smart-select ─────────────────────────────────────────────

const NO_FILTERS: CampaignFilterState = {
  query: '',
  profitable: false,
  losing: false,
  selected: false,
  tariffWarning: false,
};

/** Rows whose maximum-price option profits, loses, and cannot be judged (no cost). */
function profitRows(): MarketplaceCampaignRow[] {
  return [
    makeRow({ id: 'win', maxScenario: scenario('200.00', '30.00') }),
    makeRow({ id: 'loss', maxScenario: scenario('200.00', '-12.50') }),
    makeRow({
      id: 'unknown',
      calculable: false,
      reason: 'NO_COST',
      maxScenario: scenario('200.00', null),
    }),
  ];
}

const ids = (rows: readonly MarketplaceCampaignRow[]): string[] => rows.map((row) => row.id);

describe('hasActiveCampaignFilters', () => {
  it('is off for the default view and a blank search, on for a search or any chip', () => {
    expect(hasActiveCampaignFilters(NO_FILTERS)).toBe(false);
    expect(hasActiveCampaignFilters({ ...NO_FILTERS, query: '   ' })).toBe(false);
    expect(hasActiveCampaignFilters({ ...NO_FILTERS, query: 'lamba' })).toBe(true);
    expect(hasActiveCampaignFilters({ ...NO_FILTERS, losing: true })).toBe(true);
    expect(hasActiveCampaignFilters({ ...NO_FILTERS, tariffWarning: true })).toBe(true);
  });
});

describe('hasCommissionTariffWarning', () => {
  it('warns only when the file says "on a tariff" but the commission did not come from a band', () => {
    expect(hasCommissionTariffWarning(makeRow({ hasCommissionTariff: true }))).toBe(true);
    expect(
      hasCommissionTariffWarning(
        makeRow({
          hasCommissionTariff: true,
          maxScenario: { ...scenario('200.00', '30.00'), commissionSource: 'band' },
        }),
      ),
    ).toBe(false);
    expect(hasCommissionTariffWarning(makeRow({ hasCommissionTariff: false }))).toBe(false);
  });
});

describe('filterCampaignRows', () => {
  it('searches title, barcode and model code with tr lowercasing — and no letter folding', () => {
    const rows = [
      makeRow({ id: 'lamp', productTitle: 'IŞIKLI MASA LAMBASI' }),
      makeRow({ id: 'code', productTitle: 'Kupa', productCode: 'MDL-42' }),
      makeRow({ id: 'bar', productTitle: 'Tabak', barcode: '869000111' }),
    ];
    const find = (query: string): string[] =>
      ids(filterCampaignRows(rows, {}, { ...NO_FILTERS, query }, 'UNIT'));

    // tr-locale: "I" lowercases to "ı" on BOTH sides, so either casing of the query matches.
    expect(find('ışıklı')).toEqual(['lamp']);
    expect(find('IŞIKLI')).toEqual(['lamp']);
    // Berkin's choice (option A): no Turkish-letter folding, so the ASCII spelling does not match.
    expect(find('isikli')).toEqual([]);
    expect(find('mdl-42')).toEqual(['code']);
    expect(find(' 869000 ')).toEqual(['bar']);
  });

  it('the profit chips read the maximum option’s sign; a row without a profit matches neither', () => {
    const rows = profitRows();
    expect(ids(filterCampaignRows(rows, {}, { ...NO_FILTERS, profitable: true }, 'UNIT'))).toEqual([
      'win',
    ]);
    expect(ids(filterCampaignRows(rows, {}, { ...NO_FILTERS, losing: true }, 'UNIT'))).toEqual([
      'loss',
    ]);
  });

  it('an ORDER campaign judges the order, not the unit', () => {
    // The unit falls to a loss, yet the assumed order still nets a profit.
    const row = makeRow({
      id: 'order',
      maxScenario: scenario('100.00', '-5.00'),
      maxBasket: basket(3, '300.00', '10.00'),
    });
    const profitable = { ...NO_FILTERS, profitable: true };
    expect(ids(filterCampaignRows([row], {}, profitable, 'ORDER'))).toEqual(['order']);
    expect(ids(filterCampaignRows([row], {}, profitable, 'UNIT'))).toEqual([]);
  });

  it('"Seçililer" follows the buffer and the tariff chip keeps only warned rows', () => {
    const rows = [makeRow({ id: 'joined' }), makeRow({ id: 'warned', hasCommissionTariff: true })];
    const state: CampaignChoiceState = { selection: { joined: 'MAX' }, customPrices: {} };
    expect(
      ids(filterCampaignRows(rows, state.selection, { ...NO_FILTERS, selected: true }, 'UNIT')),
    ).toEqual(['joined']);
    expect(
      ids(
        filterCampaignRows(rows, state.selection, { ...NO_FILTERS, tariffWarning: true }, 'UNIT'),
      ),
    ).toEqual(['warned']);
  });
});

describe('smart-select actions', () => {
  it('"Tümünü maksimum fiyata çek" joins every given row at the maximum — a losing one too', () => {
    const [win, loss, unknown] = profitRows();
    if (win === undefined || loss === undefined || unknown === undefined) throw new Error('rows');
    const state: CampaignChoiceState = {
      selection: { win: 'CUSTOM', hidden: 'CUSTOM' },
      customPrices: { win: '150.00', hidden: '150.00' },
    };

    const next = selectAllMax([win, loss, unknown], state);

    expect(next.selection).toEqual({ win: 'MAX', loss: 'MAX', unknown: 'MAX', hidden: 'CUSTOM' });
    // The typed prices stay — they are only a comparison once the row is on the maximum.
    expect(next.customPrices).toEqual(state.customPrices);
  });

  it('"Kârda kalanları seç" keeps exactly the profitable rows, leaving a CUSTOM choice alone', () => {
    const rows = [
      ...profitRows(),
      makeRow({ id: 'own', maxScenario: scenario('200.00', '-3.00') }),
    ];
    const state: CampaignChoiceState = {
      selection: { loss: 'MAX', unknown: 'MAX', own: 'CUSTOM', hidden: 'MAX' },
      customPrices: { own: '190.00' },
    };

    const next = selectProfitable(rows, state, 'UNIT');

    expect(next.selection).toEqual({
      win: 'MAX',
      loss: null,
      unknown: null,
      own: 'CUSTOM',
      hidden: 'MAX',
    });
  });

  it('"Seçimi temizle" clears both the choice and the typed price of every given row', () => {
    const rows = [makeRow({ id: 'a' }), makeRow({ id: 'b' })];
    const state: CampaignChoiceState = {
      selection: { a: 'MAX', b: 'CUSTOM', hidden: 'CUSTOM' },
      customPrices: { a: '120.00', b: '150.00', hidden: '150.00' },
    };

    expect(clearSelections(rows, state)).toEqual({
      selection: { a: null, b: null, hidden: 'CUSTOM' },
      customPrices: { a: null, b: null, hidden: '150.00' },
    });
  });
});

describe('applyTargetMarginSuggestions', () => {
  const rows = [
    makeRow({ id: 'priced' }),
    makeRow({ id: 'unreachable' }),
    makeRow({ id: 'noCost' }),
  ];
  const state: CampaignChoiceState = {
    selection: { priced: null, unreachable: 'MAX', noCost: 'MAX', hidden: null },
    customPrices: { unreachable: '150.00' },
  };

  it('writes a suggested price and joins with it; an UNREACHABLE row is left out and marked', () => {
    const result = applyTargetMarginSuggestions(rows, state, [
      { itemId: 'priced', price: '185.40', reason: null },
      { itemId: 'unreachable', price: null, reason: 'UNREACHABLE' },
      { itemId: 'noCost', price: null, reason: 'NOT_CALCULABLE' },
    ]);

    expect(result.state.selection).toEqual({
      priced: 'CUSTOM',
      unreachable: null,
      // NOT_CALCULABLE gives nothing to judge by, so the seller's choice stands.
      noCost: 'MAX',
      hidden: null,
    });
    expect(result.state.customPrices).toEqual({ priced: '185.40', unreachable: '150.00' });
    expect(result.marks).toEqual({ unreachable: 'UNREACHABLE', noCost: 'NOT_CALCULABLE' });
    expect(result.filled).toBe(1);
  });

  it('touches only the given (visible) rows and never writes a price the save would refuse', () => {
    const result = applyTargetMarginSuggestions([makeRow({ id: 'priced' })], state, [
      // Above the 200.00 ceiling — the backend never sends this, but the buffer must not take it.
      { itemId: 'priced', price: '250.00', reason: null },
      { itemId: 'hidden', price: '120.00', reason: null },
    ]);

    expect(result.state).toEqual(state);
    expect(result.marks).toEqual({});
    expect(result.filled).toBe(0);
  });
});
