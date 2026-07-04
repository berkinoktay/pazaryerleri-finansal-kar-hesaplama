import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { updateAdvantageCommissionSource } from '../../services/advantage-tariff.service';
import {
  AdvantageTariffIdPathSchema,
  UpdateAdvantageCommissionSourceBodySchema,
  UpdateAdvantageCommissionSourceResponseSchema,
} from '../../validators/advantage-tariff.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const updateAdvantageCommissionSourceRoute = createRoute({
  method: 'patch',
  path: '/organizations/{orgId}/stores/{storeId}/advantage-tariffs/{tariffId}/commission-source',
  tags: ['AdvantageTariffs'],
  summary: 'Pin (or clear → auto) the commission tariff that supplies the reduced rates',
  description:
    "Pins which Commission Tariff supplies each tier's reduced commission for this Advantage tariff, " +
    'or clears the pin (null) to fall back to automatic resolution (the active period). The pinned ' +
    'tariff must belong to this store. Every tier profit in the detail view is then recomputed from ' +
    "the pinned source's bands. Returns the resolved commissionSourceTariffId.",
  security: [{ bearerAuth: [] }],
  request: {
    params: AdvantageTariffIdPathSchema,
    body: {
      content: { 'application/json': { schema: UpdateAdvantageCommissionSourceBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: UpdateAdvantageCommissionSourceResponseSchema } },
      description: 'Commission source updated',
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
      description: 'Tariff, commission source, or store not found in this organization',
    },
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Invalid commission source payload',
    },
    429: Common429Response,
  },
});

app.openapi(updateAdvantageCommissionSourceRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, tariffId } = c.req.valid('param');
  const { commissionSourceTariffId } = c.req.valid('json');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_WRITE);

  const result = await updateAdvantageCommissionSource(
    orgId,
    storeId,
    tariffId,
    commissionSourceTariffId,
  );
  return c.json(result, 200);
});

export default app;
