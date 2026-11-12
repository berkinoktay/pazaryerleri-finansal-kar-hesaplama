import { createRoute } from '@hono/zod-openapi';

import { createSubApp } from '../../lib/create-hono-app';
import {
  requireStoreAccessContext,
  type StoreAccessVariables,
  WORKBOOK_IMPORT_MIDDLEWARE,
} from '../../middleware/workbook-upload.middleware';
import {
  Common429Response,
  ProblemDetailsSchema,
  RateLimitHeaders,
  WORKBOOK_IMPORT_ERROR_RESPONSES,
} from '../../openapi';
import { importDiscountList } from '../../services/discount-list-import.service';
import {
  DiscountListStorePathSchema,
  ImportDiscountListFormSchema,
  ImportDiscountListResponseSchema,
} from '../../validators/discount-list.validator';

const app = createSubApp<{ Variables: StoreAccessVariables }>();

const importDiscountListRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/stores/{storeId}/discount-lists/import',
  tags: ['DiscountLists'],
  summary: 'Import a Trendyol İndirimler Excel',
  description:
    "Uploads Trendyol's İndirimler product-selection .xlsx (multipart `file`) together with the " +
    'discount configuration fields. Every column is resolved by header name. Trendyol uses the SAME ' +
    'selection sheet for every discount type, so the discount kurgu (NET / min basket / N adet / ' +
    'X al Y öde / X. ürün / indirim kodu) and its parameters ride in on the form and are persisted ' +
    'onto the list row. Each product row is joined to a ProductVariant by barcode and stored as one ' +
    'item; a row already marked "Evet" starts as included. Rows with no barcode or no current price ' +
    'are skipped. Returns counts: items, matched/unmatched products, skipped rows. Rejects a file ' +
    'whose header layout does not match the expected İndirimler export (422 VALIDATION_ERROR).',
  security: [{ bearerAuth: [] }],
  middleware: WORKBOOK_IMPORT_MIDDLEWARE,
  request: {
    params: DiscountListStorePathSchema,
    body: {
      content: { 'multipart/form-data': { schema: ImportDiscountListFormSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: ImportDiscountListResponseSchema } },
      description: 'Discount list imported',
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
      description: 'File missing/unreadable, config invalid, or not the expected discount format',
    },
    ...WORKBOOK_IMPORT_ERROR_RESPONSES,
    429: Common429Response,
  },
});

app.openapi(importDiscountListRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  requireStoreAccessContext(c, orgId, storeId);

  const { file, name, ...config } = c.req.valid('form');
  const buffer = Buffer.from(await file.arrayBuffer());

  const result = await importDiscountList({
    organizationId: orgId,
    storeId,
    file: buffer,
    filename: file.name,
    createdBy: userId,
    name,
    config,
  });

  return c.json(result, 201);
});

export default app;
