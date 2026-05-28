import { describe, it, expect } from 'vitest';
import { MemberRole } from '@pazarsync/db/enums';
import {
  CAPABILITIES,
  ROLE_CAPABILITIES,
  can,
  capabilitiesFor,
  type Capability,
} from '../src/permissions';

describe('can()', () => {
  it('grants every capability to OWNER', () => {
    for (const cap of Object.values(CAPABILITIES)) {
      expect(can('OWNER', cap)).toBe(true);
    }
  });

  it('limits VIEWER to read-only', () => {
    expect(can('VIEWER', CAPABILITIES.DATA_READ)).toBe(true);
    expect(can('VIEWER', CAPABILITIES.DATA_WRITE)).toBe(false);
    expect(can('VIEWER', CAPABILITIES.SYNC_TRIGGER)).toBe(false);
  });

  it('lets MEMBER write data and trigger sync but not manage stores or members', () => {
    expect(can('MEMBER', CAPABILITIES.DATA_WRITE)).toBe(true);
    expect(can('MEMBER', CAPABILITIES.SYNC_TRIGGER)).toBe(true);
    expect(can('MEMBER', CAPABILITIES.STORES_CONNECT)).toBe(false);
    expect(can('MEMBER', CAPABILITIES.MEMBERS_READ)).toBe(false);
  });

  it('lets ADMIN manage stores, member access and settings', () => {
    expect(can('ADMIN', CAPABILITIES.STORES_CONNECT)).toBe(true);
    expect(can('ADMIN', CAPABILITIES.STORES_DISCONNECT)).toBe(true);
    expect(can('ADMIN', CAPABILITIES.STORES_CONFIGURE)).toBe(true);
    expect(can('ADMIN', CAPABILITIES.MEMBERS_READ)).toBe(true);
    expect(can('ADMIN', CAPABILITIES.MEMBERS_MANAGE_ACCESS)).toBe(true);
    expect(can('ADMIN', CAPABILITIES.ORG_MANAGE_SETTINGS)).toBe(true);
  });

  it('blocks privilege escalation: only OWNER manages roles or deletes the org', () => {
    expect(can('ADMIN', CAPABILITIES.MEMBERS_MANAGE_ROLES)).toBe(false);
    expect(can('ADMIN', CAPABILITIES.ORG_DELETE)).toBe(false);
    expect(can('OWNER', CAPABILITIES.MEMBERS_MANAGE_ROLES)).toBe(true);
    expect(can('OWNER', CAPABILITIES.ORG_DELETE)).toBe(true);
  });
});

describe('capabilitiesFor()', () => {
  it('returns exactly the read capability for VIEWER', () => {
    expect(capabilitiesFor('VIEWER')).toEqual([CAPABILITIES.DATA_READ]);
  });

  it('reflects the full set for a role', () => {
    const member = capabilitiesFor('MEMBER');
    expect(member).toEqual(
      expect.arrayContaining([
        CAPABILITIES.DATA_READ,
        CAPABILITIES.DATA_WRITE,
        CAPABILITIES.SYNC_TRIGGER,
      ]),
    );
    expect(member).not.toContain(CAPABILITIES.STORES_CONNECT);
  });
});

describe('ROLE_CAPABILITIES', () => {
  it('defines a capability set for every MemberRole (composition-root coverage)', () => {
    for (const role of Object.values(MemberRole)) {
      expect(ROLE_CAPABILITIES[role]).toBeInstanceOf(Set);
    }
  });

  it('is monotonic: OWNER ⊇ ADMIN ⊇ MEMBER ⊇ VIEWER', () => {
    const isSuperset = (sup: ReadonlySet<Capability>, sub: ReadonlySet<Capability>): boolean =>
      [...sub].every((c) => sup.has(c));
    expect(isSuperset(ROLE_CAPABILITIES.OWNER, ROLE_CAPABILITIES.ADMIN)).toBe(true);
    expect(isSuperset(ROLE_CAPABILITIES.ADMIN, ROLE_CAPABILITIES.MEMBER)).toBe(true);
    expect(isSuperset(ROLE_CAPABILITIES.MEMBER, ROLE_CAPABILITIES.VIEWER)).toBe(true);
  });
});
