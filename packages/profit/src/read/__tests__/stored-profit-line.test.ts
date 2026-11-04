import { Decimal } from 'decimal.js';
import {
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
} from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { InvalidStoredProfitDataError } from '../../persistence/errors';
import { toProfitLine, type StoredProfitLineRow } from '../stored-profit-line';

/** A valid COST_COGS item row; tests override single fields to exercise the guards. */
function makeRow(overrides: Partial<StoredProfitLineRow> = {}): StoredProfitLineRow {
  return {
    orderId: 'order-1',
    orderItemId: 'item-1',
    type: ProfitLineType.COST_COGS,
    level: ProfitLineLevel.ITEM,
    certainty: ProfitLineCertainty.ESTIMATE,
    source: ProfitLineSource.RULE,
    amountGross: new Decimal('233.00'),
    amountVat: new Decimal('21.18'),
    vatRatePct: new Decimal('10'),
    inputs: { quantity: '1', refunded: false, note: null },
    externalRecordId: null,
    externalRecordType: null,
    ...overrides,
  };
}

describe('toProfitLine', () => {
  it('rebuilds a line from its stored row', () => {
    const line = toProfitLine(makeRow());

    expect(line.type).toBe(ProfitLineType.COST_COGS);
    expect(line.level).toBe(ProfitLineLevel.ITEM);
    expect(line.orderItemId).toBe('item-1');
    expect(line.certainty).toBe(ProfitLineCertainty.ESTIMATE);
    expect(line.source).toBe(ProfitLineSource.RULE);
    expect(line.amount.gross.toFixed(2)).toBe('233.00');
    expect(line.amount.vat.toFixed(2)).toBe('21.18');
    expect(line.vatRatePct?.toFixed()).toBe('10');
    expect(line.inputs).toEqual({ quantity: '1', refunded: false, note: null });
    expect(line.externalRecord).toBeNull();

    // A both-set external record pair rebuilds into a ref.
    const actual = toProfitLine(
      makeRow({
        type: ProfitLineType.COMMISSION,
        certainty: ProfitLineCertainty.ACTUAL,
        source: ProfitLineSource.MARKETPLACE_RECORD,
        externalRecordId: 'rec-1',
        externalRecordType: 'Sale',
      }),
    );
    expect(actual.externalRecord).toEqual({ recordId: 'rec-1', rawType: 'Sale' });
  });

  it('rejects inputs that are not a flat object', () => {
    expect(() => toProfitLine(makeRow({ inputs: ['a', 'b'] }))).toThrow(
      InvalidStoredProfitDataError,
    );
    expect(() => toProfitLine(makeRow({ inputs: { nested: { deep: 'x' } } }))).toThrow(
      InvalidStoredProfitDataError,
    );
    expect(() => toProfitLine(makeRow({ inputs: { count: 3 } }))).toThrow(
      InvalidStoredProfitDataError,
    );
  });

  it('rejects a half-set external record', () => {
    expect(() =>
      toProfitLine(makeRow({ externalRecordId: 'rec-1', externalRecordType: null })),
    ).toThrow(InvalidStoredProfitDataError);
    expect(() =>
      toProfitLine(makeRow({ externalRecordId: null, externalRecordType: 'Sale' })),
    ).toThrow(InvalidStoredProfitDataError);
  });
});
