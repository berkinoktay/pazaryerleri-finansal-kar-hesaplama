'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api-error';

import { useShippingCarriers } from '../hooks/use-shipping-carriers';
import { useShippingConfig } from '../hooks/use-shipping-config';
import { useUpdateShippingConfig } from '../hooks/use-update-shipping-config';
import type { ShippingConfig, ShippingTariffSource } from '../types/shipping.types';
import {
  ShippingConfigFormSchema,
  type ShippingConfigFormValues,
} from '../validation/shipping-config.schema';

import { CarrierSelect } from './carrier-select';
import { ShippingConfigEmptyState } from './shipping-config-empty-state';
import { ShippingTariffSourceSegment } from './shipping-tariff-source-segment';

export interface ShippingConfigFormProps {
  orgId: string;
  storeId: string;
  platform: 'TRENDYOL' | 'HEPSIBURADA';
}

/**
 * Form codes that the backend's VALIDATION_ERROR -> errors[] surface
 * issues with. Used both to localize a client-side zod failure and to
 * paint the inline message when the server returns the same code.
 */
const KNOWN_FIELD_ERROR_CODES = new Set([
  'SHIPPING_CARRIER_REQUIRED_FOR_TRENDYOL_CONTRACT',
  'SHIPPING_CARRIER_PLATFORM_MISMATCH',
  'SHIPPING_CARRIER_NOT_FOUND',
]);

function knownErrorCodeFor(value: string | undefined): string | undefined {
  return value !== undefined && KNOWN_FIELD_ERROR_CODES.has(value) ? value : undefined;
}

/**
 * Maps the mutation's last error (if any) to an inline field-error
 * code. Pure projection — keeps the effect-free render path.
 */
function deriveServerErrorCode(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.code === 'VALIDATION_ERROR') {
    const carrierIssue = error.problem.errors?.find(
      (issue) => issue.field === 'defaultShippingCarrierId',
    );
    return carrierIssue?.code;
  }
  if (KNOWN_FIELD_ERROR_CODES.has(error.code)) return error.code;
  return undefined;
}

interface FormDraft {
  source: ShippingTariffSource;
  carrierId: string | null;
}

/**
 * Reads the user's pending edits if they exist, otherwise falls back
 * to the server snapshot, otherwise to the safe defaults. The user-
 * edited layer is only set by the segment/dropdown handlers — it is
 * untouched by query refetches, so users don't lose in-progress edits
 * when the cache revalidates.
 */
function resolveDraft(
  pendingDraft: FormDraft | null,
  serverConfig: ShippingConfig | undefined,
): FormDraft {
  if (pendingDraft !== null) return pendingDraft;
  if (serverConfig !== undefined) {
    return {
      source: serverConfig.shippingTariffSource,
      carrierId: serverConfig.defaultShippingCarrierId,
    };
  }
  return { source: 'TRENDYOL_CONTRACT', carrierId: null };
}

/**
 * Inline Segment layout for the store's "Kargo" settings section:
 *
 *   1. Segment control toggles `TRENDYOL_CONTRACT` ↔ `OWN_CONTRACT`.
 *   2. TRENDYOL_CONTRACT shows a carrier dropdown + help text + save.
 *   3. OWN_CONTRACT shows the "yakında" empty state (V1: Excel upload
 *      not yet shipped) and hides the dropdown.
 *
 * State strategy: a nullable `pendingDraft` holds user edits;
 * everything else is derived during render from the React Query
 * snapshot or the mutation's error state. No `useEffect` —
 * react-hooks/set-state-in-effect already lints against the "copy
 * server state into local state" pattern, and a draft-overlay model
 * fits this two-field form cleanly. Backend validation errors fall
 * through `mutation.error` and surface as an inline message via
 * `deriveServerErrorCode`.
 */
export function ShippingConfigForm({
  orgId,
  storeId,
  platform,
}: ShippingConfigFormProps): React.ReactElement {
  const t = useTranslations('shipping.settings');
  const tErr = useTranslations('shipping.errors');
  const tCommon = useTranslations('common');

  const configQuery = useShippingConfig(orgId, storeId);
  const carriersQuery = useShippingCarriers(orgId, platform);
  const updateMutation = useUpdateShippingConfig(orgId, storeId);

  const [pendingDraft, setPendingDraft] = useState<FormDraft | null>(null);
  const [clientErrorCode, setClientErrorCode] = useState<string | undefined>(undefined);

  const { source, carrierId } = resolveDraft(pendingDraft, configQuery.data);

  const serverErrorCode = deriveServerErrorCode(updateMutation.error);
  const errorCode = knownErrorCodeFor(clientErrorCode ?? serverErrorCode);

  const handleSegmentChange = (next: ShippingTariffSource): void => {
    setPendingDraft({ source: next, carrierId });
    setClientErrorCode(undefined);
  };

  const handleCarrierChange = (next: string): void => {
    setPendingDraft({ source, carrierId: next });
    setClientErrorCode(undefined);
  };

  const handleSave = (): void => {
    // Build the payload the backend expects. OWN_CONTRACT clears the
    // carrier id (a carrier is meaningless when we are not using the
    // Trendyol tariff to price shipping).
    const payload: ShippingConfigFormValues = {
      shippingTariffSource: source,
      defaultShippingCarrierId: source === 'OWN_CONTRACT' ? null : carrierId,
    };

    // Client-side validation. The schema raises the same code the
    // backend would return on 422, so the inline message reads the
    // same regardless of which side caught it.
    const parsed = ShippingConfigFormSchema.safeParse(payload);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      setClientErrorCode(firstIssue?.message);
      return;
    }

    setClientErrorCode(undefined);
    updateMutation.mutate(parsed.data, {
      onSuccess: () => {
        // Clear the local draft so future query updates flow through.
        setPendingDraft(null);
        toast.success(t('saveSuccess'));
      },
    });
  };

  return (
    <section className="gap-md flex flex-col">
      <header className="gap-3xs flex flex-col">
        <h2 className="text-md text-foreground font-semibold">{t('title')}</h2>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </header>

      <ShippingTariffSourceSegment value={source} onChange={handleSegmentChange} />

      {source === 'TRENDYOL_CONTRACT' ? (
        <div className="gap-2xs flex flex-col">
          <Label htmlFor="shipping-carrier-select">{t('carrierLabel')}</Label>
          <div id="shipping-carrier-select">
            <CarrierSelect
              carriers={carriersQuery.data ?? []}
              value={carrierId}
              onChange={handleCarrierChange}
              disabled={carriersQuery.isLoading}
              invalid={errorCode !== undefined}
            />
          </div>
          {errorCode !== undefined ? (
            <p className="text-destructive text-sm" role="alert">
              {tErr(errorCode as Parameters<typeof tErr>[0])}
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">{t('carrierHelp')}</p>
          )}
        </div>
      ) : (
        <ShippingConfigEmptyState />
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={handleSave}
          disabled={updateMutation.isPending || configQuery.isLoading}
        >
          {updateMutation.isPending ? tCommon('loading') : tCommon('save')}
        </Button>
      </div>
    </section>
  );
}
