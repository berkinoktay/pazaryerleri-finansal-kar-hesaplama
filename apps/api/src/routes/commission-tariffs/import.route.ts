import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { importTariff } from '../../services/commission-tariff-import.service';
import {
  ImportTariffFormSchema,
  ImportTariffResponseSchema,
  TariffStorePathSchema,
} from '../../validators/commission-tariff.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const importTariffRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/stores/{storeId}/commission-tariffs/import',
  tags: ['CommissionTariffs'],
  summary: 'Import a Trendyol commission-tariff Excel',
  description:
    "Uploads Trendyol's 'Ürün Komisyon Tarifeleri' .xlsx (multipart `file`). The fixed-layout " +
    'sheet is read by position (its commission columns share duplicate headers), each present ' +
    'period (3-day / 4-day) becomes a period, and each product row is joined to a ProductVariant ' +
    'by barcode. Stores one tariff with its periods + product rows; profit is computed later on ' +
    'read. Returns counts: products, periods, items, matched/unmatched products, skipped rows. ' +
    'Rejects a file whose header layout does not match the expected export (422 VALIDATION_ERROR).',
  security: [{ bearerAuth: [] }],
  request: {
    params: TariffStorePathSchema,
    body: {
      content: { 'multipart/form-data': { schema: ImportTariffFormSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: ImportTariffResponseSchema } },
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

app.openapi(importTariffRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_WRITE);

  const { file, name } = c.req.valid('form');
  const buffer = Buffer.from(await file.arrayBuffer());

  const result = await importTariff({
    organizationId: orgId,
    storeId,
    file: buffer,
    filename: file.name,
    createdBy: userId,
    name,
    now: new Date(),
  });

  return c.json(result, 201);
});

export default app;
