import {
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
} from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { makeLine } from '../../__tests__/helpers/make-profit-line';
import { selectLines } from '../select-lines';

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
});
