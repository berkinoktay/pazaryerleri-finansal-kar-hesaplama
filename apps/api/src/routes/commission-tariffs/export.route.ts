import { createRoute, z } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema } from '../../openapi';
import { exportTariff } from '../../services/commission-tariff-export.service';
import { TariffIdPathSchema } from '../../validators/commission-tariff.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const exportTariffRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}/export',
  tags: ['CommissionTariffs'],
  summary: 'Export the tariff as a re-uploadable Trendyol Excel',
  description:
    "Returns Trendyol's ORIGINAL uploaded file with the seller's choices patched in: the chosen " +
    'band price into "YENİ TSF (FİYAT GÜNCELLE)" and "{N} Günlük Fiyat" into "Tarife Seçimi" for ' +
    'every product that has a selection. Every other cell is byte-for-byte unchanged, so the file ' +
    'can be re-uploaded to Trendyol verbatim. Marks the tariff exported. Returns 409 if the tariff ' +
    'has no stored source file.',
  security: [{ bearerAuth: [] }],
  request: { params: TariffIdPathSchema },
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
      description: 'Tariff or store not found in this organization',
    },
    409: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Tariff has no stored source file to export',
    },
    429: Common429Response,
  },
});

app.openapi(exportTariffRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, tariffId } = c.req.valid('param');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_WRITE);

  const { file, filename } = await exportTariff(orgId, storeId, tariffId);

  c.header('Content-Type', XLSX_MIME);
  c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  return c.body(new Uint8Array(file), 200);
});

export default app;
