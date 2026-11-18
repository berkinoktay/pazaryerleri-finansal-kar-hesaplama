import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';

import { Form } from '@/components/ui/form';
import { MarketplaceCampaignConfigFields } from '@/features/campaigns/components/marketplace-campaign-config-fields';
import {
  campaignConfigFormSchema,
  type CampaignConfigFormInput,
  type CampaignConfigFormValues,
} from '@/features/campaigns/lib/marketplace-campaign-config';

import trMessages from '../../../../messages/tr.json';
import { validationApiError } from '../../../helpers/api-error';
import { render, screen, waitFor } from '../../../helpers/render';

const UPLOAD = trMessages.marketplaceCampaignsPage.upload;
const FIELDS = trMessages.discountsPage.upload.fields;
const TYPES = trMessages.discountsPage.types;
const FIELD_ERRORS = trMessages.discountsPage.upload.fieldErrors;
const SUBMIT_LABEL = 'submit';

/** A saved NET + percent campaign with its window — the SEEDED state an edit dialog mounts. */
const SEEDED: CampaignConfigFormInput = {
  discountType: 'NET',
  valueKind: 'PERCENT',
  value: '20',
  startsAt: '2026-08-01T10:00:00+03:00',
  endsAt: '2026-08-07T23:59:00+03:00',
};

/**
 * Mounts the fields the way a seeded (edit-style) dialog does: the form starts from saved values,
 * which is where RHF's mount-time-default fallback hides a stale value after a kurgu change.
 */
function Harness({
  defaultValues,
  onValid,
  submitError = null,
}: {
  defaultValues: CampaignConfigFormInput;
  onValid: (values: CampaignConfigFormValues) => void;
  submitError?: Error | null;
}): React.ReactElement {
  const form = useForm<CampaignConfigFormInput, unknown, CampaignConfigFormValues>({
    resolver: zodResolver(campaignConfigFormSchema),
    defaultValues,
  });
  const [name, setName] = React.useState('');
  return (
    <Form {...form}>
      <form noValidate onSubmit={form.handleSubmit(onValid)}>
        <MarketplaceCampaignConfigFields
          form={form}
          nameValue={name}
          onNameChange={setName}
          submitError={submitError}
        />
        <button type="submit">{SUBMIT_LABEL}</button>
      </form>
    </Form>
  );
}

function renderHarness(
  defaultValues: CampaignConfigFormInput = SEEDED,
  submitError: Error | null = null,
) {
  const onValid = vi.fn<(values: CampaignConfigFormValues) => void>();
  const result = render(
    <Harness defaultValues={defaultValues} onValid={onValid} submitError={submitError} />,
  );
  return { ...result, onValid };
}

/** Opens a Radix Select by its label and picks the option with the given name. */
async function pick(
  user: ReturnType<typeof render>['user'],
  label: string,
  option: string,
): Promise<void> {
  await user.click(screen.getByLabelText(label));
  await user.click(await screen.findByRole('option', { name: option }));
}

describe('<MarketplaceCampaignConfigFields> seeded like the edit dialog', () => {
  it('submits an explicit "0" when the funding rate is left empty', async () => {
    const { user, onValid } = renderHarness();

    await user.click(screen.getByRole('button', { name: SUBMIT_LABEL }));

    await waitFor(() =>
      expect(onValid).toHaveBeenCalledWith(
        expect.objectContaining({ trendyolFundingPct: '0' }),
        expect.anything(),
      ),
    );
  });

  it('lets a seeded value be cleared and retyped — it never snaps back to the saved one', async () => {
    const { user, onValid } = renderHarness();
    const value = screen.getByLabelText(FIELDS.value);

    // The regression: an emptied seeded field used to fall back to its mount-time default, so
    // clearing "20" and typing "35" read "2035".
    await user.clear(value);
    expect(value).toHaveValue('');
    await user.type(value, '35');
    expect(value).toHaveValue('35');

    await user.click(screen.getByRole('button', { name: SUBMIT_LABEL }));
    await waitFor(() =>
      expect(onValid).toHaveBeenCalledWith(
        expect.objectContaining({ value: '35' }),
        expect.anything(),
      ),
    );
  });

  it('lets a seeded funding rate be cleared — the emptied rate submits as "0"', async () => {
    const { user, onValid } = renderHarness({ ...SEEDED, trendyolFundingPct: '60' });
    const funding = screen.getByLabelText(UPLOAD.fundingLabel);

    await user.clear(funding);
    expect(funding).toHaveValue('');

    await user.click(screen.getByRole('button', { name: SUBMIT_LABEL }));
    await waitFor(() =>
      expect(onValid).toHaveBeenCalledWith(
        expect.objectContaining({ trendyolFundingPct: '0' }),
        expect.anything(),
      ),
    );
  });

  it('clears a seeded value kind and value when the kurgu changes', async () => {
    const { user } = renderHarness();
    expect(screen.getByLabelText(FIELDS.valueKind)).toHaveTextContent(FIELDS.valueKindPercent);

    await pick(user, UPLOAD.typeLabel, TYPES.CONDITIONAL_BASKET);

    const trigger = screen.getByLabelText(FIELDS.valueKind);
    expect(trigger).not.toHaveTextContent(FIELDS.valueKindPercent);
    expect(trigger).toHaveTextContent(FIELDS.valueKind);
    expect(screen.getByLabelText(FIELDS.value)).toHaveValue('');
  });

  it('carries an edited funding rate through a kurgu change into the submit', async () => {
    const { user, onValid } = renderHarness({ ...SEEDED, trendyolFundingPct: '60' });

    // Edit the seeded rate first: the funding field stays mounted across a kurgu change, so a
    // reset that dropped it would silently fall back to the mount-time "60" — only an EDITED
    // rate exposes that. The new value is typed over the selected old one.
    await user.type(screen.getByLabelText(UPLOAD.fundingLabel), '70', {
      initialSelectionStart: 0,
      initialSelectionEnd: 2,
    });
    expect(screen.getByLabelText(UPLOAD.fundingLabel)).toHaveValue('70');

    await pick(user, UPLOAD.typeLabel, TYPES.BUY_X_PAY_Y);
    expect(screen.getByLabelText(UPLOAD.fundingLabel)).toHaveValue('70');
    await pick(user, FIELDS.buyQuantity, '3');
    await pick(user, FIELDS.payQuantity, '2');
    await user.click(screen.getByRole('button', { name: SUBMIT_LABEL }));

    // BUY_X_PAY_Y rejects any leftover value kind / value (VALUE_NOT_ALLOWED), so a successful
    // submit also proves the NET parameters were wiped rather than merely hidden.
    await waitFor(() =>
      expect(onValid).toHaveBeenCalledWith(
        expect.objectContaining({
          discountType: 'BUY_X_PAY_Y',
          buyQuantity: '3',
          payQuantity: '2',
          trendyolFundingPct: '70',
        }),
        expect.anything(),
      ),
    );
  });
});

describe('<MarketplaceCampaignConfigFields> server issues', () => {
  it('shows the generic field sentence under the type picker for INVALID_DISCOUNT_TYPE', async () => {
    // Server only: the picker offers the campaign kurgu alone, so only a raw API call sends
    // another type.
    renderHarness(
      SEEDED,
      validationApiError([{ field: 'discountType', code: 'INVALID_DISCOUNT_TYPE' }]),
    );

    await waitFor(() =>
      expect(screen.getByLabelText(UPLOAD.typeLabel)).toHaveAccessibleDescription(
        FIELD_ERRORS.generic,
      ),
    );
  });
});
