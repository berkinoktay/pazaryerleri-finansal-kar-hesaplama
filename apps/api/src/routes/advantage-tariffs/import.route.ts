import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { importAdvantageTariff } from '../../services/advantage-tariff-import.service';
import {
  AdvantageTariffStorePathSchema,
  ImportAdvantageTariffFormSchema,
  ImportAdvantageTariffResponseSchema,
} from '../../validators/advantage-tariff.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const importAdvantageTariffRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/stores/{storeId}/advantage-tariffs/import',
  tags: ['AdvantageTariffs'],
  summary: 'Import a Trendyol Advantage product-label Excel',
  description:
    "Uploads Trendyol's Avantajlı Ürün Etiketleri .xlsx (multipart `file`). Every column is resolved " +
    'by header name; unlike the commission/Plus exports this file carries NO commission and NO dates. ' +
    "Each product row exposes three star tiers whose reduced commission is READ from the store's " +
    'Commission Tariff at compute time, and is joined to a ProductVariant by barcode. Stores one ' +
    'tariff with its product rows; profit is computed later on read. Returns counts: products, items, ' +
    'matched/unmatched products, skipped rows. Rejects a file whose header layout does not match the ' +
    'expected Advantage export (422 VALIDATION_ERROR).',
  security: [{ bearerAuth: [] }],
  request: {
    params: AdvantageTariffStorePathSchema,
    body: {
      content: { 'multipart/form-data': { schema: ImportAdvantageTariffFormSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: ImportAdvantageTariffResponseSchema } },
      description: 'Tariff imported',
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
      description: 'File missing, unreadable, or not the expected tariff format',
    },
    429: Common429Response,
  },
});

app.openapi(importAdvantageTariffRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_WRITE);

  const { file, name, commissionSourceTariffId } = c.req.valid('form');
  const buffer = Buffer.from(await file.arrayBuffer());

  const result = await importAdvantageTariff({
    organizationId: orgId,
    storeId,
    file: buffer,
    filename: file.name,
    createdBy: userId,
    name,
    commissionSourceTariffId,
  });

  return c.json(result, 201);
});

export default app;
