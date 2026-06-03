'use client';

import { CAPABILITIES } from '@pazarsync/utils';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCan } from '@/providers/current-scope';

import { ROLE_LABEL_KEY, type Member, type MemberRole, type Store } from '../api/members.api';
import { MemberRoleDialog } from './member-role-dialog';
import { MemberStoreAccessDialog } from './member-store-access-dialog';

// Same role→badge mapping as the org switcher, kept consistent across surfaces.
// OWNER stands out (solid primary); MEMBER/VIEWER stay low-emphasis (outline).
const ROLE_BADGE: Record<
  MemberRole,
  { tone: BadgeProps['tone']; variant?: BadgeProps['variant'] }
> = {
  OWNER: { tone: 'primary', variant: 'solid' },
  ADMIN: { tone: 'neutral' },
  MEMBER: { tone: 'neutral', variant: 'outline' },
  VIEWER: { tone: 'neutral', variant: 'outline' },
};

interface MembersTableProps {
  orgId: string;
  members: Member[];
  stores: Store[];
}

export function MembersTable({ orgId, members, stores }: MembersTableProps): ReactElement {
  const t = useTranslations('settings.members');
  const tRoles = useTranslations('settings.members.roles');
  const canManageRoles = useCan(CAPABILITIES.MEMBERS_MANAGE_ROLES);
  const canManageAccess = useCan(CAPABILITIES.MEMBERS_MANAGE_ACCESS);

  const [roleMember, setRoleMember] = useState<Member | null>(null);
  const [accessMember, setAccessMember] = useState<Member | null>(null);

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('table.columns.member')}</TableHead>
            <TableHead>{t('table.columns.role')}</TableHead>
            <TableHead>{t('table.columns.storeAccess')}</TableHead>
            <TableHead className="text-right">{t('table.columns.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => {
            // accessibleStoreIds === null means "all stores" (OWNER/ADMIN by role),
            // for whom per-store editing is meaningless.
            const seesAllStores = member.accessibleStoreIds === null;
            return (
              <TableRow key={member.id}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{member.fullName ?? member.email}</span>
                    {member.fullName !== null ? (
                      <span className="text-muted-foreground text-xs">{member.email}</span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    tone={ROLE_BADGE[member.role].tone}
                    variant={ROLE_BADGE[member.role].variant}
                    size="sm"
                  >
                    {tRoles(ROLE_LABEL_KEY[member.role])}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {seesAllStores
                    ? t('storeAccess.all')
                    : t('storeAccess.count', { count: member.accessibleStoreIds?.length ?? 0 })}
                </TableCell>
                <TableCell className="text-right">
                  <div className="gap-2xs flex justify-end">
                    {canManageAccess && !seesAllStores ? (
                      <Button variant="ghost" size="sm" onClick={() => setAccessMember(member)}>
                        {t('actions.editAccess')}
                      </Button>
                    ) : null}
                    {canManageRoles ? (
                      <Button variant="ghost" size="sm" onClick={() => setRoleMember(member)}>
                        {t('actions.editRole')}
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {roleMember !== null ? (
        <MemberRoleDialog
          key={roleMember.id}
          orgId={orgId}
          member={roleMember}
          open
          onOpenChange={(open) => {
            if (!open) setRoleMember(null);
          }}
        />
      ) : null}
      {accessMember !== null ? (
        <MemberStoreAccessDialog
          key={accessMember.id}
          orgId={orgId}
          member={accessMember}
          stores={stores}
          open
          onOpenChange={(open) => {
            if (!open) setAccessMember(null);
          }}
        />
      ) : null}
    </>
  );
}
