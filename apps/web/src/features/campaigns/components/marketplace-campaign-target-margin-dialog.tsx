'use client';

import { Decimal } from 'decimal.js';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { PercentageInput } from '@/components/patterns/percentage-input';
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
import { Label } from '@/components/ui/label';

import type { TargetMarginResult } from '../api/suggest-target-margin.api';
import { useSuggestTargetMargin } from '../hooks/use-suggest-target-margin';

/**
 * A net profit margin can never reach 100% — the whole price would have to be profit. The backend
 * answers such a target with UNREACHABLE for every product, which would drop every visible product
 * from the campaign, so a typo like "150" for "15,0" is refused here instead.
 */
const MARGIN_CEILING_PCT = 100;

export interface MarketplaceCampaignTargetMarginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  storeId: string;
  campaignId: string;
  /** Puts the backend's suggestions into the caller's LOCAL buffer — nothing is saved here. */
  onApply: (suggestions: TargetMarginResult['suggestions']) => void;
}

/**
 * "Hedef marja göre özel fiyat doldur": takes a target profit margin, asks the backend for the
 * lowest campaign price per product that keeps it (the endpoint computes and returns, it writes
 * nothing), hands the suggestions to the caller's buffer, and closes. The parent mounts this only
 * while open, so the field starts empty each time.
 */
export function MarketplaceCampaignTargetMarginDialog({
  open,
  onOpenChange,
  orgId,
  storeId,
  campaignId,
  onApply,
}: MarketplaceCampaignTargetMarginDialogProps): React.ReactElement {
  const t = useTranslations('marketplaceCampaignsPage.targetMargin');
  const tCommon = useTranslations('common');
  const inputId = React.useId();
  const hintId = React.useId();
  const errorId = React.useId();
  const { mutate: suggest, isPending } = useSuggestTargetMargin(orgId, storeId, campaignId);
  const [margin, setMargin] = React.useState<Decimal | null>(null);
  const tooHigh = margin !== null && margin.greaterThanOrEqualTo(MARGIN_CEILING_PCT);

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (margin === null || tooHigh) return;
    suggest(
      { targetMarginPct: margin.toFixed(2) },
      {
        onSuccess: (result) => {
          onApply(result.suggestions);
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <form noValidate onSubmit={handleSubmit} className="gap-md flex flex-col">
          <div className="gap-2xs flex flex-col">
            <Label htmlFor={inputId}>{t('label')}</Label>
            <PercentageInput
              id={inputId}
              value={margin}
              onChange={setMargin}
              nonNegative
              invalid={tooHigh}
              aria-invalid={tooHigh}
              aria-describedby={tooHigh ? `${errorId} ${hintId}` : hintId}
              className="max-w-input-narrow"
            />
            {tooHigh ? (
              <p id={errorId} className="text-2xs text-destructive">
                {t('tooHigh')}
              </p>
            ) : null}
            <p id={hintId} className="text-2xs text-muted-foreground">
              {t('hint')}
            </p>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tCommon('cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={margin === null || tooHigh} loading={isPending}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
