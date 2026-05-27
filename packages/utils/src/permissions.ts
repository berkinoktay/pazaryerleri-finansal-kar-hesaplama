import type { MemberRole } from '@pazarsync/db/enums';

/**
 * Fine-grained actions a member can perform within an organization.
 *
 * Capabilities are DERIVED from a member's role via ROLE_CAPABILITIES — they
 * are never stored per user. Adding a new permission is a one-line change here
 * plus the relevant role rows below; no database migration is required.
 *
 * Store *visibility* is a separate, orthogonal axis (see the MemberStoreAccess
 * table and the can_access_store RLS helper): capabilities answer "what may a
 * member do", store access answers "which stores' data may a member see".
 */
export const CAPABILITIES = {
  DATA_READ: 'data:read',
  DATA_WRITE: 'data:write',
  SYNC_TRIGGER: 'sync:trigger',
  STORES_CONNECT: 'stores:connect',
  STORES_DISCONNECT: 'stores:disconnect',
  STORES_CONFIGURE: 'stores:configure',
  MEMBERS_READ: 'members:read',
  MEMBERS_MANAGE_ACCESS: 'members:manage_access',
  MEMBERS_MANAGE_ROLES: 'members:manage_roles',
  ORG_MANAGE_SETTINGS: 'org:manage_settings',
  ORG_DELETE: 'org:delete',
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

const C = CAPABILITIES;

// Capabilities are cumulative up the role hierarchy: each role grants everything
// the role below it does, plus its own additions. Building the sets by extension
// (instead of re-listing shared capabilities) keeps each capability named once
// and makes the monotonic invariant OWNER ⊇ ADMIN ⊇ MEMBER ⊇ VIEWER structural
// rather than something a test has to re-verify.
//   - VIEWER — read-only
//   - MEMBER — + write data, trigger syncs
//   - ADMIN  — + manage stores, member store-access, org settings
//   - OWNER  — + manage roles, delete org (privilege-escalation guard: OWNER only)
const VIEWER_CAPABILITIES: Capability[] = [C.DATA_READ];
const MEMBER_CAPABILITIES: Capability[] = [...VIEWER_CAPABILITIES, C.DATA_WRITE, C.SYNC_TRIGGER];
const ADMIN_CAPABILITIES: Capability[] = [
  ...MEMBER_CAPABILITIES,
  C.STORES_CONNECT,
  C.STORES_DISCONNECT,
  C.STORES_CONFIGURE,
  C.MEMBERS_READ,
  C.MEMBERS_MANAGE_ACCESS,
  C.ORG_MANAGE_SETTINGS,
];
const OWNER_CAPABILITIES: Capability[] = [
  ...ADMIN_CAPABILITIES,
  C.MEMBERS_MANAGE_ROLES,
  C.ORG_DELETE,
];

/**
 * Role → capability map. The `Record<MemberRole, …>` annotation makes this
 * exhaustive: renaming or adding a role in schema.prisma surfaces here as a
 * compile error, so the map can never silently drift from the DB enum.
 */
export const ROLE_CAPABILITIES: Record<MemberRole, ReadonlySet<Capability>> = {
  VIEWER: new Set(VIEWER_CAPABILITIES),
  MEMBER: new Set(MEMBER_CAPABILITIES),
  ADMIN: new Set(ADMIN_CAPABILITIES),
  OWNER: new Set(OWNER_CAPABILITIES),
};

/** Whether `role` is permitted to perform `capability`. */
export function can(role: MemberRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].has(capability);
}

/** The full list of capabilities granted to `role`. */
export function capabilitiesFor(role: MemberRole): Capability[] {
  return [...ROLE_CAPABILITIES[role]];
}
