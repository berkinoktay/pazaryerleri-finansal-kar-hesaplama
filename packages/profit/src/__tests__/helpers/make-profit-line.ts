import { Decimal } from 'decimal.js';
import {
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  type ProfitLineType,
} from '@pazarsync/db/enums';

import { getLineSpec } from '../../core/catalog/profit-line-catalog';
import { createProfitLine, type LineMoney, type ProfitLine } from '../../core/profit-line';

export interface MakeLineParams {
  readonly type: ProfitLineType;
  readonly gross: string;
  readonly vat?: string; // default '0'
  readonly level?: ProfitLineLevel; // default: ITEM when the type allows it, else PARCEL
  readonly orderItemId?: string | null; // default: 'item-1' for ITEM, null for PARCEL
  readonly certainty?: ProfitLineCertainty; // default ESTIMATE
  readonly source?: ProfitLineSource; // default RULE
}

function defaultLevel(levels: readonly ProfitLineLevel[]): ProfitLineLevel {
  return levels.includes(ProfitLineLevel.ITEM) ? ProfitLineLevel.ITEM : ProfitLineLevel.PARCEL;
}

function resolveOrderItemId(params: MakeLineParams, level: ProfitLineLevel): string | null {
  if (params.orderItemId === undefined) {
    return level === ProfitLineLevel.ITEM ? 'item-1' : null;
  }
  return params.orderItemId;
}

/** Concise profit line builder for tests: fills defaults, then runs createProfitLine. */
export function makeLine(params: MakeLineParams): ProfitLine {
  const level = params.level ?? defaultLevel(getLineSpec(params.type).levels);
  const amount: LineMoney = {
    gross: new Decimal(params.gross),
    vat: new Decimal(params.vat ?? '0'),
  };
  return createProfitLine({
    type: params.type,
    level,
    orderItemId: resolveOrderItemId(params, level),
    certainty: params.certainty ?? ProfitLineCertainty.ESTIMATE,
    source: params.source ?? ProfitLineSource.RULE,
    amount,
    vatRatePct: null,
    inputs: {},
    externalRecord: null,
  });
}
