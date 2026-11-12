/**
 * Pre-body guard for the workbook (spreadsheet) import routes.
 *
 * `@hono/zod-openapi` builds a form validator for every multipart route, and that
 * validator buffers the whole request body before the handler runs. A check that
 * lives in the handler therefore runs only after an arbitrary upload has already
 * been read into memory. These middlewares run as route middleware instead
 * (`createRoute({ middleware })`), which Hono places in front of the validators,
 * so every rejection below happens before a single body byte is parsed.
 */

import { z } from '@hono/zod-openapi';
import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';

import type { MemberRole, Store } from '@pazarsync/db';
import { CAPABILITIES, WORKBOOK_UPLOAD_MAX_BYTES, type Capability } from '@pazarsync/utils';

import { RATE_LIMITS } from '../config/rate-limits';
import { MULTIPART_OVERHEAD_BYTES } from '../config/workbook-limits';
import { ForbiddenError, PayloadTooLargeError, UnsupportedMediaTypeError } from '../lib/errors';
import { assertCapability } from '../lib/require-capability';
import { requireStoreAccess } from '../lib/require-store-access';
import { rateLimit } from './rate-limit.middleware';

/**
 * `storeAccess` is optional on purpose: `storeAccessMiddleware` skips recording
 * it when a path id is not a UUID, so a handler must never assume it is there.
 * Handlers read it through `requireStoreAccessContext`, which refuses a missing
 * or mismatched record.
 */
export type StoreAccessVariables = {
  userId: string;
  storeAccess?: { store: Store; role: MemberRole };
};

type WorkbookImportMiddleware = MiddlewareHandler<{ Variables: StoreAccessVariables }>;

const MULTIPART_FORM_DATA = 'multipart/form-data';

// Same predicate the routes' path schemas apply to `orgId` and `storeId`.
const UuidSchema = z.string().uuid();

/** UUID equality regardless of hex-letter case. */
function sameUuid(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Store access + capability check as route middleware, so a caller who may not
 * write to the store is refused before the request body is read.
 *
 * When `orgId` or `storeId` is not a UUID the check is skipped and the route's
 * params validator (which runs next, using the same UUID rule) answers with its
 * usual 422 VALIDATION_ERROR, so a malformed id never reaches Postgres.
 */
export function storeAccessMiddleware(
  capability: Capability,
): MiddlewareHandler<{ Variables: StoreAccessVariables }> {
  return createMiddleware<{ Variables: StoreAccessVariables }>(async (c, next) => {
    const orgId = UuidSchema.safeParse(c.req.param('orgId'));
    const storeId = UuidSchema.safeParse(c.req.param('storeId'));
    if (!orgId.success || !storeId.success) {
      await next();
      return;
    }

    const { store, role } = await requireStoreAccess(c.get('userId'), orgId.data, storeId.data);
    assertCapability(role, capability);
    c.set('storeAccess', { store, role });
    await next();
  });
}

/**
 * Handler-side counterpart of `storeAccessMiddleware` (defence in depth). The
 * handler calls it right after `c.req.valid('param')` with the validated ids and
 * gets back the access the middleware recorded, but only when that record exists
 * and was made for exactly this org and store. If the middleware was dropped from
 * a route, skipped the check, or a schema change ever let the validated params
 * diverge from the raw path the middleware read, the handler refuses with 403
 * instead of running unchecked.
 *
 * Ids are compared case-insensitively: the path schemas accept an upper-case
 * UUID, while Postgres returns the stored ids in lower case.
 */
export function requireStoreAccessContext(
  c: Context<{ Variables: StoreAccessVariables }>,
  orgId: string,
  storeId: string,
): { store: Store; role: MemberRole } {
  const access = c.get('storeAccess');
  if (access === undefined) {
    throw new ForbiddenError('Store access was not verified for this request');
  }
  if (!sameUuid(access.store.id, storeId) || !sameUuid(access.store.organizationId, orgId)) {
    throw new ForbiddenError('Verified store access does not match the request path');
  }
  return access;
}

/**
 * Caps the raw request body at the file limit plus the multipart envelope.
 * A declared Content-Length above the cap is refused without reading; a
 * chunked body is counted while streaming and refused as soon as it crosses
 * the cap. The error carries the file limit, which is what the seller sees.
 */
export function workbookBodyLimit(): MiddlewareHandler {
  return bodyLimit({
    maxSize: WORKBOOK_UPLOAD_MAX_BYTES + MULTIPART_OVERHEAD_BYTES,
    onError: () => {
      throw new PayloadTooLargeError(WORKBOOK_UPLOAD_MAX_BYTES);
    },
  });
}

/**
 * Refuses any request whose Content-Type is not multipart/form-data, so a
 * JSON or raw body never reaches the form parser.
 */
export function requireMultipart(): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const contentType = c.req.header('Content-Type') ?? '';
    if (!contentType.toLowerCase().startsWith(MULTIPART_FORM_DATA)) {
      throw new UnsupportedMediaTypeError();
    }
    await next();
  });
}

/**
 * The guard chain for every workbook import route. The order is deliberate:
 *   1. rate limit: in-memory and cheapest, so a flood is cut off first;
 *   2. store access + capability: one DB lookup, and a caller who may not
 *      write to the store never gets their body read at all;
 *   3. content type: a free header check, so a JSON or raw body is refused
 *      before a single body byte is read (a chunked body without
 *      Content-Length is never buffered by the body limit);
 *   4. body size: only now is the body (at most) counted, never parsed, right
 *      before the form parser.
 *
 * Typed as a mutable tuple rather than `as const`: `createRoute({ middleware })`
 * accepts `H | H[]`, and a readonly tuple is not assignable to `H[]`. Every
 * element shares the store-access env so the handler sees `storeAccess` typed.
 */
export const WORKBOOK_IMPORT_MIDDLEWARE: [
  WorkbookImportMiddleware,
  WorkbookImportMiddleware,
  WorkbookImportMiddleware,
  WorkbookImportMiddleware,
] = [
  rateLimit(RATE_LIMITS.FILE_IMPORT),
  storeAccessMiddleware(CAPABILITIES.DATA_WRITE),
  requireMultipart(),
  workbookBodyLimit(),
];
