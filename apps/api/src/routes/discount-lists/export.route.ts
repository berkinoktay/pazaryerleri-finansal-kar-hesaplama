import { createRoute, z } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema } from '../../openapi';
import { exportDiscountList } from '../../services/discount-list-export.service';
import { XLSX_MIME } from '../../services/tariff-export-commons';
import { DiscountListPathSchema } from '../../validators/discount-list.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const exportDiscountListRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}/export',
  tags: ['DiscountLists'],
  summary: 'Export the discount list as a re-uploadable Trendyol Excel',
  description:
    "Returns Trendyol's ORIGINAL uploaded file with each row's participation written back into the " +
    '"Kampayaya Dahil Edilsin Mi?" column: an included row gets "Evet", an excluded row gets "Hayır". ' +
    'Only cells that DEVIATE from the source are patched — every other cell is byte-for-byte unchanged, ' +
    'so the file can be re-uploaded to Trendyol verbatim, and a list with no changes vs. the original ' +
    'streams back byte-for-byte identical. Marks the list exported. Returns 409 if the list has no ' +
    'stored source file (or it is unreadable / not a recognizable İndirimler export).',
  security: [{ bearerAuth: [] }],
  request: { params: DiscountListPathSchema },
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
      description: 'List or store not found in this organization',
    },
    409: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'List has no stored source file to export',
    },
    429: Common429Response,
  },
});

app.openapi(exportDiscountListRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, listId } = c.req.valid('param');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_WRITE);

  const { file, filename } = await exportDiscountList(orgId, storeId, listId);

  c.header('Content-Type', XLSX_MIME);
  c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  return c.body(new Uint8Array(file), 200);
});

export default app;
