'use client';

import { useTranslations } from 'next-intl';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { CreateOrganizationForm } from './create-organization-form';

export interface CreateOrganizationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Modal wrapper around CreateOrganizationForm. Triggered from the
 * OrgSwitcher's "+ create new" action. On successful creation the
 * form's mutation handler (in use-create-organization.ts) navigates
 * to `/dashboard` — no modal-level success handler needed.
 */
export function CreateOrganizationModal({
  open,
  onOpenChange,
}: CreateOrganizationModalProps): React.ReactElement {
  const t = useTranslations('organizations.create');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-modal">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>
        <CreateOrganizationForm
          autoFocus
          onCancel={() => onOpenChange(false)}
          onSuccess={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
