import { describe, expect, it } from 'vitest';

import type { MappedClaim, MappedClaimItem } from '@pazarsync/marketplace';

import {
  claimProfitInputsChanged,
  pickChangedFields,
  type StoredClaimForChange,
} from '../../src/handlers/claim-change';

const RETURN_PACKAGE_ID = '91982454';
const CARGO_TRACKING_NUMBER = '7330000166478931';
const CLAIM_ITEM_ID = 'unit-1';
const ORDER_ITEM_ID = 'order-item-1';
const OTHER_ORDER_ITEM_ID = 'order-item-2';
const STATUS_WAITING = 'WaitingInAction';
const STATUS_ACCEPTED = 'Accepted';

function mappedItem(over: Partial<MappedClaimItem> = {}): MappedClaimItem {
  return {
    trendyolClaimItemId: CLAIM_ITEM_ID,
    orderLineId: '10230838',
    reasonCode: 'ABANDON',
    reasonName: 'Abandon',
    status: STATUS_WAITING,
    acceptedBySeller: false,
    autoApproveDate: null,
    resolved: false,
    ...over,
  };
}

function mappedClaim(over: Partial<MappedClaim> = {}): MappedClaim {
  return {
    trendyolClaimId: 'claim-1',
    orderNumber: '950608199',
    orderOutboundPackageId: '91982453',
    orderShipmentPackageId: RETURN_PACKAGE_ID,
    claimDate: new Date(Date.now() - 60_000),
    lastModifiedDate: new Date(),
    cargoProviderName: 'Trendyol Express Marketplace',
    cargoTrackingNumber: CARGO_TRACKING_NUMBER,
    resolved: false,
    items: [mappedItem()],
    ...over,
  };
}

function storedClaim(over: Partial<StoredClaimForChange> = {}): StoredClaimForChange {
  return {
    orderShipmentPackageId: RETURN_PACKAGE_ID,
    cargoTrackingNumber: BigInt(CARGO_TRACKING_NUMBER),
    items: [
      { trendyolClaimItemId: CLAIM_ITEM_ID, status: STATUS_WAITING, orderItemId: ORDER_ITEM_ID },
    ],
    ...over,
  };
}

function links(orderItemId: string | null): ReadonlyMap<string, string | null> {
  return new Map([[CLAIM_ITEM_ID, orderItemId]]);
}

describe('claimProfitInputsChanged', () => {
  it('is true for a claim that is not stored yet', () => {
    expect(claimProfitInputsChanged(null, mappedClaim(), links(ORDER_ITEM_ID))).toBe(true);
  });

  it('is true when the return package id is filled in', () => {
    const stored = storedClaim({ orderShipmentPackageId: null });
    expect(claimProfitInputsChanged(stored, mappedClaim(), links(ORDER_ITEM_ID))).toBe(true);
  });

  it('is true when the cargo tracking number is filled in', () => {
    const stored = storedClaim({ cargoTrackingNumber: null });
    expect(claimProfitInputsChanged(stored, mappedClaim(), links(ORDER_ITEM_ID))).toBe(true);
  });

  it('is true when an incoming claim item is not stored yet', () => {
    const incoming = mappedClaim({
      items: [mappedItem(), mappedItem({ trendyolClaimItemId: 'unit-2' })],
    });
    const resolved = new Map([
      [CLAIM_ITEM_ID, ORDER_ITEM_ID],
      ['unit-2', ORDER_ITEM_ID],
    ]);
    expect(claimProfitInputsChanged(storedClaim(), incoming, resolved)).toBe(true);
  });

  it('is true when a claim item status changes', () => {
    const incoming = mappedClaim({ items: [mappedItem({ status: STATUS_ACCEPTED })] });
    expect(claimProfitInputsChanged(storedClaim(), incoming, links(ORDER_ITEM_ID))).toBe(true);
  });

  it('is true when a resolved item link differs from the stored link', () => {
    expect(claimProfitInputsChanged(storedClaim(), mappedClaim(), links(OTHER_ORDER_ITEM_ID))).toBe(
      true,
    );
    const unlinked = storedClaim({
      items: [{ trendyolClaimItemId: CLAIM_ITEM_ID, status: STATUS_WAITING, orderItemId: null }],
    });
    expect(claimProfitInputsChanged(unlinked, mappedClaim(), links(ORDER_ITEM_ID))).toBe(true);
  });

  it('is true when a stored return package id or tracking number is replaced by another', () => {
    expect(
      claimProfitInputsChanged(
        storedClaim(),
        mappedClaim({ orderShipmentPackageId: '91982455' }),
        links(ORDER_ITEM_ID),
      ),
    ).toBe(true);
    expect(
      claimProfitInputsChanged(
        storedClaim(),
        mappedClaim({ cargoTrackingNumber: '7330000166478932' }),
        links(ORDER_ITEM_ID),
      ),
    ).toBe(true);
  });

  it('is false for an identical claim', () => {
    expect(claimProfitInputsChanged(storedClaim(), mappedClaim(), links(ORDER_ITEM_ID))).toBe(
      false,
    );
  });

  it('is false when this scan could not resolve a link the stored item already has', () => {
    expect(claimProfitInputsChanged(storedClaim(), mappedClaim(), links(null))).toBe(false);
  });

  it('is false when a sparse scan carries no return package id or tracking number', () => {
    const sparse = mappedClaim({ orderShipmentPackageId: null, cargoTrackingNumber: null });
    expect(claimProfitInputsChanged(storedClaim(), sparse, links(ORDER_ITEM_ID))).toBe(false);
  });
});

describe('pickChangedFields', () => {
  it('keeps only the keys whose value differs from the stored row', () => {
    const changed = pickChangedFields(
      { status: STATUS_ACCEPTED, resolved: false, orderItemId: ORDER_ITEM_ID },
      { status: STATUS_WAITING, resolved: false, orderItemId: ORDER_ITEM_ID },
    );
    expect(changed).toEqual({ status: STATUS_ACCEPTED });
  });

  it('compares bigints by value and dates by instant', () => {
    const at = Date.now();
    const changed = pickChangedFields(
      { cargoTrackingNumber: BigInt(CARGO_TRACKING_NUMBER), autoApproveDate: new Date(at) },
      { cargoTrackingNumber: BigInt(CARGO_TRACKING_NUMBER), autoApproveDate: new Date(at) },
    );
    expect(changed).toEqual({});
  });

  it('compares a JSON value regardless of key order (jsonb reorders keys)', () => {
    const changed = pickChangedFields(
      {
        externalRef: {
          orderOutboundPackageId: '1',
          orderShipmentPackageId: '2',
          lastModifiedDate: null,
        },
      },
      {
        externalRef: {
          lastModifiedDate: null,
          orderOutboundPackageId: '1',
          orderShipmentPackageId: '2',
        },
      },
    );
    expect(changed).toEqual({});
  });

  it('keeps a JSON value whose content changed', () => {
    const next = { externalRef: { orderShipmentPackageId: '3' } };
    expect(pickChangedFields(next, { externalRef: { orderShipmentPackageId: '2' } })).toEqual(next);
  });
});
