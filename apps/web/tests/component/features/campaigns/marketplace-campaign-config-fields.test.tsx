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
import { render, screen, waitFor } from '../../../helpers/render';

const UPLOAD = trMessages.marketplaceCampaignsPage.upload;
const FIELDS = trMessages.discountsPage.upload.fields;
const TYPES = trMessages.discountsPage.types;
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
}: {
  defaultValues: CampaignConfigFormInput;
  onValid: (values: CampaignConfigFormValues) => void;
}): React.ReactElement {
  const form = useForm<CampaignConfigFormInput, unknown, CampaignConfigFormValues>({
    resolver: zodResolver(campaignConfigFormSchema),
    defaultValues,
  });
  const [name, setName] = React.useState('');
  return (
    <Form {...form}>
      <form noValidate onSubmit={form.handleSubmit(onValid)}>
        <MarketplaceCampaignConfigFields form={form} nameValue={name} onNameChange={setName} />
        <button type="submit">{SUBMIT_LABEL}</button>
      </form>
    </Form>
  );
}

function renderHarness(defaultValues: CampaignConfigFormInput = SEEDED) {
  const onValid = vi.fn<(values: CampaignConfigFormValues) => void>();
  const result = render(<Harness defaultValues={defaultValues} onValid={onValid} />);
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
    // rate exposes that. The new value is typed over the selected old one, never via an empty
    // field (emptying a seeded field is its own known issue, tracked for the edit dialog).
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
