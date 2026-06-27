'use client';

import { Add01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

/**
 * "Üye davet et" action for the Üyeler page header. Email invitations aren't
 * wired yet (no MemberInvitation backend), so this is draft — clicking
 * surfaces a "coming soon" toast instead of opening an invite flow.
 */
export function InviteMemberButton(): React.ReactElement {
  const t = useTranslations('settings.members');
  const tStatus = useTranslations('featureStatus');

  return (
    <Button size="sm" onClick={() => toast.info(tStatus('draftActionToast'))}>
      <Add01Icon />
      {t('invite')}
    </Button>
  );
}
