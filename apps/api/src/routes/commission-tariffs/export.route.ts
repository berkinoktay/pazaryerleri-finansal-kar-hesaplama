import { createRoute, z } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema } from '../../openapi';
import {
  bundleForDownload,
  exportTariff,
  XLSX_MIME,
  ZIP_MIME,
} from '../../services/commission-tariff-export.service';
import { TariffIdPathSchema } from '../../validators/commission-tariff.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const exportTariffRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}/export',
  tags: ['CommissionTariffs'],
  summary: 'Export the tariff as a re-uploadable Trendyol Excel',
  description:
    "Returns Trendyol's ORIGINAL uploaded file with the seller's choices patched in: the chosen " +
    'band price into "YENİ TSF (FİYAT GÜNCELLE)" and "{N} Günlük Fiyat" into "Tarife Seçimi" for ' +
    'every product that has a selection. Every other cell is byte-for-byte unchanged, so the file ' +
    'can be re-uploaded to Trendyol verbatim. A split week yields up to three window files (a ' +
    'whole-week "7 Günlük Fiyat" file for products priced the same in both sub-periods, plus ' +
    '"3 Günlük Fiyat" / "4 Günlük Fiyat" files for period-specific prices), only the non-empty ' +
    'ones, bundled into a single .zip. Marks the tariff exported. Returns 409 if the tariff has ' +
    'no stored source file.',
  security: [{ bearerAuth: [] }],
  request: { params: TariffIdPathSchema },
  responses: {
    200: {
      content: {
        [XLSX_MIME]: { schema: z.string().openapi({ type: 'string', format: 'binary' }) },
        [ZIP_MIME]: { schema: z.string().openapi({ type: 'string', format: 'binary' }) },
      },
      description:
        'The patched .xlsx (single file), or a .zip of both window files when a product is priced ' +
        'differently across sub-periods, ready to re-upload to Trendyol',
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

  const { files } = await exportTariff(orgId, storeId, tariffId);
  const { body, filename, contentType } = bundleForDownload(files);

  c.header('Content-Type', contentType);
  c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  return c.body(new Uint8Array(body), 200);
});

export default app;
