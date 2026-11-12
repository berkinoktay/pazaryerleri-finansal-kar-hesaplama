import { createRoute, z } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { RATE_LIMITS } from '../../config/rate-limits';
import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { rateLimit } from '../../middleware/rate-limit.middleware';
import {
  Common429Response,
  ProblemDetailsSchema,
  WORKBOOK_EXPORT_ERROR_RESPONSES,
} from '../../openapi';
import { exportMarketplaceCampaign } from '../../services/marketplace-campaign-export.service';
import { XLSX_MIME } from '../../services/tariff-export-commons';
import { MarketplaceCampaignPathSchema } from '../../validators/marketplace-campaign.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const exportMarketplaceCampaignRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}/export',
  tags: ['MarketplaceCampaigns'],
  summary: 'Export the campaign selections as a re-uploadable Trendyol Excel',
  description:
    "Returns Trendyol's ORIGINAL uploaded file with each row's chosen price written into the " +
    '"Kampanyalı Satış Fiyatı" column: MAX writes the maximum allowed price, CUSTOM writes the ' +
    "seller's own price, NONE leaves the cell untouched (it was already empty in the source). " +
    'Only cells with a resolved price are patched — every other cell is byte-for-byte unchanged, ' +
    'so the file can be re-uploaded to Trendyol verbatim. Marks the campaign exported. Returns ' +
    '409 if the campaign has no stored source file (or it is unreadable / not a recognizable ' +
    'Kampanyalar export).',
  security: [{ bearerAuth: [] }],
  middleware: [rateLimit(RATE_LIMITS.FILE_EXPORT)] as const,
  request: { params: MarketplaceCampaignPathSchema },
  responses: {
    200: {
      content: {
        [XLSX_MIME]: { schema: z.string().openapi({ type: 'string', format: 'binary' }) },
      },
      description: 'The patched .xlsx, ready to re-upload to Trendyol',
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
      description: 'Campaign or store not found in this organization',
    },
    409: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Campaign has no stored source file to export',
    },
    ...WORKBOOK_EXPORT_ERROR_RESPONSES,
    429: Common429Response,
  },
});

app.openapi(exportMarketplaceCampaignRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, campaignId } = c.req.valid('param');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_WRITE);

  const { file, filename } = await exportMarketplaceCampaign(orgId, storeId, campaignId);

  c.header('Content-Type', XLSX_MIME);
  c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  return c.body(new Uint8Array(file), 200);
});

export default app;
