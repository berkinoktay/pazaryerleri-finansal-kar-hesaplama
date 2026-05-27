import { z } from '@hono/zod-openapi';
import { MemberRole } from '@pazarsync/db';

const MemberRoleSchema = z.enum(MemberRole).openapi({ example: 'MEMBER' });

const accessibleStoreIdsSchema = z
  .array(z.string().uuid())
  .nullable()
  .openapi({
    description:
      'Store ids this member may see. `null` = every store in the org (OWNER/ADMIN see all by ' +
      'role); an array = the explicitly granted stores (MEMBER/VIEWER). The management UI hides ' +
      'the per-store grant editor when this is `null`.',
  });

export const MemberSchema = z
  .object({
    id: z
      .string()
      .uuid()
      .openapi({ example: '00000000-0000-0000-0000-000000000000', description: 'Membership id.' }),
    userId: z.string().uuid().openapi({ example: '00000000-0000-0000-0000-000000000001' }),
    email: z.string().email().openapi({ example: 'demo@pazarsync.local' }),
    fullName: z.string().nullable().openapi({ example: 'Demo User' }),
    role: MemberRoleSchema,
    accessibleStoreIds: accessibleStoreIdsSchema,
  })
  .openapi('Member', {
    description:
      'A member of an organization, with the caller-visible store-access summary. Returned by ' +
      'the roster list and by the role/store-access mutations.',
  });

export const MemberListResponseSchema = z
  .object({ data: z.array(MemberSchema) })
  .openapi('MemberListResponse');

export const UpdateMemberRoleInputSchema = z
  .object({
    role: z.enum(MemberRole).openapi({ example: 'ADMIN' }),
  })
  .openapi('UpdateMemberRoleInput');

export const SetMemberStoreAccessInputSchema = z
  .object({
    storeIds: z.array(z.string().uuid()).openapi({
      example: ['00000000-0000-0000-0000-000000000000'],
      description:
        'Replace the member’s granted store set with exactly these ids (full replace, not a ' +
        'delta). Every id must belong to the organization. No-op in effect for OWNER/ADMIN, ' +
        'who see every store by role.',
    }),
  })
  .openapi('SetMemberStoreAccessInput');

export const MembershipContextSchema = z
  .object({
    role: MemberRoleSchema,
    capabilities: z.array(z.string()).openapi({
      example: ['data:read', 'data:write', 'sync:trigger'],
      description: "The capabilities the caller's role grants (derived from ROLE_CAPABILITIES).",
    }),
    accessibleStoreIds: accessibleStoreIdsSchema,
  })
  .openapi('MembershipContext', {
    description:
      "The caller's membership context for an organization: role, the capabilities it grants, " +
      'and the stores they may see. Drives frontend UI gating and the store switcher.',
  });

export type Member = z.infer<typeof MemberSchema>;
export type MembershipContext = z.infer<typeof MembershipContextSchema>;
export type UpdateMemberRoleInput = z.infer<typeof UpdateMemberRoleInputSchema>;
export type SetMemberStoreAccessInput = z.infer<typeof SetMemberStoreAccessInputSchema>;
