import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { importFlashProducts } from '../../services/flash-product-import.service';
import {
  FlashProductStorePathSchema,
  ImportFlashProductsFormSchema,
  ImportFlashProductsResponseSchema,
} from '../../validators/flash-product.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const importFlashProductsRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/stores/{storeId}/flash-products/import',
  tags: ['FlashProducts'],
  summary: 'Import a Trendyol Flash Products Excel',
  description:
    "Uploads Trendyol's Flaş Ürünler .xlsx (multipart `file`). Every column is resolved by header " +
    'name. A row carries up to two flash offers — a 24-hour window and a 3-hour window, each with its ' +
    'own price and start/end dates — and the same product can appear on several rows (different dates). ' +
    'Each offer row is joined to a ProductVariant by barcode and stored as one item; the reduced ' +
    "commission is READ from the store's Commission Tariff at compute time. Rows with neither offer " +
    'are skipped. Returns counts: distinct products, items, matched/unmatched products, skipped rows. ' +
    'Rejects a file whose header layout does not match the expected Flash export (422 VALIDATION_ERROR).',
  security: [{ bearerAuth: [] }],
  request: {
    params: FlashProductStorePathSchema,
    body: {
      content: { 'multipart/form-data': { schema: ImportFlashProductsFormSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: ImportFlashProductsResponseSchema } },
      description: 'Flash product list imported',
      headers: RateLimitHeaders,
    },
    401: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Missing or invalid auth token',
    },
    403: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Insufficient role to modify store data',
    },
    404: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Store not found or belongs to a different organization',
    },
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'File missing, unreadable, or not the expected flash format',
    },
    429: Common429Response,
  },
});

app.openapi(importFlashProductsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_WRITE);

  const { file, name } = c.req.valid('form');
  const buffer = Buffer.from(await file.arrayBuffer());

  const result = await importFlashProducts({
    organizationId: orgId,
    storeId,
    file: buffer,
    filename: file.name,
    createdBy: userId,
    name,
  });

  return c.json(result, 201);
});

export default app;
