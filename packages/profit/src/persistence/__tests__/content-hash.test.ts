import { Decimal } from 'decimal.js';
import {
  ProfitAllocationBasis,
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
} from '@pazarsync/db/enums';
import { type ResolvedProfitSettings } from '@pazarsync/utils';
import { describe, expect, it } from 'vitest';

import {
  createProfitLine,
  type ExternalRecordRef,
  type LineMoney,
  type ProfitLine,
  type ProfitLineInputs,
} from '../../core/profit-line';
import { computeProfitStatement, type ProfitStatement } from '../../core/profit-statement';
import {
  type ContentHashAllocation,
  InvalidContentHashInputError,
  profitContentHash,
  type ProfitContentHashInput,
} from '../content-hash';

const SETTINGS: ResolvedProfitSettings = { includeStopaj: true, includeNegativeNetVat: false };

/** A profit line with explicit control over the fields the hash covers. */
function line(params: {
  readonly type: ProfitLineType;
  readonly level?: ProfitLineLevel;
  readonly orderItemId: string | null;
  readonly gross: string;
  readonly vat?: string;
  readonly certainty?: ProfitLineCertainty;
  readonly source?: ProfitLineSource;
  readonly inputs?: ProfitLineInputs;
  readonly externalRecord?: ExternalRecordRef | null;
}): ProfitLine {
  const amount: LineMoney = {
    gross: new Decimal(params.gross),
    vat: new Decimal(params.vat ?? '0'),
  };
  return createProfitLine({
    type: params.type,
    level: params.level ?? ProfitLineLevel.ITEM,
    orderItemId: params.orderItemId,
    certainty: params.certainty ?? ProfitLineCertainty.ESTIMATE,
    source: params.source ?? ProfitLineSource.RULE,
    amount,
    vatRatePct: null,
    inputs: params.inputs ?? {},
    externalRecord: params.externalRecord ?? null,
  });
}

const saleItem1 = (): ProfitLine =>
  line({ type: ProfitLineType.SALE, orderItemId: 'item-1', gross: '491.28', vat: '44.66' });
const saleItem2 = (): ProfitLine =>
  line({ type: ProfitLineType.SALE, orderItemId: 'item-2', gross: '100.00', vat: '10.00' });
const costItem1 = (): ProfitLine =>
  line({
    type: ProfitLineType.COST_COGS,
    orderItemId: 'item-1',
    gross: '60.00',
    vat: '10.00',
    certainty: ProfitLineCertainty.ACTUAL,
    source: ProfitLineSource.SELLER_INPUT,
  });
const commissionItem1 = (): ProfitLine =>
  line({ type: ProfitLineType.COMMISSION, orderItemId: 'item-1', gross: '12.00', vat: '2.00' });
const shippingParcel = (inputs: ProfitLineInputs): ProfitLine =>
  line({
    type: ProfitLineType.SHIPPING,
    level: ProfitLineLevel.PARCEL,
    orderItemId: null,
    gross: '98.34',
    vat: '16.39',
    inputs,
  });

// The SHIPPING line is the parcel-level line the allocations point at.
const SHIPPING_INPUTS: ProfitLineInputs = { desi: '2', carrier: 'SENDEOMP', barem: false };

function baseLines(): ProfitLine[] {
  return [
    saleItem1(),
    saleItem2(),
    costItem1(),
    commissionItem1(),
    shippingParcel(SHIPPING_INPUTS),
  ];
}

const SHIPPING_INDEX = 4;

function baseAllocations(): ContentHashAllocation[] {
  return [
    {
      lineIndex: SHIPPING_INDEX,
      allocation: {
        orderItemId: 'item-1',
        amount: { gross: new Decimal('49.17'), vat: new Decimal('8.20') },
        basisUsed: ProfitAllocationBasis.STANDALONE_AMOUNT,
      },
    },
    {
      lineIndex: SHIPPING_INDEX,
      allocation: {
        orderItemId: 'item-2',
        amount: { gross: new Decimal('49.17'), vat: new Decimal('8.19') },
        basisUsed: ProfitAllocationBasis.STANDALONE_AMOUNT,
      },
    },
  ];
}

function statementsOf(lines: readonly ProfitLine[]): ProfitStatement[] {
  return (['ESTIMATE', 'BEST_KNOWN'] as const).map((view) =>
    computeProfitStatement({
      lines,
      view,
      settings: SETTINGS,
      isExportSale: false,
      isCancelled: false,
      isExcluded: false,
      issues: [],
    }),
  );
}

function baseInput(): ProfitContentHashInput {
  const lines = baseLines();
  return {
    engineVersion: 1,
    settings: SETTINGS,
    lines,
    allocations: baseAllocations(),
    statements: statementsOf(lines),
  };
}

describe('profitContentHash', () => {
  it('gives the same hash for the same content in a different order', () => {
    const inputA = baseInput();

    // Reverse the lines, remap each allocation's lineIndex to the SHIPPING line's new
    // position, reverse the allocation and statement arrays, and rebuild the SHIPPING
    // line's inputs with the keys inserted in another order. Nothing of substance changed.
    const linesB: ProfitLine[] = [
      shippingParcel({ barem: false, carrier: 'SENDEOMP', desi: '2' }),
      commissionItem1(),
      costItem1(),
      saleItem2(),
      saleItem1(),
    ];
    const shippingIndexB = 0;
    const allocationsB: ContentHashAllocation[] = [...baseAllocations()]
      .reverse()
      .map((entry) => ({ lineIndex: shippingIndexB, allocation: entry.allocation }));
    const statementsB = [...statementsOf(linesB)].reverse();

    const inputB: ProfitContentHashInput = {
      engineVersion: 1,
      settings: { includeNegativeNetVat: false, includeStopaj: true },
      lines: linesB,
      allocations: allocationsB,
      statements: statementsB,
    };

    expect(profitContentHash(inputB)).toBe(profitContentHash(inputA));
  });

  it('changes the hash when one amount changes by a kurus', () => {
    const base = profitContentHash(baseInput());

    // A line amount.
    const lineInput = baseInput();
    const bumpedLines = lineInput.lines.map((existing, index) =>
      index === 0
        ? line({ type: ProfitLineType.SALE, orderItemId: 'item-1', gross: '491.29', vat: '44.66' })
        : existing,
    );
    expect(profitContentHash({ ...lineInput, lines: bumpedLines })).not.toBe(base);

    // An allocation amount.
    const allocInput = baseInput();
    const bumpedAllocations = allocInput.allocations.map((entry, index) =>
      index === 0
        ? {
            lineIndex: entry.lineIndex,
            allocation: {
              ...entry.allocation,
              amount: {
                gross: entry.allocation.amount.gross.add(new Decimal('0.01')),
                vat: entry.allocation.amount.vat,
              },
            },
          }
        : entry,
    );
    expect(profitContentHash({ ...allocInput, allocations: bumpedAllocations })).not.toBe(base);

    // A statement net profit.
    const stmtInput = baseInput();
    const bumpedStatements = stmtInput.statements.map((statement) => {
      if (statement.view !== 'BEST_KNOWN') {
        return statement;
      }
      if (statement.netProfit === null) {
        throw new Error('fixture: the BEST_KNOWN statement should be computable');
      }
      return { ...statement, netProfit: statement.netProfit.add(new Decimal('0.01')) };
    });
    expect(profitContentHash({ ...stmtInput, statements: bumpedStatements })).not.toBe(base);
  });

  it('changes the hash when the engine version changes', () => {
    const input = baseInput();
    expect(profitContentHash({ ...input, engineVersion: 2 })).not.toBe(profitContentHash(input));
  });

  it('changes the hash when a setting changes', () => {
    const input = baseInput();
    const flipped = profitContentHash({
      ...input,
      settings: { includeStopaj: true, includeNegativeNetVat: true },
    });
    expect(flipped).not.toBe(profitContentHash(input));
  });

  it('changes the hash when an allocation moves to another item', () => {
    const input = baseInput();
    const moved = input.allocations.map((entry, index) =>
      index === 0
        ? { lineIndex: entry.lineIndex, allocation: { ...entry.allocation, orderItemId: 'item-2' } }
        : entry,
    );
    expect(profitContentHash({ ...input, allocations: moved })).not.toBe(profitContentHash(input));
  });

  it('rejects an allocation that points outside the lines', () => {
    const input = baseInput();
    const sample = baseAllocations()[0];
    if (sample === undefined) {
      throw new Error('fixture: expected at least one allocation');
    }
    const outOfRange: readonly number[] = [-1, input.lines.length, 1.5];
    for (const lineIndex of outOfRange) {
      const bad: ContentHashAllocation[] = [{ lineIndex, allocation: sample.allocation }];
      expect(() => profitContentHash({ ...input, allocations: bad })).toThrow(
        InvalidContentHashInputError,
      );
    }
  });

  it('returns a 64-character lowercase hex digest', () => {
    expect(profitContentHash(baseInput())).toMatch(/^[0-9a-f]{64}$/);
  });
});
