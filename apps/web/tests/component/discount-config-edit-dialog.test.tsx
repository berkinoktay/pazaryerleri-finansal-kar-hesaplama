import { describe, expect, it, vi } from 'vitest';

import { UPLOAD_NAME_MAX_LENGTH } from '@pazarsync/utils';

import type { DiscountListDetail } from '@/features/campaigns/api/get-discount-list-detail.api';
import { DiscountConfigEditDialog } from '@/features/campaigns/components/discount-config-edit-dialog';
import type { ApiError } from '@/lib/api-error';

import trMessages from '../../messages/tr.json';
import { validationApiError } from '../helpers/api-error';
import { HttpResponse, http, server } from '../helpers/msw';
import { render, screen, waitFor, within } from '../helpers/render';

const UPLOAD = trMessages.discountsPage.upload;
const FIELDS = UPLOAD.fields;
const TYPES = trMessages.discountsPage.types;
const SHARED = trMessages.campaignUpload;
const SAVE_LABEL = trMessages.common.save;
const NAME_TOO_LONG = SHARED.errors.nameTooLong.replace('{max}', String(UPLOAD_NAME_MAX_LENGTH));
// One code point outside the Basic Multilingual Plane: two UTF-16 units, one character.
const ASTRAL = '\u{1F600}';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const LIST_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/discount-lists/${LIST_ID}`;

// A name stored before the name rule: `trim()` drops the leading U+FEFF but keeps the trailing
// U+200D, so only a comparison of the untrimmed input sees it as untouched.
const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff);
const ZERO_WIDTH_JOINER = String.fromCodePoint(0x200d);
const STORED_INVISIBLE_NAME = `${BYTE_ORDER_MARK}Liste${ZERO_WIDTH_JOINER}`;

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

/** A saved NTH_PRODUCT list — seeds the fixed 2..4 target Select with a chosen nth index. */
function makeNthList(): DiscountListDetail {
  return { ...makeList(), discountType: 'NTH_PRODUCT', value: '15', nthIndex: 3 };
}

/** A saved list the form can submit as is: the edit form refuses to save without a window. */
function makeSavableList(overrides: Partial<DiscountListDetail> = {}): DiscountListDetail {
  return {
    ...makeList(),
    startsAt: '2026-08-01T07:00:00.000Z',
    endsAt: '2026-08-07T20:59:00.000Z',
    ...overrides,
  };
}

function renderDialog(list: DiscountListDetail = makeList()) {
  const onOpenChange = vi.fn<(open: boolean) => void>();
  const result = render(
    <DiscountConfigEditDialog
      open
      onOpenChange={onOpenChange}
      orgId={ORG_ID}
      storeId={STORE_ID}
      listId={LIST_ID}
      list={list}
    />,
  );
  return { ...result, onOpenChange };
}

/**
 * Serves the PATCH (a success, or the problem of `failWith`) and records every JSON body it
 * receives.
 */
function capturePatch(failWith?: ApiError): unknown[] {
  const bodies: unknown[] = [];
  server.use(
    http.patch(ENDPOINT, async ({ request }) => {
      bodies.push(await request.json());
      return failWith === undefined
        ? HttpResponse.json({ id: LIST_ID })
        : HttpResponse.json(failWith.problem, { status: failWith.status });
    }),
  );
  return bodies;
}

/** The one body the PATCH received, as an object. */
async function sentBody(bodies: unknown[]): Promise<Record<string, unknown>> {
  await waitFor(() => expect(bodies).toHaveLength(1));
  const body = bodies[0];
  if (typeof body !== 'object' || body === null) throw new Error('expected a JSON object body');
  return { ...body };
}

/** The name input's own block (label, input and its message line). */
function nameField(): HTMLElement {
  const block = screen.getByLabelText(UPLOAD.name).parentElement;
  if (block === null) throw new Error('name field block not found');
  return block;
}

describe('<DiscountConfigEditDialog>', () => {
  it('seeds the saved config into the form (value kind + value visible)', () => {
    renderDialog();

    expect(screen.getByLabelText(FIELDS.valueKind)).toHaveTextContent(FIELDS.valueKindPercent);
    expect(screen.getByLabelText(FIELDS.value)).toHaveValue('20');
  });

  it('lets the seller clear the seeded value and type a new one (no snap-back to "20")', async () => {
    const { user } = renderDialog();
    const value = screen.getByLabelText(FIELDS.value);

    // The shipped bug: an emptied seeded field fell back to its mount-time default, so clearing
    // "20" and typing "35" read "2035".
    await user.clear(value);
    expect(value).toHaveValue('');
    await user.type(value, '35');
    expect(value).toHaveValue('35');
  });

  it('seeds the saved nth target into its fixed Select and offers only 2..4', async () => {
    const { user } = renderDialog(makeNthList());

    // The seeded target renders on the Select trigger — proving the number → string seed survives
    // the RHF + Radix controlled-Select round-trip (the Select value stays the string '3').
    const nthSelect = screen.getByLabelText(FIELDS.nthIndex);
    expect(nthSelect).toHaveTextContent('3');

    await user.click(nthSelect);
    for (const n of ['2', '3', '4']) {
      expect(await screen.findByRole('option', { name: n })).toBeInTheDocument();
    }
    expect(screen.queryByRole('option', { name: '1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '5' })).not.toBeInTheDocument();
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

  it('sends no name when the seller did not touch it', async () => {
    const bodies = capturePatch();
    const { user, onOpenChange } = renderDialog(makeSavableList());

    await user.click(screen.getByRole('button', { name: SAVE_LABEL }));

    const body = await sentBody(bodies);
    expect('name' in body).toBe(false);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('sends no name for an untouched stored name holding invisible characters', async () => {
    const bodies = capturePatch();
    const { user } = renderDialog(makeSavableList({ name: STORED_INVISIBLE_NAME }));

    await user.click(screen.getByRole('button', { name: SAVE_LABEL }));

    const body = await sentBody(bodies);
    expect('name' in body).toBe(false);
  });

  it('sends a typed new name trimmed', async () => {
    const bodies = capturePatch();
    const { user } = renderDialog(makeSavableList());

    const input = screen.getByLabelText(UPLOAD.name);
    await user.clear(input);
    await user.type(input, '  New name  ');
    await user.click(screen.getByRole('button', { name: SAVE_LABEL }));

    const body = await sentBody(bodies);
    expect(body['name']).toBe('New name');
  });

  it('shows the too long sentence for a changed name over the limit and sends no PATCH', async () => {
    const bodies = capturePatch();
    const { user, onOpenChange } = renderDialog(makeSavableList());

    const input = screen.getByLabelText(UPLOAD.name);
    await user.clear(input);
    await user.paste(ASTRAL.repeat(UPLOAD_NAME_MAX_LENGTH + 1));
    expect(within(nameField()).getByRole('alert')).toHaveTextContent(NAME_TOO_LONG);
    await user.click(screen.getByRole('button', { name: SAVE_LABEL }));

    // A name at the limit saves: the PATCH then carries that name as its one and only body.
    await user.clear(input);
    await user.paste(ASTRAL.repeat(UPLOAD_NAME_MAX_LENGTH));
    expect(within(nameField()).queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: SAVE_LABEL }));

    const body = await sentBody(bodies);
    expect(body['name']).toBe(ASTRAL.repeat(UPLOAD_NAME_MAX_LENGTH));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('shows no length error for an untouched stored name over the limit, and saves', async () => {
    // A name stored before the limit: it is never resent unchanged, so it never blocks a save.
    const LONG_STORED_NAME = ASTRAL.repeat(UPLOAD_NAME_MAX_LENGTH + 1);
    const bodies = capturePatch();
    const { user } = renderDialog(makeSavableList({ name: LONG_STORED_NAME }));

    expect(within(nameField()).queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: SAVE_LABEL }));

    const body = await sentBody(bodies);
    expect('name' in body).toBe(false);
  });

  it('sends no name when the seller clears it', async () => {
    const bodies = capturePatch();
    const { user } = renderDialog(makeSavableList());

    await user.clear(screen.getByLabelText(UPLOAD.name));
    await user.click(screen.getByRole('button', { name: SAVE_LABEL }));

    const body = await sentBody(bodies);
    expect('name' in body).toBe(false);
  });

  it('shows a NAME_INVALID_CHARACTERS refusal under the name input and stays open', async () => {
    capturePatch(validationApiError([{ field: 'name', code: 'NAME_INVALID_CHARACTERS' }]));
    const { user, onOpenChange } = renderDialog(makeSavableList());

    const input = screen.getByLabelText(UPLOAD.name);
    await user.clear(input);
    await user.type(input, 'New name');
    await user.click(screen.getByRole('button', { name: SAVE_LABEL }));

    expect(
      await within(nameField()).findByText(SHARED.errors.nameInvalidCharacters),
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('shows a NAME_REQUIRED refusal under the name input and stays open', async () => {
    capturePatch(validationApiError([{ field: 'name', code: 'NAME_REQUIRED' }]));
    const { user, onOpenChange } = renderDialog(makeSavableList());

    const input = screen.getByLabelText(UPLOAD.name);
    await user.clear(input);
    await user.type(input, 'New name');
    await user.click(screen.getByRole('button', { name: SAVE_LABEL }));

    expect(await within(nameField()).findByText(SHARED.errors.nameRequired)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('shows the field sentence once for a 422 on fields the form has no input for', async () => {
    capturePatch(
      validationApiError([
        { field: 'other', code: 'SOME_FUTURE_FIELD_CODE' },
        { field: 'another', code: 'ANOTHER_FUTURE_FIELD_CODE' },
      ]),
    );
    const { user, onOpenChange } = renderDialog(makeSavableList());

    await user.click(screen.getByRole('button', { name: SAVE_LABEL }));

    expect(await screen.findAllByText(SHARED.errors.field)).toHaveLength(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
