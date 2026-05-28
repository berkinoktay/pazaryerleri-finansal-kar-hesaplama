'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError } from '@/lib/api-error';

import { ROLE_LABEL_KEY, type Member, type MemberRole } from '../api/members.api';
import { useUpdateMemberRole } from '../hooks/use-member-mutations';

const ROLES: readonly MemberRole[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'];

/** True for the last-owner guard so the dialog can render a precise message. */
function isLastOwnerError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.code === 'VALIDATION_ERROR' &&
    (error.problem.errors ?? []).some((issue) => issue.code === 'CANNOT_DEMOTE_LAST_OWNER')
  );
}

interface MemberRoleDialogProps {
  orgId: string;
  member: Member;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MemberRoleDialog({
  orgId,
  member,
  open,
  onOpenChange,
}: MemberRoleDialogProps): ReactElement {
  const t = useTranslations('settings.members');
  const tRoles = useTranslations('settings.members.roles');
  const mutation = useUpdateMemberRole(orgId);
  const [role, setRole] = useState<MemberRole>(member.role);

  function handleSave(): void {
    mutation.mutate({ memberId: member.id, role }, { onSuccess: () => onOpenChange(false) });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-modal">
        <DialogHeader>
          <DialogTitle>{t('roleDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('roleDialog.description', { email: member.email })}
          </DialogDescription>
        </DialogHeader>

        <Select value={role} onValueChange={(value) => setRole(value as MemberRole)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {tRoles(ROLE_LABEL_KEY[r])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isLastOwnerError(mutation.error) ? (
          <p className="text-destructive text-sm">{t('errors.CANNOT_DEMOTE_LAST_OWNER')}</p>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            {t('roleDialog.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={mutation.isPending || role === member.role}>
            {mutation.isPending ? t('roleDialog.saving') : t('roleDialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
