import { z } from '@hono/zod-openapi';

/**
 * Validated body for POST /organizations/:orgId/cost-profile-attachments/attach
 * and POST /organizations/:orgId/cost-profile-attachments/detach.
 *
 * Both attach and detach require at least one profileId and at least one
 * variantId. The Cartesian product is applied (every profile linked to every
 * variant). Idempotent on attach (skipDuplicates); detach is a deleteMany.
 */
export const attachmentBodySchema = z
  .object({
    profileIds: z
      .array(z.string().uuid())
      .min(1)
      .max(100)
      .openapi({
        description: 'UUIDs of cost profiles to attach or detach. At least 1, max 100.',
        example: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
      }),
    variantIds: z
      .array(z.string().uuid())
      .min(1)
      .max(500)
      .openapi({
        description: 'UUIDs of product variants to attach or detach from. At least 1, max 500.',
        example: ['b4e2c1a0-9d3f-47e5-8a1b-6c5d4e3f2a1b'],
      }),
  })
  .openapi('AttachmentBody');

export type AttachmentBody = z.infer<typeof attachmentBodySchema>;

/**
 * Validated body for POST /organizations/:orgId/cost-profile-attachments/replace.
 *
 * Replace atomically sets each listed variant's cost profiles to exactly
 * `profileIds`. An empty `profileIds` array is valid and means "clear all
 * profiles for the listed variants".
 */
export const replaceBodySchema = z
  .object({
    variantIds: z
      .array(z.string().uuid())
      .min(1)
      .max(500)
      .openapi({
        description: 'UUIDs of product variants whose profile set will be replaced.',
        example: ['b4e2c1a0-9d3f-47e5-8a1b-6c5d4e3f2a1b'],
      }),
    profileIds: z
      .array(z.string().uuid())
      .max(100)
      .openapi({
        description:
          'UUIDs of cost profiles to assign. Empty array clears all profiles for the listed variants.',
        example: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
      }),
  })
  .openapi('ReplaceBody');

export type ReplaceBody = z.infer<typeof replaceBodySchema>;
