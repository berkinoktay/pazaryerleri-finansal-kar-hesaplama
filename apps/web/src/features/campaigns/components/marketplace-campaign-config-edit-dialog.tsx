'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { useForm, useWatch } from 'react-hook-form';

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

import { useUpdateMarketplaceCampaign } from '../hooks/use-update-marketplace-campaign';
import type { MarketplaceCampaignHeader } from '../lib/adapt-marketplace-campaign';
import {
  campaignConfigFormSchema,
  type CampaignConfigFormInput,
  type CampaignConfigFormValues,
} from '../lib/marketplace-campaign-config';
import {
  MarketplaceCampaignConfigFields,
  placedConfigFields,
} from './marketplace-campaign-config-fields';
import { UploadUnplacedIssues } from './upload-unplaced-issues';

/**
 * The saved config (numbers + nullable fields) as the string-based form values: null → undefined
 * so an absent parameter leaves its field empty, counts → strings (the inputs are free text), and
 * the funding rate as the backend serialized it.
 */
function toFormDefaults(header: MarketplaceCampaignHeader): CampaignConfigFormInput {
  return {
    discountType: header.discountType,
    valueKind: header.valueKind ?? undefined,
    value: header.value ?? undefined,
    minBasketAmount: header.minBasketAmount ?? undefined,
    minQuantity: header.minQuantity != null ? String(header.minQuantity) : undefined,
    buyQuantity: header.buyQuantity != null ? String(header.buyQuantity) : undefined,
    payQuantity: header.payQuantity != null ? String(header.payQuantity) : undefined,
    nthIndex: header.nthIndex != null ? String(header.nthIndex) : undefined,
    trendyolFundingPct: header.trendyolFundingPct,
    startsAt: header.startsAt ?? undefined,
    endsAt: header.endsAt ?? undefined,
  };
}

export interface MarketplaceCampaignConfigEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  storeId: string;
  campaignId: string;
  /** The saved campaign — seeds the form + the current name. */
  header: MarketplaceCampaignHeader;
}

/**
 * Edits a saved campaign's configuration in place: the SAME config section the upload dialog uses
 * ({@link MarketplaceCampaignConfigFields}) minus the file, seeded from the saved values. Saving
 * PATCHes the config through {@link useUpdateMarketplaceCampaign} — which invalidates the detail
 * so every row recomputes — then closes; the seller's buffered price choices survive the reload.
 *
 * The PATCH FULL-REPLACES the config, so an omitted field is reset. The form output always carries
 * every field the kurgu needs plus an explicit funding rate (an emptied rate resolves to "0"), so
 * a save can never silently zero a rate the seller did not touch. The same validator that gates
 * the upload gates this body; a 422 renders inline. The parent mounts this only while open, so the
 * form seeds fresh each time.
 */
export function MarketplaceCampaignConfigEditDialog({
  open,
  onOpenChange,
  orgId,
  storeId,
  campaignId,
  header,
}: MarketplaceCampaignConfigEditDialogProps): React.ReactElement {
  const t = useTranslations('marketplaceCampaignsPage.configCard');
  const tCommon = useTranslations('common');
  const update = useUpdateMarketplaceCampaign(orgId, storeId, campaignId);

  const [name, setName] = React.useState(header.name);

  const form = useForm<CampaignConfigFormInput, unknown, CampaignConfigFormValues>({
    resolver: zodResolver(campaignConfigFormSchema),
    defaultValues: toFormDefaults(header),
  });
  // The kurgu decides which parameters have an input, so it decides which issues are unplaced.
  const discountType = useWatch({ control: form.control, name: 'discountType' });

  const handleValid = (values: CampaignConfigFormValues): void => {
    // A rename is sent only when the seller changed the name. The comparison is on the raw
    // input, before trimming: `trim()` strips a leading U+FEFF, so a name stored before the name
    // rule would compare as changed, be resent, and the API would refuse every save of it.
    const trimmedName = name.trim();
    const nameChanged = name !== header.name && trimmedName !== '';
    update.mutate(
      { ...values, ...(nameChanged ? { name: trimmedName } : {}) },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="marketplace-campaign-upload-modal flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t('editTitle')}</DialogTitle>
          <DialogDescription>{t('editDescription')}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            noValidate
            onSubmit={form.handleSubmit(handleValid)}
            className="gap-md flex min-h-0 flex-1 flex-col"
          >
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="gap-md flex flex-col">
                <MarketplaceCampaignConfigFields
                  form={form}
                  nameValue={name}
                  onNameChange={setName}
                  submitError={update.error}
                />
                <UploadUnplacedIssues
                  error={update.error}
                  placedFields={placedConfigFields(discountType)}
                />
              </div>
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
