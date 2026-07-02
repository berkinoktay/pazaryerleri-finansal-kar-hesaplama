import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { importPlusTariff } from '../../services/plus-commission-tariff-import.service';
import {
  ImportPlusTariffFormSchema,
  ImportPlusTariffResponseSchema,
  PlusTariffStorePathSchema,
} from '../../validators/plus-commission-tariff.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const importPlusTariffRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/import',
  tags: ['PlusCommissionTariffs'],
  summary: 'Import a Trendyol Plus commission-tariff Excel',
  description:
    "Uploads Trendyol's Plus commission .xlsx (multipart `file`). Every column is resolved by " +
    'header name; the single 7-day period is folded onto the tariff, and each product row (one Plus ' +
    'offer: price ceiling + reduced commission) is joined to a ProductVariant by barcode. Stores one ' +
    'tariff with its product rows; profit is computed later on read. Returns counts: products, ' +
    'items, matched/unmatched products, skipped rows. Rejects a file whose header layout does not ' +
    'match the expected Plus export (422 VALIDATION_ERROR).',
  security: [{ bearerAuth: [] }],
  request: {
    params: PlusTariffStorePathSchema,
    body: {
      content: { 'multipart/form-data': { schema: ImportPlusTariffFormSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: ImportPlusTariffResponseSchema } },
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

app.openapi(importPlusTariffRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_WRITE);

  const { file, name } = c.req.valid('form');
  const buffer = Buffer.from(await file.arrayBuffer());

  const result = await importPlusTariff({
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
