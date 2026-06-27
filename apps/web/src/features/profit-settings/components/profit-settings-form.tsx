'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { SettingsRow, SettingsRowGroup } from '@/components/patterns/settings-row';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { SettingsCardHeader } from '@/components/patterns/settings-section';
import { Switch } from '@/components/ui/switch';
import { DOMAIN_ICONS } from '@/lib/domain-icons';

import { useStoreProfitSettings } from '../hooks/use-store-profit-settings';
import { useUpdateStoreProfitSettings } from '../hooks/use-update-store-profit-settings';
import type { ProfitSettings } from '../types/profit-settings.types';

export interface ProfitSettingsFormProps {
  orgId: string;
  storeId: string;
}

type FormDraft = ProfitSettings;

const FALLBACK_DRAFT: FormDraft = { includeStopaj: true, includeNegativeNetVat: false };

/**
 * Reads the user's pending edits if they exist, otherwise the server snapshot,
 * otherwise the safe defaults. The pending layer is only set by the toggle
 * handlers, so a query refetch never clobbers in-progress edits. No `useEffect`
 * (react-hooks/set-state-in-effect forbids copying server state into local state).
 */
function resolveDraft(pending: FormDraft | null, server: ProfitSettings | undefined): FormDraft {
  if (pending !== null) return pending;
  if (server !== undefined) return server;
  return FALLBACK_DRAFT;
}

/**
 * Store > Kâr Formülü settings: two toggles (stopaj dahil, negatif Net KDV dahil)
 * with a "snapshot-at-create / forward-only" notice. Composes SettingsRow + Switch
 * inside a Card with a Save button — mirrors the shipping-config draft-overlay model.
 */
export function ProfitSettingsForm({
  orgId,
  storeId,
}: ProfitSettingsFormProps): React.ReactElement {
  const t = useTranslations('settings.profitSettings');
  const tCommon = useTranslations('common');

  const settingsQuery = useStoreProfitSettings(orgId, storeId);
  const updateMutation = useUpdateStoreProfitSettings(orgId, storeId);

  const [pendingDraft, setPendingDraft] = useState<FormDraft | null>(null);
  const draft = resolveDraft(pendingDraft, settingsQuery.data);

  const setField = (field: keyof FormDraft, value: boolean): void => {
    setPendingDraft({ ...draft, [field]: value });
  };

  const handleSave = (): void => {
    updateMutation.mutate(draft, {
      onSuccess: () => {
        setPendingDraft(null);
        toast.success(t('saveSuccess'));
      },
    });
  };

  return (
    <Card>
      <SettingsCardHeader
        icon={<DOMAIN_ICONS.accounting />}
        title={t('cardTitle')}
        description={t('cardDescription')}
      />
      <CardContent className="gap-md flex flex-col">
        <Alert tone="info" size="sm">
          <AlertTitle>{t('forwardOnlyTitle')}</AlertTitle>
          <AlertDescription>
            <p className="text-2xs">{t('forwardOnlyBody')}</p>
          </AlertDescription>
        </Alert>

        <SettingsRowGroup>
          <SettingsRow
            htmlFor="profit-include-stopaj"
            icon={<DOMAIN_ICONS.withholding />}
            title={t('stopaj.title')}
            description={t('stopaj.description')}
            control={
              <Switch
                id="profit-include-stopaj"
                checked={draft.includeStopaj}
                onCheckedChange={(v) => {
                  setField('includeStopaj', v);
                }}
                disabled={settingsQuery.isLoading}
              />
            }
          />
          <SettingsRow
            htmlFor="profit-include-negative-net-vat"
            icon={<DOMAIN_ICONS.vat />}
            title={t('negativeNetVat.title')}
            description={t('negativeNetVat.description')}
            control={
              <Switch
                id="profit-include-negative-net-vat"
                checked={draft.includeNegativeNetVat}
                onCheckedChange={(v) => {
                  setField('includeNegativeNetVat', v);
                }}
                disabled={settingsQuery.isLoading}
              />
            }
          />
        </SettingsRowGroup>
      </CardContent>
      <CardFooter className="justify-end">
        <Button
          type="button"
          onClick={handleSave}
          disabled={updateMutation.isPending || settingsQuery.isLoading}
        >
          {updateMutation.isPending ? tCommon('loading') : tCommon('save')}
        </Button>
      </CardFooter>
    </Card>
  );
}
