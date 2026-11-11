import {
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
} from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { makeLine } from '../../__tests__/helpers/make-profit-line';
import { ProfitLineLevelConflictError, selectLines } from '../select-lines';

const act = ProfitLineCertainty.ACTUAL;
const ovr = ProfitLineCertainty.USER_OVERRIDE;

describe('selectLines (BEST_KNOWN)', () => {
  it('keeps estimates when nothing better exists', () => {
    const a = makeLine({ type: ProfitLineType.COMMISSION, gross: '10', orderItemId: 'a' });
    const b = makeLine({ type: ProfitLineType.COMMISSION, gross: '20', orderItemId: 'b' });
    expect(selectLines([a, b], 'BEST_KNOWN')).toEqual([a, b]);
  });
  it('an actual for one item replaces only that item estimate', () => {
    const estA = makeLine({ type: ProfitLineType.COMMISSION, gross: '10', orderItemId: 'a' });
    const estB = makeLine({ type: ProfitLineType.COMMISSION, gross: '20', orderItemId: 'b' });
    const actA = makeLine({
      type: ProfitLineType.COMMISSION,
      gross: '11',
      orderItemId: 'a',
      certainty: act,
      source: ProfitLineSource.MARKETPLACE_RECORD,
    });
    expect(selectLines([estA, estB, actA], 'BEST_KNOWN')).toEqual([estB, actA]);
  });
  it('a cargo invoice replaces the shipping estimate', () => {
    const e = makeLine({ type: ProfitLineType.SHIPPING, gross: '6' });
    const a = makeLine({
      type: ProfitLineType.SHIPPING,
      gross: '9',
      certainty: act,
      source: ProfitLineSource.CARGO_INVOICE,
    });
    expect(selectLines([e, a], 'BEST_KNOWN')).toEqual([a]);
  });
  it('a user override beats an estimate and an actual beats the override', () => {
    const e = makeLine({ type: ProfitLineType.SHIPPING, gross: '6' });
    const o = makeLine({
      type: ProfitLineType.SHIPPING,
      gross: '7',
      certainty: ovr,
      source: ProfitLineSource.USER,
    });
    const a = makeLine({
      type: ProfitLineType.SHIPPING,
      gross: '9',
      certainty: act,
      source: ProfitLineSource.CARGO_INVOICE,
    });
    expect(selectLines([e, o], 'BEST_KNOWN')).toEqual([o]);
    expect(selectLines([e, o, a], 'BEST_KNOWN')).toEqual([a]);
  });
  it('keeps both actual records in the same slot so they are summed', () => {
    // Review focus 3
    const a1 = makeLine({
      type: ProfitLineType.COMMISSION,
      gross: '10',
      certainty: act,
      source: ProfitLineSource.MARKETPLACE_RECORD,
    });
    const a2 = makeLine({
      type: ProfitLineType.COMMISSION,
      gross: '1.50',
      certainty: act,
      source: ProfitLineSource.MARKETPLACE_RECORD,
    });
    expect(selectLines([a1, a2], 'BEST_KNOWN')).toEqual([a1, a2]);
  });
  it('a parcel-level actual supersedes item-level estimates of the same type', () => {
    const eA = makeLine({ type: ProfitLineType.STOPPAGE, gross: '4.47', orderItemId: 'a' });
    const eB = makeLine({ type: ProfitLineType.STOPPAGE, gross: '3.46', orderItemId: 'b' });
    const aP = makeLine({
      type: ProfitLineType.STOPPAGE,
      gross: '7.93',
      level: ProfitLineLevel.PARCEL,
      orderItemId: null,
      certainty: act,
      source: ProfitLineSource.MARKETPLACE_RECORD,
    });
    expect(selectLines([eA, eB, aP], 'BEST_KNOWN')).toEqual([aP]);
  });
  it('keeps actual-only lines that never had an estimate', () => {
    const p = makeLine({
      type: ProfitLineType.PENALTY,
      gross: '50',
      level: ProfitLineLevel.PARCEL,
      orderItemId: null,
      certainty: act,
      source: ProfitLineSource.MARKETPLACE_RECORD,
    });
    expect(selectLines([p], 'BEST_KNOWN')).toEqual([p]);
  });
  it('throws when estimates of one type exist at both levels', () => {
    // A type stands for a single fee within a parcel, so a parcel estimate plus an
    // item estimate of the same type would be summed twice. That is a producer bug.
    const parcel = makeLine({
      type: ProfitLineType.SERVICE_FEE,
      gross: '13.19',
      level: ProfitLineLevel.PARCEL,
      orderItemId: null,
    });
    const item = makeLine({
      type: ProfitLineType.SERVICE_FEE,
      gross: '6.60',
      orderItemId: 'a',
    });
    expect(() => selectLines([parcel, item], 'BEST_KNOWN')).toThrow(ProfitLineLevelConflictError);
  });
  it('throws when a parcel estimate meets item-level actuals', () => {
    // The parcel estimate drops when any item actual arrives, so items without an
    // actual lose their share. Only partial coverage reached settlement: producer bug.
    const parcel = makeLine({
      type: ProfitLineType.SERVICE_FEE,
      gross: '13.19',
      level: ProfitLineLevel.PARCEL,
      orderItemId: null,
    });
    const itemActual = makeLine({
      type: ProfitLineType.SERVICE_FEE,
      gross: '6.60',
      orderItemId: 'a',
      certainty: act,
      source: ProfitLineSource.MARKETPLACE_RECORD,
    });
    expect(() => selectLines([parcel, itemActual], 'BEST_KNOWN')).toThrow(
      ProfitLineLevelConflictError,
    );
  });
  it('allows actual records of one type at both levels and keeps both', () => {
    // Settlement may report the same fee at both levels; actuals are summed, not a conflict.
    const parcelActual = makeLine({
      type: ProfitLineType.STOPPAGE,
      gross: '2.00',
      level: ProfitLineLevel.PARCEL,
      orderItemId: null,
      certainty: act,
      source: ProfitLineSource.MARKETPLACE_RECORD,
    });
    const itemActual = makeLine({
      type: ProfitLineType.STOPPAGE,
      gross: '1.00',
      orderItemId: 'a',
      certainty: act,
      source: ProfitLineSource.MARKETPLACE_RECORD,
    });
    expect(selectLines([parcelActual, itemActual], 'BEST_KNOWN')).toEqual([
      parcelActual,
      itemActual,
    ]);
  });
});

describe('selectLines (ESTIMATE)', () => {
  it('drops marketplace actuals but keeps seller input', () => {
    const cost = makeLine({
      type: ProfitLineType.COST_COGS,
      gross: '60',
      certainty: act,
      source: ProfitLineSource.SELLER_INPUT,
    });
    const e = makeLine({ type: ProfitLineType.SHIPPING, gross: '6' });
    const a = makeLine({
      type: ProfitLineType.SHIPPING,
      gross: '9',
      certainty: act,
      source: ProfitLineSource.CARGO_INVOICE,
    });
    expect(selectLines([cost, e, a], 'ESTIMATE')).toEqual([cost, e]);
  });
  it('ESTIMATE mode keeps a user override over the estimate', () => {
    const e = makeLine({ type: ProfitLineType.SHIPPING, gross: '6' });
    const o = makeLine({
      type: ProfitLineType.SHIPPING,
      gross: '7',
      certainty: ovr,
      source: ProfitLineSource.USER,
    });
    expect(selectLines([e, o], 'ESTIMATE')).toEqual([o]);
  });
});
