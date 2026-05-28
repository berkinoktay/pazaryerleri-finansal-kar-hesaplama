import { createRoute, z } from '@hono/zod-openapi';
import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../lib/create-hono-app';
import { requireCapability } from '../lib/require-capability';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../openapi';
import * as memberService from '../services/member.service';
import {
  MemberListResponseSchema,
  MemberSchema,
  MembershipContextSchema,
  SetMemberStoreAccessInputSchema,
  UpdateMemberRoleInputSchema,
} from '../validators/member.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const orgIdParam = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
});

const memberIdParams = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
  memberId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'memberId', in: 'path' } }),
});

// ─── GET /organizations/:orgId/me — caller's membership context ────────

const getMembershipContextRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/me',
  tags: ['Members'],
  summary: "Get the caller's membership context for an organization",
  description:
    'Returns the role, the capabilities it grants, and the store ids the caller may see ' +
    '(`null` for OWNER/ADMIN = all). The single source the frontend CurrentScopeProvider uses ' +
    'to gate UI and populate the store switcher. Distinct from GET /v1/me (user profile).',
  security: [{ bearerAuth: [] }],
  request: { params: orgIdParam },
  responses: {
    200: {
      content: { 'application/json': { schema: MembershipContextSchema } },
      description: 'Membership context',
      headers: RateLimitHeaders,
    },
    401: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Missing or invalid auth token',
    },
    403: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Not a member of this organization',
    },
    429: Common429Response,
  },
});

app.openapi(getMembershipContextRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId } = c.req.valid('param');
  // DATA_READ is held by every role, so this is the membership gate that also
  // yields the role to derive capabilities + accessible stores from.
  const role = await requireCapability(userId, orgId, CAPABILITIES.DATA_READ);
  const context = await memberService.getMembershipContext(userId, orgId, role);
  return c.json(context, 200);
});

// ─── GET /organizations/:orgId/members — roster ───────────────────────

const listMembersRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/members',
  tags: ['Members'],
  summary: 'List the organization roster',
  description:
    'Returns every member with their role and store-access summary. Gated on `members:read` ' +
    '(OWNER/ADMIN) — the roster is management information, not visible to MEMBER/VIEWER.',
  security: [{ bearerAuth: [] }],
  request: { params: orgIdParam },
  responses: {
    200: {
      content: { 'application/json': { schema: MemberListResponseSchema } },
      description: 'The organization roster',
      headers: RateLimitHeaders,
    },
    401: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Missing or invalid auth token',
    },
    403: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Caller cannot read the roster (not a member, or lacks members:read)',
    },
    429: Common429Response,
  },
});

app.openapi(listMembersRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId } = c.req.valid('param');
  await requireCapability(userId, orgId, CAPABILITIES.MEMBERS_READ);
  const data = await memberService.listMembers(orgId);
  return c.json({ data }, 200);
});

// ─── PATCH /organizations/:orgId/members/:memberId — change role ───────

const updateMemberRoleRoute = createRoute({
  method: 'patch',
  path: '/organizations/{orgId}/members/{memberId}',
  tags: ['Members'],
  summary: "Change a member's role",
  description:
    'Gated on `members:manage_roles` (OWNER only — ADMIN cannot mint OWNERs, closing the ' +
    'privilege-escalation path). The org must always keep at least one OWNER: demoting the ' +
    'last one returns 422 with field code CANNOT_DEMOTE_LAST_OWNER.',
  security: [{ bearerAuth: [] }],
  request: {
    params: memberIdParams,
    body: {
      content: { 'application/json': { schema: UpdateMemberRoleInputSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: MemberSchema } },
      description: 'The updated member',
      headers: RateLimitHeaders,
    },
    401: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Missing or invalid auth token',
    },
    403: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Caller cannot manage roles (not a member, or lacks members:manage_roles)',
    },
    404: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Member not found in this organization',
    },
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Invalid role, or demoting the last owner (CANNOT_DEMOTE_LAST_OWNER)',
    },
    429: Common429Response,
  },
});

app.openapi(updateMemberRoleRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, memberId } = c.req.valid('param');
  const { role } = c.req.valid('json');
  await requireCapability(userId, orgId, CAPABILITIES.MEMBERS_MANAGE_ROLES);
  const updated = await memberService.updateMemberRole(orgId, memberId, role);
  return c.json(updated, 200);
});

// ─── PUT /organizations/:orgId/members/:memberId/store-access ──────────

const setStoreAccessRoute = createRoute({
  method: 'put',
  path: '/organizations/{orgId}/members/{memberId}/store-access',
  tags: ['Members'],
  summary: "Replace a member's store-access grants",
  description:
    'Gated on `members:manage_access` (OWNER/ADMIN). Replaces the member’s granted store set ' +
    'with exactly the supplied ids (full replace). Every id must belong to the organization ' +
    '(else 422 INVALID_REFERENCE). No visibility effect for OWNER/ADMIN targets.',
  security: [{ bearerAuth: [] }],
  request: {
    params: memberIdParams,
    body: {
      content: { 'application/json': { schema: SetMemberStoreAccessInputSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: MemberSchema } },
      description: 'The updated member with the new store-access summary',
      headers: RateLimitHeaders,
    },
    401: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Missing or invalid auth token',
    },
    403: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description:
        'Caller cannot manage store access (not a member, or lacks members:manage_access)',
    },
    404: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Member not found in this organization',
    },
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'One or more stores do not belong to this organization (INVALID_REFERENCE)',
    },
    429: Common429Response,
  },
});

app.openapi(setStoreAccessRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, memberId } = c.req.valid('param');
  const { storeIds } = c.req.valid('json');
  await requireCapability(userId, orgId, CAPABILITIES.MEMBERS_MANAGE_ACCESS);
  const updated = await memberService.setMemberStoreAccess(orgId, memberId, storeIds);
  return c.json(updated, 200);
});

export default app;
