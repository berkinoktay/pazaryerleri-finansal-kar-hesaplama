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
import { importMarketplaceCampaign } from '../../services/marketplace-campaign-import.service';
import {
  ImportMarketplaceCampaignFormSchema,
  ImportMarketplaceCampaignResponseSchema,
  MarketplaceCampaignStorePathSchema,
} from '../../validators/marketplace-campaign.validator';

const app = createSubApp<{ Variables: StoreAccessVariables }>();

const importMarketplaceCampaignRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/import',
  tags: ['MarketplaceCampaigns'],
  summary: 'Import a Trendyol Kampanyalar participation Excel',
  description:
    "Uploads Trendyol's campaign product-selection .xlsx (multipart `file`) together with the " +
    'campaign configuration. Every column is resolved by header name and the FIRST sheet is read ' +
    '(its name changes per campaign). The campaign kurgu (NET / min basket / N adet / X al Y öde / ' +
    "X. ürün), its parameters, Trendyol's funding rate and the campaign window are not in the file " +
    '— they ride in on the form and are persisted onto the campaign row. Each product row is joined ' +
    'to a ProductVariant by barcode and stored as one item with its current price and the maximum ' +
    'price Trendyol allows; the seller has made no price choice yet, so every item starts at NONE. ' +
    'Rows with no barcode, no current price or no maximum price are skipped. Returns counts: items, ' +
    'matched/unmatched products, skipped rows. Rejects a file whose header layout does not match ' +
    'the expected Kampanyalar export (422 VALIDATION_ERROR).',
  security: [{ bearerAuth: [] }],
  middleware: WORKBOOK_IMPORT_MIDDLEWARE,
  request: {
    params: MarketplaceCampaignStorePathSchema,
    body: {
      content: { 'multipart/form-data': { schema: ImportMarketplaceCampaignFormSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: ImportMarketplaceCampaignResponseSchema } },
      description: 'Campaign imported',
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
      description: 'File missing/unreadable, config invalid, or not the expected campaign format',
    },
    ...WORKBOOK_IMPORT_ERROR_RESPONSES,
    429: Common429Response,
  },
});

app.openapi(importMarketplaceCampaignRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  requireStoreAccessContext(c, orgId, storeId);

  const { file, name, ...config } = c.req.valid('form');
  const buffer = Buffer.from(await file.arrayBuffer());

  const result = await importMarketplaceCampaign({
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
