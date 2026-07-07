import { createRoute, z } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema } from '../../openapi';
import { exportFlashProducts } from '../../services/flash-product-export.service';
import { XLSX_MIME } from '../../services/tariff-export-commons';
import { FlashProductListPathSchema } from '../../validators/flash-product.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const exportFlashProductsRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/stores/{storeId}/flash-products/{listId}/export',
  tags: ['FlashProducts'],
  summary: 'Export the Flash Products list as a re-uploadable Trendyol Excel',
  description:
    "Returns Trendyol's ORIGINAL uploaded file with each selected row's participation written back: " +
    'the "Güncellenecek Fiyat" column gets "24 Saat" / "3 Saat" / "Senin Belirlediğin Flaş Fiyatı", ' +
    'and a custom row additionally gets its numeric price in the "Senin Belirlediğin Flaş Fiyatı" ' +
    'column (an offer row leaves it untouched — Trendyol reads the 24 Saat / 3 Saat price). Every ' +
    'other cell is byte-for-byte unchanged, so the file can be re-uploaded to Trendyol verbatim; a ' +
    'list with no selections streams back verbatim. Single file (no periods). Marks the list ' +
    'exported. Returns 409 if the list has no stored source file (or it is unreadable / lacks the ' +
    'writable column).',
  security: [{ bearerAuth: [] }],
  request: { params: FlashProductListPathSchema },
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

app.openapi(exportFlashProductsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, listId } = c.req.valid('param');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_WRITE);

  const { file, filename } = await exportFlashProducts(orgId, storeId, listId);

  c.header('Content-Type', XLSX_MIME);
  c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  return c.body(new Uint8Array(file), 200);
});

export default app;
