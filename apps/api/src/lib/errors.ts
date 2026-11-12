/**
 * Domain errors that the `app.onError` handler translates to RFC 7807
 * ProblemDetails responses. The `code` field is SCREAMING_SNAKE_CASE and
 * stable across minor releases — the frontend maps it to i18n strings.
 *
 * The classes whose use is shared with the sync worker process live in
 * `@pazarsync/sync-core` (so the worker can import them without reaching
 * back into `apps/api/src/`). They are re-exported here so existing call
 * sites in `apps/api/` continue to import from `../lib/errors` unchanged.
 *
 * Cost-profile-specific error classes live here (not in sync-core) because
 * they are API-only — the sync worker does not handle cost profiles.
 */

export {
  ConflictError,
  InvalidReferenceError,
  MarketplaceAccessError,
  MarketplaceAuthError,
  MarketplaceUnreachable,
  NotFoundError,
  RateLimitedError,
  SyncInProgressError,
  ValidationError,
  type ValidationIssue,
} from '@pazarsync/sync-core';

// ─── Cost-profile domain errors ────────────────────────────────────────────
// Per spec §6.7. Subclasses of the shared base classes so existing
// `instanceof ConflictError` / `instanceof NotFoundError` guards in
// problem-details.ts still match. problem-details.ts checks more-specific
// subclasses FIRST so the domain code is preserved on the wire.

export class CostProfileNameTakenError extends Error {
  readonly status = 409 as const;
  readonly code = 'COST_PROFILE_NAME_TAKEN' as const;

  constructor(name: string) {
    super(`A cost profile named "${name}" already exists in this organization`);
    this.name = 'CostProfileNameTakenError';
  }
}

export class CostProfileNotFoundError extends Error {
  readonly status = 404 as const;
  readonly code = 'COST_PROFILE_NOT_FOUND' as const;

  constructor(profileId: string) {
    super(`Cost profile ${profileId} not found`);
    this.name = 'CostProfileNotFoundError';
  }
}

/**
 * Used in PR 3 (variant attachment): thrown when the caller tries to attach
 * an archived cost profile to a product variant.
 */
export class CostProfileArchivedCannotAttachError extends Error {
  readonly status = 409 as const;
  readonly code = 'COST_PROFILE_ARCHIVED_CANNOT_ATTACH' as const;

  constructor(profileId: string) {
    super(`Cost profile ${profileId} is archived and cannot be attached to a variant`);
    this.name = 'CostProfileArchivedCannotAttachError';
  }
}

/**
 * Used in PR 3 (variant attachment): thrown when the variant being attached
 * belongs to a different organization than the cost profile.
 */
export class CostProfileVariantOrgMismatchError extends Error {
  readonly status = 422 as const;
  readonly code = 'COST_PROFILE_VARIANT_ORG_MISMATCH' as const;

  constructor(profileId: string, variantId: string) {
    super(
      `Variant ${variantId} does not belong to the same organization as cost profile ${profileId}`,
    );
    this.name = 'CostProfileVariantOrgMismatchError';
  }
}

// ─── Shipping-config domain errors ────────────────────────────────────────
// Per spec docs/superpowers/specs/2026-05-17-shipping-cost-estimation-design.md
// §6.4. The cross-platform carrier guard needs its own stable wire code so the
// frontend can render a distinct message ("Trendyol mağazasına Hepsiburada
// taşıyıcısı atanamaz" vs the generic INVALID_REFERENCE). The base
// `InvalidReferenceError` collapses both to `INVALID_REFERENCE` because its
// `errors[].code` is hardcoded in problem-details.ts; we deliberately use a
// dedicated class instead so the code is preserved end-to-end.

export class ShippingCarrierPlatformMismatchError extends Error {
  readonly status = 422 as const;
  readonly code = 'SHIPPING_CARRIER_PLATFORM_MISMATCH' as const;
  readonly meta: { expected: string; got: string };

  constructor(meta: { expected: string; got: string }) {
    super(
      `Shipping carrier platform mismatch: store expects '${meta.expected}', carrier is '${meta.got}'`,
    );
    this.name = 'ShippingCarrierPlatformMismatchError';
    this.meta = meta;
  }
}

/**
 * Used by the Trendyol price-write endpoint: thrown when the marketplace
 * accepts the price-update request but the per-item batch outcome resolves to
 * FAILED (e.g. invalid barcode, rrp < buyingPrice, barcode already updated
 * today — Trendyol's once-per-day throttle). The submit succeeded, so this is
 * not an auth/unreachable error; the *item* was rejected. 422 because the
 * caller's input (the price, for that barcode, today) is what Trendyol refused.
 * `errorCode` echoes the vendor failure reason for support correlation; it is
 * a vendor string, not localized — the frontend renders a generic message.
 */
export class MarketplaceWriteFailedError extends Error {
  readonly status = 422 as const;
  readonly code = 'MARKETPLACE_WRITE_FAILED' as const;
  readonly meta: { platform: string; errorCode: string };

  constructor(platform: string, errorCode: string) {
    super(`Marketplace rejected the price update for ${platform}: ${errorCode}`);
    this.name = 'MarketplaceWriteFailedError';
    this.meta = { platform, errorCode };
  }
}

export class UnauthorizedError extends Error {
  readonly status = 401 as const;
  readonly code = 'UNAUTHENTICATED' as const;

  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  readonly status = 403 as const;
  readonly code = 'FORBIDDEN' as const;

  constructor(message = 'Access denied') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

// --- Upload / import transport errors ---------------------------------------
// Raised by the workbook upload guard and the import services. They describe
// the request transport (body size, content type) or server capacity, not the
// file contents, so each has its own stable wire code instead of folding into
// VALIDATION_ERROR.

/**
 * Thrown when a request body exceeds the upload size limit. `meta.maxBytes`
 * carries the user-facing limit (the file limit, not the multipart envelope)
 * so the frontend can render it.
 */
export class PayloadTooLargeError extends Error {
  readonly status = 413 as const;
  readonly code = 'PAYLOAD_TOO_LARGE' as const;
  readonly meta: { maxBytes: number };

  constructor(maxBytes: number) {
    super(`Request body exceeds the ${maxBytes.toString()}-byte limit`);
    this.name = 'PayloadTooLargeError';
    this.meta = { maxBytes };
  }
}

/**
 * Thrown when a request arrives with a content type the route does not accept
 * (e.g. a JSON body on a multipart file-upload route).
 */
export class UnsupportedMediaTypeError extends Error {
  readonly status = 415 as const;
  readonly code = 'UNSUPPORTED_MEDIA_TYPE' as const;

  constructor(message = 'Unsupported request content type') {
    super(message);
    this.name = 'UnsupportedMediaTypeError';
  }
}

/**
 * Thrown when an import transaction cannot get a database slot in time
 * (transaction start/timeout or connection-pool wait). Transient: paired with
 * a `Retry-After` header so the client can retry after `retryAfterSeconds`.
 */
export class ImportBusyError extends Error {
  readonly status = 503 as const;
  readonly code = 'IMPORT_BUSY' as const;
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('The server is busy and could not process the import');
    this.name = 'ImportBusyError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
