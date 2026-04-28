import { z } from '@hono/zod-openapi';
import { MemberRole } from '@pazarsync/db';

import { slugify } from '../lib/slugify';

export const OrganizationSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '00000000-0000-0000-0000-000000000000' }),
    name: z.string().openapi({ example: 'Akyıldız Store' }),
    slug: z.string().openapi({ example: 'akyildiz-store' }),
    currency: z.string().openapi({ example: 'TRY' }),
    timezone: z.string().openapi({ example: 'Europe/Istanbul' }),
    createdAt: z.string().datetime().openapi({ example: '2026-01-15T10:30:00Z' }),
    updatedAt: z.string().datetime().openapi({ example: '2026-04-01T14:00:00Z' }),
    role: z
      .enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'])
      .openapi({ example: 'OWNER', description: "The caller's role inside this organization." }),
    storeCount: z
      .number()
      .int()
      .nonnegative()
      .openapi({
        example: 2,
        description:
          'Total stores attached to this organization. Counts every status — ACTIVE, ' +
          'CONNECTION_ERROR, and DISABLED — so the switcher reflects the operator-visible total.',
      }),
    lastSyncedAt: z
      .string()
      .datetime()
      .nullable()
      .openapi({
        example: '2026-04-26T15:42:00Z',
        description:
          'Most recent successful sync across every store in this organization (MAX of ' +
          '`stores.last_sync_at`). `null` when the organization has no stores or none have ' +
          'completed a sync yet.',
      }),
    lastAccessedAt: z
      .string()
      .datetime()
      .nullable()
      .openapi({
        example: '2026-04-26T18:00:00Z',
        description:
          'Last time the caller switched into this organization (their organization_members.' +
          'last_accessed_at). Powers the recently-used section of the switcher.',
      }),
  })
  .openapi('Organization', {
    description:
      'An organization (tenant). Users can be members of multiple organizations. ' +
      'The `currency` + `timezone` fields are business-ops defaults (reporting ' +
      'boundaries, settlement cuts); viewer-side display timezone lives on ' +
      '`user_profiles` via GET /v1/me. The `role` / `storeCount` / `lastSyncedAt` / ' +
      '`lastAccessedAt` fields are all caller-scoped: every member of the same ' +
      'organization receives the same `storeCount` and `lastSyncedAt` but their ' +
      'own `role` and `lastAccessedAt`.',
  });

export const OrganizationListResponseSchema = z
  .object({
    data: z.array(OrganizationSchema),
  })
  .openapi('OrganizationListResponse');

/**
 * ──────────────────────────────────────────────────────────────────────
 * [USER TOUCHPOINT #2 — Create organization input shape]
 *
 * Trade-offs worth reconsidering:
 *  - Length bounds: min=2 (some valid legal names are short — "3K", "E&Y")
 *    but min=1 invites garbage. max=80 covers "Akyıldız Ticaret Anonim
 *    Şirketi"; Turkish legal names can exceed 80 in rare cases.
 *  - Alphanumeric regex: rejects pure "!!!" / emoji-only names at
 *    validation time so we don't fall back to random-hex slugs silently.
 *    Keeps the error user-visible ("must contain at least one letter/
 *    digit") rather than mysterious auto-generated slug.
 *  - Reserved slugs: list is conservative — only names that would
 *    collide with an actual URL segment or admin surface. Extend if you
 *    decide to reserve brand names ("pazarsync", "trendyol"). The
 *    check uses `slugify()` so "Admin" / "ADMIN" / "a-d-m-i-n" all
 *    normalise to the same forbidden form.
 * ──────────────────────────────────────────────────────────────────────
 */
const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'www',
  'app',
  'help',
  'support',
  'docs',
  'settings',
  'billing',
  'onboarding',
  'dashboard',
  'organizations',
  'stores',
]);

export const CreateOrganizationInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'INVALID_NAME_TOO_SHORT')
      .max(80, 'INVALID_NAME_TOO_LONG')
      .regex(/[\p{L}\p{N}]/u, 'INVALID_NAME_NO_ALPHANUMERIC')
      .refine((val) => !RESERVED_SLUGS.has(slugify(val)), 'INVALID_NAME_RESERVED')
      .openapi({ example: 'Akyıldız Ticaret' }),
  })
  .openapi('CreateOrganizationInput');

export const OrganizationCreatedResponseSchema = OrganizationSchema.extend({
  membership: z
    .object({
      role: z.enum(MemberRole).openapi({ example: 'OWNER' }),
    })
    .openapi('MembershipSummary'),
}).openapi('OrganizationCreatedResponse', {
  description:
    'An organization just created via POST /v1/organizations. The response includes ' +
    'the membership row — first creator is always OWNER.',
});

export type Organization = z.infer<typeof OrganizationSchema>;
export type OrganizationListResponse = z.infer<typeof OrganizationListResponseSchema>;
export type CreateOrganizationInput = z.infer<typeof CreateOrganizationInputSchema>;
export type OrganizationCreatedResponse = z.infer<typeof OrganizationCreatedResponseSchema>;
