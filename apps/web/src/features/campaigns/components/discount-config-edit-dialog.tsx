'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Form } from '@/components/ui/form';

import type { DiscountListDetail } from '../api/get-discount-list-detail.api';
import type { UpdateDiscountListBody } from '../api/update-discount-list.api';
import { useUpdateDiscountList } from '../hooks/use-update-discount-list';
import { discountConfigFormSchema, type DiscountConfigFormValues } from '../lib/discount-config';
import { DiscountConfigFields } from './discount-config-fields';

/**
 * Converts a saved list's config (numbers + nullable fields) into the string-based form values
 * the config form expects: null → undefined so an absent parameter leaves its field empty, and
 * counts → strings (the inputs are free-text numeric). Mirrors the backend's per-type shape.
 */
function toFormDefaults(list: DiscountListDetail): DiscountConfigFormValues {
  return {
    discountType: list.discountType,
    valueKind: list.valueKind ?? undefined,
    value: list.value ?? undefined,
    minBasketAmount: list.minBasketAmount ?? undefined,
    minQuantity: list.minQuantity != null ? String(list.minQuantity) : undefined,
    buyQuantity: list.buyQuantity != null ? String(list.buyQuantity) : undefined,
    payQuantity: list.payQuantity != null ? String(list.payQuantity) : undefined,
    nthIndex: list.nthIndex != null ? String(list.nthIndex) : undefined,
    orderLimit: list.orderLimit != null ? String(list.orderLimit) : undefined,
    startsAt: list.startsAt ?? undefined,
    endsAt: list.endsAt ?? undefined,
  };
}

export interface DiscountConfigEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  storeId: string;
  listId: string;
  /** The saved list — seeds the form defaults + the current name. */
  list: DiscountListDetail;
}

/**
 * Edits a saved İndirimler list's discount configuration in place: the SAME config section the
 * upload dialog uses ({@link DiscountConfigFields}) minus the file dropzone, seeded from the
 * list's current values. Saving PATCHes the config through {@link useUpdateDiscountList} — which
 * invalidates the detail so every row's discounted scenario recomputes — then closes. The same
 * validator that gates the upload gates this body, so a combination Trendyol wouldn't accept is a
 * 422 surfaced inline. The parent mounts this only while open, so the form seeds fresh each time.
 */
export function DiscountConfigEditDialog({
  open,
  onOpenChange,
  orgId,
  storeId,
  listId,
  list,
}: DiscountConfigEditDialogProps): React.ReactElement {
  const t = useTranslations('discountsPage.configCard');
  const tCommon = useTranslations('common');
  const update = useUpdateDiscountList(orgId, storeId, listId);

  const [name, setName] = React.useState(list.name);

  const form = useForm<DiscountConfigFormValues>({
    resolver: zodResolver(discountConfigFormSchema),
    defaultValues: toFormDefaults(list),
  });

  const handleValid = (values: DiscountConfigFormValues): void => {
    const trimmedName = name.trim();
    const body: UpdateDiscountListBody = {
      ...values,
      name: trimmedName === '' ? undefined : trimmedName,
    };
    update.mutate(body, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="discount-upload-modal flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('assumption')}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            noValidate
            onSubmit={form.handleSubmit(handleValid)}
            className="gap-md flex min-h-0 flex-1 flex-col"
          >
            <div className="min-h-0 flex-1 overflow-y-auto">
              <DiscountConfigFields
                form={form}
                nameValue={name}
                onNameChange={setName}
                submitError={update.error}
              />
            </div>

            <DialogFooter className="shrink-0">
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  {tCommon('cancel')}
                </Button>
              </DialogClose>
              <Button type="submit" loading={update.isPending}>
                {tCommon('save')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
