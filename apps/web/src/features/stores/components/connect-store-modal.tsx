'use client';

import { useTranslations } from 'next-intl';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { ConnectStoreForm } from './connect-store-form';

export interface ConnectStoreModalProps {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConnectStoreModal({
  orgId,
  open,
  onOpenChange,
}: ConnectStoreModalProps): React.ReactElement {
  const t = useTranslations('stores.connect');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-modal">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>
        <ConnectStoreForm orgId={orgId} autoFocus onSuccess={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
