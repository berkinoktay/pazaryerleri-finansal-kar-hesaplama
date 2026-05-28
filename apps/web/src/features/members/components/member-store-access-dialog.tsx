'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

import type { Member, Store } from '../api/members.api';
import { useSetMemberStoreAccess } from '../hooks/use-member-mutations';

interface MemberStoreAccessDialogProps {
  orgId: string;
  member: Member;
  /** Every store in the org — the managing caller (OWNER/ADMIN) sees them all. */
  stores: Store[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Replace which stores a MEMBER/VIEWER may see. A checklist of the org's stores,
 * pre-checked from the member's current grants; saving sends the full selected
 * set (full replace, not a delta).
 */
export function MemberStoreAccessDialog({
  orgId,
  member,
  stores,
  open,
  onOpenChange,
}: MemberStoreAccessDialogProps): ReactElement {
  const t = useTranslations('settings.members.storeAccessDialog');
  const mutation = useSetMemberStoreAccess(orgId);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(member.accessibleStoreIds ?? []),
  );

  function toggle(storeId: string, checked: boolean): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(storeId);
      } else {
        next.delete(storeId);
      }
      return next;
    });
  }

  function handleSave(): void {
    mutation.mutate(
      { memberId: member.id, storeIds: [...selected] },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-modal">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description', { email: member.email })}</DialogDescription>
        </DialogHeader>

        {stores.length === 0 ? (
          <p className="text-muted-foreground py-sm text-sm">{t('noStores')}</p>
        ) : (
          <div className="gap-3xs py-xs flex max-h-80 flex-col overflow-y-auto">
            {stores.map((store) => (
              <Label
                key={store.id}
                htmlFor={`store-access-${store.id}`}
                className="hover:bg-muted gap-sm p-xs flex cursor-pointer items-center rounded-md"
              >
                <Checkbox
                  id={`store-access-${store.id}`}
                  checked={selected.has(store.id)}
                  onCheckedChange={(checked) => {
                    toggle(store.id, checked === true);
                  }}
                />
                <span className="text-sm">{store.name}</span>
              </Label>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            {t('cancel')}
          </Button>
          <Button onClick={handleSave} disabled={mutation.isPending}>
            {mutation.isPending ? t('saving') : t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
