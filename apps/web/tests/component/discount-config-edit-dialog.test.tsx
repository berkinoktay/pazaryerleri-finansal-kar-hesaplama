import { describe, expect, it, vi } from 'vitest';

import type { DiscountListDetail } from '@/features/campaigns/api/get-discount-list-detail.api';
import { DiscountConfigEditDialog } from '@/features/campaigns/components/discount-config-edit-dialog';

import trMessages from '../../messages/tr.json';
import { render, screen } from '../helpers/render';

const UPLOAD = trMessages.discountsPage.upload;
const FIELDS = UPLOAD.fields;
const TYPES = trMessages.discountsPage.types;

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const LIST_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

/** A saved NET + PERCENT list — the seeded defaults are the edit dialog's distinguishing trait. */
function makeList(): DiscountListDetail {
  return {
    id: LIST_ID,
    name: 'Temmuz İndirimleri',
    discountType: 'NET',
    valueKind: 'PERCENT',
    value: '20',
    minBasketAmount: null,
    minQuantity: null,
    buyQuantity: null,
    payQuantity: null,
    nthIndex: null,
    startsAt: null,
    endsAt: null,
    exported: false,
    commissionTariffName: null,
    commissionPeriodLabel: null,
    commissionTariffOutdated: false,
    scenarioPresentation: 'UNIT',
    items: [],
  };
}

function renderDialog() {
  return render(
    <DiscountConfigEditDialog
      open
      onOpenChange={vi.fn()}
      orgId={ORG_ID}
      storeId={STORE_ID}
      listId={LIST_ID}
      list={makeList()}
    />,
  );
}

describe('<DiscountConfigEditDialog>', () => {
  it('seeds the saved config into the form (value kind + value visible)', () => {
    renderDialog();

    expect(screen.getByLabelText(FIELDS.valueKind)).toHaveTextContent(FIELDS.valueKindPercent);
    expect(screen.getByLabelText(FIELDS.value)).toHaveValue('20');
  });

  it('clears the SEEDED value kind (display and state) when the discount type changes', async () => {
    const { user } = renderDialog();

    // Switch the kurgu away from the saved NET. The reset must clear the SEEDED defaults too —
    // form.setValue(field, undefined) silently falls back to the seeded defaultValue in RHF,
    // which is exactly the edit-dialog-only variant of the stale-selection bug.
    await user.click(screen.getByLabelText(UPLOAD.typeLabel));
    await user.click(await screen.findByRole('option', { name: TYPES.CONDITIONAL_BASKET }));

    const trigger = screen.getByLabelText(FIELDS.valueKind);
    expect(trigger).not.toHaveTextContent(FIELDS.valueKindPercent);
    // Positive contract: the cleared Select shows its placeholder, not a blank trigger.
    expect(trigger).toHaveTextContent(FIELDS.valueKind);
    // The seeded value input clears with it.
    expect(screen.getByLabelText(FIELDS.value)).toHaveValue('');

    // Reopening proves the old choice is no longer marked selected.
    await user.click(trigger);
    const percentOption = await screen.findByRole('option', { name: FIELDS.valueKindPercent });
    expect(percentOption).toHaveAttribute('aria-selected', 'false');
  });
});
