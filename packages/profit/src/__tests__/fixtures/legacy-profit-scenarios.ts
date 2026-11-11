import { Decimal } from 'decimal.js';

const D = (v: string): Decimal => new Decimal(v);

/**
 * The legacy `computeProfit` input shapes, copied here so the frozen scenarios
 * stand on their own once the legacy engine (`src/profit-formula.ts`) is deleted.
 */
export interface ProfitMoneyPair {
  gross: Decimal;
  vat: Decimal;
}

/**
 * A legacy fee. INTERNATIONAL_SERVICE and OVERSEAS_RETURN_OPERATION are micro-export
 * fees; they enter the math as a DEBIT like any other fee.
 */
export interface ProfitInputFee {
  type: 'SHIPPING' | 'PLATFORM_SERVICE' | 'INTERNATIONAL_SERVICE' | 'OVERSEAS_RETURN_OPERATION';
  gross: Decimal;
  vat: Decimal;
  direction: 'DEBIT' | 'CREDIT';
}

export interface ProfitInput {
  sale: ProfitMoneyPair;
  cost: ProfitMoneyPair;
  commission: ProfitMoneyPair;
  fees: ProfitInputFee[];
  stoppage: { gross: Decimal };
  /** false clamps a negative net VAT to zero so the credit does not inflate profit. */
  includeNegativeNetVat: boolean;
}

/**
 * The legacy `computeProfit` output for one scenario, as `Decimal.toString()`
 * strings (null where the legacy engine returned null).
 */
export interface LegacyProfitExpected {
  readonly netProfit: string;
  readonly netVat: string;
  readonly saleMarginPct: string | null;
  readonly costMarkupPct: string | null;
}

/** One legacy scenario: the name is the legacy `it` title, the input is that test's input. */
export interface LegacyProfitScenario {
  readonly name: string;
  readonly input: ProfitInput;
  readonly expected: LegacyProfitExpected;
}

/**
 * The inputs behind the twelve legacy `computeProfit` scenarios in
 * `src/__tests__/profit-formula.test.ts`. Each entry is one `it` from that file:
 * its `input` is that test's exact input (including the `includeNegativeNetVat`
 * flag) and its `name` is the legacy `it` title. Where the legacy file shares a
 * base input across several `it`s and only varies the flag, each `it` is written
 * out here as its own scenario with the flag it used. The three legacy titles
 * that were written in Turkish are translated to English here (the only source
 * change; inputs are untouched). The equivalence test proves the new core
 * reproduces every scenario to the kurus.
 *
 * Each `expected` was produced once from the legacy `computeProfit` engine on
 * 2026-11-11 and frozen here; the legacy engine is deleted in Faz 5.
 */
export const LEGACY_PROFIT_SCENARIOS: readonly LegacyProfitScenario[] = [
  {
    name: 'happy path: 120 sale / 60 cost / 12 commission / 6 shipping / 1 stoppage',
    input: {
      sale: { gross: D('120'), vat: D('20') },
      cost: { gross: D('60'), vat: D('10') },
      commission: { gross: D('12'), vat: D('2') },
      fees: [{ type: 'SHIPPING', gross: D('6'), vat: D('1'), direction: 'DEBIT' }],
      stoppage: { gross: D('1') },
      includeNegativeNetVat: true,
    },
    expected: {
      netProfit: '34',
      netVat: '7',
      saleMarginPct: '28.333333333333333333',
      costMarkupPct: '56.666666666666666667',
    },
  },
  {
    name: 'micro export: international service fee is a DEBIT, not a platform-service bucket; sale VAT %0 reclaims input VAT',
    input: {
      sale: { gross: D('1000'), vat: D('0') },
      cost: { gross: D('600'), vat: D('60') },
      commission: { gross: D('190'), vat: D('38') },
      fees: [{ type: 'INTERNATIONAL_SERVICE', gross: D('60'), vat: D('10'), direction: 'DEBIT' }],
      stoppage: { gross: D('0') },
      includeNegativeNetVat: true,
    },
    expected: {
      netProfit: '258',
      netVat: '-108',
      saleMarginPct: '25.8',
      costMarkupPct: '43',
    },
  },
  {
    name: 'negative Net VAT when input VAT > sale VAT',
    input: {
      sale: { gross: D('100'), vat: D('5') },
      cost: { gross: D('50'), vat: D('10') },
      commission: { gross: D('10'), vat: D('2') },
      fees: [],
      stoppage: { gross: D('0') },
      includeNegativeNetVat: true,
    },
    expected: {
      netProfit: '47',
      netVat: '-7',
      saleMarginPct: '47',
      costMarkupPct: '94',
    },
  },
  {
    name: 'zero sale: saleMarginPct null',
    input: {
      sale: { gross: D('0'), vat: D('0') },
      cost: { gross: D('50'), vat: D('10') },
      commission: { gross: D('0'), vat: D('0') },
      fees: [],
      stoppage: { gross: D('0') },
      includeNegativeNetVat: true,
    },
    expected: {
      netProfit: '-40',
      netVat: '-10',
      saleMarginPct: null,
      costMarkupPct: '-80',
    },
  },
  {
    name: 'zero cost: costMarkupPct null',
    input: {
      sale: { gross: D('100'), vat: D('20') },
      cost: { gross: D('0'), vat: D('0') },
      commission: { gross: D('0'), vat: D('0') },
      fees: [],
      stoppage: { gross: D('0') },
      includeNegativeNetVat: true,
    },
    expected: {
      netProfit: '80',
      netVat: '20',
      saleMarginPct: '80',
      costMarkupPct: null,
    },
  },
  {
    name: 'multi VAT-rate aggregation',
    input: {
      sale: { gross: D('300'), vat: D('50') },
      cost: { gross: D('100'), vat: D('20') },
      commission: { gross: D('30'), vat: D('2.73') },
      fees: [{ type: 'SHIPPING', gross: D('10'), vat: D('0.10'), direction: 'DEBIT' }],
      stoppage: { gross: D('0') },
      includeNegativeNetVat: true,
    },
    expected: {
      netProfit: '132.83',
      netVat: '27.17',
      saleMarginPct: '44.276666666666666667',
      costMarkupPct: '132.83',
    },
  },
  {
    name: 'stoppage reduces profit, NOT in netVat',
    input: {
      sale: { gross: D('100'), vat: D('20') },
      cost: { gross: D('40'), vat: D('8') },
      commission: { gross: D('10'), vat: D('2') },
      fees: [],
      stoppage: { gross: D('0.83') },
      includeNegativeNetVat: true,
    },
    expected: {
      netProfit: '39.17',
      netVat: '10',
      saleMarginPct: '39.17',
      costMarkupPct: '97.925',
    },
  },
  {
    name: 'CREDIT fee adds back to netVat and profit',
    input: {
      sale: { gross: D('100'), vat: D('20') },
      cost: { gross: D('40'), vat: D('8') },
      commission: { gross: D('0'), vat: D('0') },
      fees: [
        { type: 'SHIPPING', gross: D('10'), vat: D('2'), direction: 'DEBIT' },
        { type: 'PLATFORM_SERVICE', gross: D('5'), vat: D('1'), direction: 'CREDIT' },
      ],
      stoppage: { gross: D('0') },
      includeNegativeNetVat: true,
    },
    expected: {
      netProfit: '44',
      netVat: '11',
      saleMarginPct: '44',
      costMarkupPct: '110',
    },
  },
  {
    name: 'algebraic equivalence: gross minus netVat equals the net-convention profit',
    input: {
      sale: { gross: D('120'), vat: D('20') },
      cost: { gross: D('60'), vat: D('10') },
      commission: { gross: D('12'), vat: D('2') },
      fees: [{ type: 'SHIPPING', gross: D('6'), vat: D('1'), direction: 'DEBIT' }],
      stoppage: { gross: D('1') },
      includeNegativeNetVat: true,
    },
    expected: {
      netProfit: '34',
      netVat: '7',
      saleMarginPct: '28.333333333333333333',
      costMarkupPct: '56.666666666666666667',
    },
  },
  {
    name: 'false: negative net VAT is clamped to zero so the credit does not inflate profit',
    input: {
      sale: { gross: D('1000'), vat: D('0') },
      cost: { gross: D('600'), vat: D('60') },
      commission: { gross: D('190'), vat: D('38') },
      fees: [{ type: 'INTERNATIONAL_SERVICE', gross: D('60'), vat: D('10'), direction: 'DEBIT' }],
      stoppage: { gross: D('0') },
      includeNegativeNetVat: false,
    },
    expected: {
      netProfit: '150',
      netVat: '0',
      saleMarginPct: '15',
      costMarkupPct: '25',
    },
  },
  {
    name: 'true: negative net VAT is added back to profit (legacy behavior)',
    input: {
      sale: { gross: D('1000'), vat: D('0') },
      cost: { gross: D('600'), vat: D('60') },
      commission: { gross: D('190'), vat: D('38') },
      fees: [{ type: 'INTERNATIONAL_SERVICE', gross: D('60'), vat: D('10'), direction: 'DEBIT' }],
      stoppage: { gross: D('0') },
      includeNegativeNetVat: true,
    },
    expected: {
      netProfit: '258',
      netVat: '-108',
      saleMarginPct: '25.8',
      costMarkupPct: '43',
    },
  },
  {
    name: 'positive net VAT is always deducted regardless of the flag (false === true)',
    input: {
      sale: { gross: D('120'), vat: D('20') },
      cost: { gross: D('60'), vat: D('10') },
      commission: { gross: D('12'), vat: D('2') },
      fees: [{ type: 'SHIPPING', gross: D('6'), vat: D('1'), direction: 'DEBIT' }],
      stoppage: { gross: D('1') },
      includeNegativeNetVat: false,
    },
    expected: {
      netProfit: '34',
      netVat: '7',
      saleMarginPct: '28.333333333333333333',
      costMarkupPct: '56.666666666666666667',
    },
  },
];
