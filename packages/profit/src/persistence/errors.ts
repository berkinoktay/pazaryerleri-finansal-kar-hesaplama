import { type Platform } from '@pazarsync/db/enums';

/**
 * Thrown when no order with the given id exists for the current organization.
 * The message deliberately does not distinguish "no such order" from "not this
 * org's order" so a cross-tenant probe cannot learn an id exists.
 */
export class ParcelNotFoundError extends Error {
  constructor(public readonly orderId: string) {
    super(`Order ${orderId} not found for this organization`);
    this.name = 'ParcelNotFoundError';
  }
}

/** Thrown when a parcel's store platform has no profit loader/writer yet. */
export class UnsupportedPlatformError extends Error {
  constructor(public readonly platform: Platform) {
    super(`Profit persistence is not supported for platform ${platform}`);
    this.name = 'UnsupportedPlatformError';
  }
}

/**
 * Thrown when a stored profit row cannot be turned back into an engine value: a
 * malformed line `inputs` object, a half-set external record, or a bad persisted
 * issue entry. The message names the offending field (English, for logs).
 */
export class InvalidStoredProfitDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidStoredProfitDataError';
  }
}
