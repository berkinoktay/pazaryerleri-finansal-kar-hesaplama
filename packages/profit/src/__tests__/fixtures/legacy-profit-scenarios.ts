import { Decimal } from 'decimal.js';

import { type ProfitInput } from '../../profit-formula';

const D = (v: string): Decimal => new Decimal(v);

/** One legacy scenario: the name is the legacy `it` title, the input is that test's input. */
export interface LegacyProfitScenario {
  readonly name: string;
  readonly input: ProfitInput;
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
  },
];
