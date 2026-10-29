import { Decimal } from 'decimal.js';
import {
  CostProfileType,
  FxRateMode,
  FxRateSource,
  ProfitIssueCode,
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
} from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { makeItem, makeParcel } from '../../../__tests__/fixtures/parcel-builders';
import { CURRENCY_TRY, type CurrencyCode, toCurrencyCode } from '../../fx/currency-code';
import { type FxRateQuote } from '../../fx/select-fx-rate';
import {
  buildSellerCostLines,
  type CostProfileVersionInput,
  type ItemCostInput,
  type ItemCostProfileInput,
} from '../build-seller-cost-lines';

const USD = toCurrencyCode('USD');

interface MakeVersionParams {
  readonly effectiveFrom: string;
  readonly amountGross: string;
  readonly currency?: CurrencyCode;
  readonly vatRatePct?: string;
  readonly fxRateMode?: FxRateMode;
  readonly manualFxRate?: string | null;
  readonly archivedAt?: string | null;
}

function makeVersion(params: MakeVersionParams): CostProfileVersionInput {
  return {
    effectiveFrom: new Date(params.effectiveFrom),
    amountGross: new Decimal(params.amountGross),
    currency: params.currency ?? CURRENCY_TRY,
    vatRatePct: new Decimal(params.vatRatePct ?? '20'),
    fxRateMode: params.fxRateMode ?? FxRateMode.AUTO,
    manualFxRate:
      params.manualFxRate === undefined || params.manualFxRate === null
        ? null
        : new Decimal(params.manualFxRate),
    archivedAt:
      params.archivedAt === undefined || params.archivedAt === null
        ? null
        : new Date(params.archivedAt),
  };
}

function makeProfile(
  profileId: string,
  profileType: CostProfileType,
  versions: readonly CostProfileVersionInput[],
): ItemCostProfileInput {
  return { profileId, profileType, versions };
}

function makeCost(orderItemId: string, profiles: readonly ItemCostProfileInput[]): ItemCostInput {
  return { orderItemId, profiles };
}

const USD_QUOTE: FxRateQuote = {
  currency: USD,
  rateDate: '2026-10-28',
  rateToBase: new Decimal('41.8'),
};

describe('buildSellerCostLines', () => {
  it('builds a TRY cost line from the version valid at the order date', () => {
    const snapshot = makeParcel({ items: [makeItem({ orderItemId: 'a', listGross: '500' })] });
    const { lines, issues } = buildSellerCostLines({
      snapshot,
      costs: [
        makeCost('a', [
          makeProfile('p1', CostProfileType.COGS, [
            makeVersion({
              effectiveFrom: '2026-10-01T00:00:00Z',
              amountGross: '233.00',
              vatRatePct: '10',
            }),
          ]),
        ]),
      ],
      fxQuotes: [],
    });

    expect(issues).toEqual([]);
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line?.type).toBe(ProfitLineType.COST_COGS);
    expect(line?.level).toBe(ProfitLineLevel.ITEM);
    expect(line?.orderItemId).toBe('a');
    expect(line?.amount.gross.toFixed(2)).toBe('233.00');
    expect(line?.amount.vat.toFixed(2)).toBe('21.18');
    expect(line?.certainty).toBe(ProfitLineCertainty.ACTUAL);
    expect(line?.source).toBe(ProfitLineSource.SELLER_INPUT);
    expect(line?.fx.source).toBe(FxRateSource.NATIVE);
    expect(line?.fx.rateDate).toBeNull();
    expect(line?.inputs).toEqual({
      profileId: 'p1',
      profileType: CostProfileType.COGS,
      versionEffectiveFrom: new Date('2026-10-01T00:00:00Z').toISOString(),
    });
  });

  it('picks the version by order date and falls back to the first version', () => {
    const versions = [
      makeVersion({
        effectiveFrom: '2026-10-01T00:00:00Z',
        amountGross: '100.00',
        vatRatePct: '20',
      }),
      makeVersion({
        effectiveFrom: '2026-10-20T00:00:00Z',
        amountGross: '120.00',
        vatRatePct: '20',
      }),
    ];
    const runAt = (orderDate: string): ReturnType<typeof buildSellerCostLines> =>
      buildSellerCostLines({
        snapshot: makeParcel({
          orderDate: new Date(orderDate),
          items: [makeItem({ orderItemId: 'a', listGross: '500' })],
        }),
        costs: [makeCost('a', [makeProfile('p1', CostProfileType.COGS, versions)])],
        fxQuotes: [],
      });

    const onDate = runAt('2026-10-15T09:00:00Z');
    expect(onDate.issues).toEqual([]);
    expect(onDate.lines[0]?.amount.gross.toFixed(2)).toBe('100.00');
    expect(onDate.lines[0]?.amount.vat.toFixed(2)).toBe('16.67');

    const beforeFirst = runAt('2026-09-01T09:00:00Z');
    expect(beforeFirst.lines[0]?.amount.gross.toFixed(2)).toBe('100.00');
    expect(beforeFirst.lines[0]?.amount.vat.toFixed(2)).toBe('16.67');

    const afterSecond = runAt('2026-10-25T09:00:00Z');
    expect(afterSecond.lines[0]?.amount.gross.toFixed(2)).toBe('120.00');
    expect(afterSecond.lines[0]?.amount.vat.toFixed(2)).toBe('20.00');
  });

  it('converts a USD cost with the order-date rate', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '500', quantity: 2 })],
    });
    const { lines, issues } = buildSellerCostLines({
      snapshot,
      costs: [
        makeCost('a', [
          makeProfile('p1', CostProfileType.COGS, [
            makeVersion({
              effectiveFrom: '2026-10-01T00:00:00Z',
              amountGross: '10.00',
              currency: USD,
              vatRatePct: '20',
              fxRateMode: FxRateMode.AUTO,
            }),
          ]),
        ]),
      ],
      fxQuotes: [USD_QUOTE],
    });

    expect(issues).toEqual([]);
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line?.amount.gross.toFixed(2)).toBe('836.00');
    expect(line?.amount.vat.toFixed(2)).toBe('139.19');
    expect(line?.fx.source).toBe(FxRateSource.TCMB);
    expect(line?.fx.rateDate).toBe('2026-10-28');
    expect(line?.fx.original.gross.toFixed(2)).toBe('20.00');
    expect(line?.fx.original.vat.toFixed(2)).toBe('3.33');
  });

  it('uses a manual rate and reports MISSING_FX_RATE when none applies', () => {
    const snapshot = makeParcel({ items: [makeItem({ orderItemId: 'a', listGross: '500' })] });

    const manual = buildSellerCostLines({
      snapshot,
      costs: [
        makeCost('a', [
          makeProfile('p1', CostProfileType.COGS, [
            makeVersion({
              effectiveFrom: '2026-10-01T00:00:00Z',
              amountGross: '10.00',
              currency: USD,
              vatRatePct: '20',
              fxRateMode: FxRateMode.MANUAL,
              manualFxRate: '38',
            }),
          ]),
        ]),
      ],
      fxQuotes: [],
    });
    expect(manual.issues).toEqual([]);
    expect(manual.lines).toHaveLength(1);
    expect(manual.lines[0]?.amount.gross.toFixed(2)).toBe('380.00');
    expect(manual.lines[0]?.amount.vat.toFixed(2)).toBe('63.46');
    expect(manual.lines[0]?.fx.source).toBe(FxRateSource.MANUAL);
    expect(manual.lines[0]?.fx.rateDate).toBeNull();

    const auto = buildSellerCostLines({
      snapshot,
      costs: [
        makeCost('a', [
          makeProfile('p1', CostProfileType.COGS, [
            makeVersion({
              effectiveFrom: '2026-10-01T00:00:00Z',
              amountGross: '10.00',
              currency: USD,
              vatRatePct: '20',
              fxRateMode: FxRateMode.AUTO,
            }),
          ]),
        ]),
      ],
      fxQuotes: [],
    });
    expect(auto.lines).toEqual([]);
    expect(auto.issues).toEqual([
      { code: ProfitIssueCode.MISSING_FX_RATE, orderItemId: 'a', detail: 'USD' },
    ]);
  });

  it('reads the archived state from the version valid at the order date', () => {
    const versions = [
      makeVersion({
        effectiveFrom: '2026-10-01T00:00:00Z',
        amountGross: '100.00',
        vatRatePct: '20',
        archivedAt: null,
      }),
      makeVersion({
        effectiveFrom: '2026-10-10T00:00:00Z',
        amountGross: '100.00',
        vatRatePct: '20',
        archivedAt: '2026-10-10T00:00:00Z',
      }),
      makeVersion({
        effectiveFrom: '2026-10-20T00:00:00Z',
        amountGross: '100.00',
        vatRatePct: '20',
        archivedAt: null,
      }),
    ];
    const runAt = (orderDate: string): ReturnType<typeof buildSellerCostLines> =>
      buildSellerCostLines({
        snapshot: makeParcel({
          orderDate: new Date(orderDate),
          items: [makeItem({ orderItemId: 'a', listGross: '500' })],
        }),
        costs: [makeCost('a', [makeProfile('p1', CostProfileType.COGS, versions)])],
        fxQuotes: [],
      });

    const beforeArchive = runAt('2026-10-05T09:00:00Z');
    expect(beforeArchive.issues).toEqual([]);
    expect(beforeArchive.lines).toHaveLength(1);
    expect(beforeArchive.lines[0]?.amount.gross.toFixed(2)).toBe('100.00');

    const duringArchive = runAt('2026-10-15T09:00:00Z');
    expect(duringArchive.lines).toEqual([]);
    expect(duringArchive.issues).toEqual([
      { code: ProfitIssueCode.MISSING_COST, orderItemId: 'a', detail: null },
    ]);

    const afterUnarchive = runAt('2026-10-25T09:00:00Z');
    expect(afterUnarchive.issues).toEqual([]);
    expect(afterUnarchive.lines).toHaveLength(1);
    expect(afterUnarchive.lines[0]?.amount.gross.toFixed(2)).toBe('100.00');
  });

  it('treats a zero-amount profile as costed without a line', () => {
    const snapshot = makeParcel({ items: [makeItem({ orderItemId: 'a', listGross: '500' })] });
    const { lines, issues } = buildSellerCostLines({
      snapshot,
      costs: [
        makeCost('a', [
          makeProfile('p1', CostProfileType.COGS, [
            makeVersion({
              effectiveFrom: '2026-10-01T00:00:00Z',
              amountGross: '0',
              vatRatePct: '20',
            }),
          ]),
        ]),
      ],
      fxQuotes: [],
    });

    expect(lines).toEqual([]);
    expect(issues).toEqual([]);
  });

  it('skips cancelled items', () => {
    const snapshot = makeParcel({
      items: [
        makeItem({ orderItemId: 'a', listGross: '500', isCancelled: true }),
        makeItem({ orderItemId: 'b', listGross: '500' }),
      ],
    });
    const { lines, issues } = buildSellerCostLines({
      snapshot,
      costs: [
        makeCost('a', [
          makeProfile('p1', CostProfileType.COGS, [
            makeVersion({
              effectiveFrom: '2026-10-01T00:00:00Z',
              amountGross: '233.00',
              vatRatePct: '10',
            }),
          ]),
        ]),
        makeCost('b', [
          makeProfile('p2', CostProfileType.COGS, [
            makeVersion({
              effectiveFrom: '2026-10-01T00:00:00Z',
              amountGross: '100.00',
              vatRatePct: '20',
            }),
          ]),
        ]),
      ],
      fxQuotes: [],
    });

    expect(issues).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.orderItemId).toBe('b');
    expect(lines[0]?.amount.gross.toFixed(2)).toBe('100.00');
  });

  it('writes one line per profile when an item has two profiles of the same type', () => {
    const snapshot = makeParcel({ items: [makeItem({ orderItemId: 'a', listGross: '500' })] });
    const { lines, issues } = buildSellerCostLines({
      snapshot,
      costs: [
        makeCost('a', [
          makeProfile('p1', CostProfileType.COGS, [
            makeVersion({
              effectiveFrom: '2026-10-01T00:00:00Z',
              amountGross: '100.00',
              vatRatePct: '20',
            }),
          ]),
          makeProfile('p2', CostProfileType.COGS, [
            makeVersion({
              effectiveFrom: '2026-10-01T00:00:00Z',
              amountGross: '20.00',
              vatRatePct: '20',
            }),
          ]),
        ]),
      ],
      fxQuotes: [],
    });

    expect(issues).toEqual([]);
    expect(lines).toHaveLength(2);
    expect(lines[0]?.type).toBe(ProfitLineType.COST_COGS);
    expect(lines[0]?.amount.gross.toFixed(2)).toBe('100.00');
    expect(lines[0]?.amount.vat.toFixed(2)).toBe('16.67');
    expect(lines[1]?.type).toBe(ProfitLineType.COST_COGS);
    expect(lines[1]?.amount.gross.toFixed(2)).toBe('20.00');
    expect(lines[1]?.amount.vat.toFixed(2)).toBe('3.33');
  });

  it('throws on a cost entry for an unknown item', () => {
    const snapshot = makeParcel({ items: [makeItem({ orderItemId: 'a', listGross: '500' })] });
    expect(() =>
      buildSellerCostLines({
        snapshot,
        costs: [
          makeCost('zzz', [
            makeProfile('p1', CostProfileType.COGS, [
              makeVersion({ effectiveFrom: '2026-10-01T00:00:00Z', amountGross: '100.00' }),
            ]),
          ]),
        ],
        fxQuotes: [],
      }),
    ).toThrow(RangeError);
  });

  it('rejects a manual rate of zero', () => {
    const snapshot = makeParcel({ items: [makeItem({ orderItemId: 'a', listGross: '500' })] });
    const { lines, issues } = buildSellerCostLines({
      snapshot,
      costs: [
        makeCost('a', [
          makeProfile('p1', CostProfileType.COGS, [
            makeVersion({
              effectiveFrom: '2026-10-01T00:00:00Z',
              amountGross: '10.00',
              currency: USD,
              vatRatePct: '20',
              fxRateMode: FxRateMode.MANUAL,
              manualFxRate: '0',
            }),
          ]),
        ]),
      ],
      fxQuotes: [],
    });

    expect(lines).toEqual([]);
    expect(issues).toEqual([
      { code: ProfitIssueCode.MISSING_FX_RATE, orderItemId: 'a', detail: 'MANUAL:USD' },
    ]);
  });
});
