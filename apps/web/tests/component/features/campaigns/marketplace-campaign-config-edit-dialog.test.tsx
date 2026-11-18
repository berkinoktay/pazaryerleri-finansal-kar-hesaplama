import { describe, expect, it, vi } from 'vitest';

import { UPLOAD_NAME_MAX_LENGTH } from '@pazarsync/utils';

import { MarketplaceCampaignConfigEditDialog } from '@/features/campaigns/components/marketplace-campaign-config-edit-dialog';
import type { MarketplaceCampaignHeader } from '@/features/campaigns/lib/adapt-marketplace-campaign';
import type { ApiError } from '@/lib/api-error';

import trMessages from '../../../../messages/tr.json';
import { validationApiError } from '../../../helpers/api-error';
import { HttpResponse, http, server } from '../../../helpers/msw';
import { render, screen, waitFor, within } from '../../../helpers/render';

const UPLOAD = trMessages.marketplaceCampaignsPage.upload;
const FIELDS = trMessages.discountsPage.upload.fields;
const SAVE_LABEL = trMessages.common.save;
const SHARED = trMessages.campaignUpload;
const NAME_TOO_LONG = SHARED.errors.nameTooLong.replace('{max}', String(UPLOAD_NAME_MAX_LENGTH));
// One code point outside the Basic Multilingual Plane: two UTF-16 units, one character.
const ASTRAL = '\u{1F600}';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const CAMPAIGN_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/marketplace-campaigns/${CAMPAIGN_ID}`;

// A name stored before the name rule: `trim()` drops the leading U+FEFF but keeps the trailing
// U+200D, so only a comparison of the untrimmed input sees it as untouched.
const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff);
const ZERO_WIDTH_JOINER = String.fromCodePoint(0x200d);
const STORED_INVISIBLE_NAME = `${BYTE_ORDER_MARK}Liste${ZERO_WIDTH_JOINER}`;

/** A saved NET + percent campaign Trendyol funds 60 % of, with its window. */
function makeHeader(overrides: Partial<MarketplaceCampaignHeader> = {}): MarketplaceCampaignHeader {
  return {
    id: CAMPAIGN_ID,
    name: 'Ağustos Kampanyası',
    discountType: 'NET',
    valueKind: 'PERCENT',
    value: '20.00',
    minBasketAmount: null,
    minQuantity: null,
    buyQuantity: null,
    payQuantity: null,
    nthIndex: null,
    trendyolFundingPct: '60.00',
    startsAt: '2026-08-01T07:00:00.000Z',
    endsAt: '2026-08-07T20:59:00.000Z',
    exported: false,
    commissionTariffName: null,
    commissionPeriodLabel: null,
    commissionTariffOutdated: false,
    scenarioPresentation: 'UNIT',
    ...overrides,
  };
}

function renderDialog(header: MarketplaceCampaignHeader = makeHeader()) {
  const onOpenChange = vi.fn<(open: boolean) => void>();
  const result = render(
    <MarketplaceCampaignConfigEditDialog
      open
      onOpenChange={onOpenChange}
      orgId={ORG_ID}
      storeId={STORE_ID}
      campaignId={CAMPAIGN_ID}
      header={header}
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
        ? HttpResponse.json({ id: CAMPAIGN_ID })
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

describe('<MarketplaceCampaignConfigEditDialog>', () => {
  it('seeds the saved kurgu, value and funding rate', () => {
    renderDialog();

    expect(screen.getByLabelText(FIELDS.valueKind)).toHaveTextContent(FIELDS.valueKindPercent);
    expect(screen.getByLabelText(FIELDS.value)).toHaveValue('20.00');
    expect(screen.getByLabelText(UPLOAD.fundingLabel)).toHaveValue('60.00');
    expect(screen.getByLabelText(UPLOAD.name)).toHaveValue('Ağustos Kampanyası');
  });

  it('a cleared funding rate is saved as an explicit "0" inside the FULL config, then closes', async () => {
    let received: Record<string, unknown> | null = null;
    server.use(
      http.patch(ENDPOINT, async ({ request }) => {
        const body: unknown = await request.json();
        received = typeof body === 'object' && body !== null ? { ...body } : null;
        return HttpResponse.json({ id: CAMPAIGN_ID });
      }),
    );
    const { user, onOpenChange } = renderDialog();

    // The PATCH replaces the whole config, so an emptied rate must still travel — as "0".
    await user.clear(screen.getByLabelText(UPLOAD.fundingLabel));
    await user.click(screen.getByRole('button', { name: SAVE_LABEL }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(received).toEqual({
      discountType: 'NET',
      valueKind: 'PERCENT',
      value: '20.00',
      trendyolFundingPct: '0',
      startsAt: '2026-08-01T07:00:00.000Z',
      endsAt: '2026-08-07T20:59:00.000Z',
    });
    // The save did not touch the name, so the body carries none.
    expect(received).not.toHaveProperty('name');
  });

  it('sends no name when the seller did not touch it', async () => {
    const bodies = capturePatch();
    const { user, onOpenChange } = renderDialog();

    await user.click(screen.getByRole('button', { name: SAVE_LABEL }));

    const body = await sentBody(bodies);
    expect('name' in body).toBe(false);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('sends no name for an untouched stored name holding invisible characters', async () => {
    const bodies = capturePatch();
    const { user } = renderDialog(makeHeader({ name: STORED_INVISIBLE_NAME }));

    await user.click(screen.getByRole('button', { name: SAVE_LABEL }));

    const body = await sentBody(bodies);
    expect('name' in body).toBe(false);
  });

  it('sends a typed new name trimmed', async () => {
    const bodies = capturePatch();
    const { user } = renderDialog();

    const input = screen.getByLabelText(UPLOAD.name);
    await user.clear(input);
    await user.type(input, '  New name  ');
    await user.click(screen.getByRole('button', { name: SAVE_LABEL }));

    const body = await sentBody(bodies);
    expect(body['name']).toBe('New name');
  });

  it('shows the too long sentence for a changed name over the limit and sends no PATCH', async () => {
    const bodies = capturePatch();
    const { user, onOpenChange } = renderDialog();

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
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledTimes(1));
  });

  it('shows no length error for an untouched stored name over the limit, and saves', async () => {
    // A name stored before the limit: it is never resent unchanged, so it never blocks a save.
    const LONG_STORED_NAME = ASTRAL.repeat(UPLOAD_NAME_MAX_LENGTH + 1);
    const bodies = capturePatch();
    const { user } = renderDialog(makeHeader({ name: LONG_STORED_NAME }));

    expect(within(nameField()).queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: SAVE_LABEL }));

    const body = await sentBody(bodies);
    expect('name' in body).toBe(false);
  });

  it('sends no name when the seller clears it', async () => {
    const bodies = capturePatch();
    const { user } = renderDialog();

    await user.clear(screen.getByLabelText(UPLOAD.name));
    await user.click(screen.getByRole('button', { name: SAVE_LABEL }));

    const body = await sentBody(bodies);
    expect('name' in body).toBe(false);
  });

  it('shows a NAME_INVALID_CHARACTERS refusal under the name input and stays open', async () => {
    capturePatch(validationApiError([{ field: 'name', code: 'NAME_INVALID_CHARACTERS' }]));
    const { user, onOpenChange } = renderDialog();

    const input = screen.getByLabelText(UPLOAD.name);
    await user.clear(input);
    await user.type(input, 'New name');
    await user.click(screen.getByRole('button', { name: SAVE_LABEL }));

    expect(
      await within(nameField()).findByText(SHARED.errors.nameInvalidCharacters),
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('shows the too long sentence over an earlier name refusal, and sends nothing', async () => {
    const bodies = capturePatch(
      validationApiError([{ field: 'name', code: 'NAME_INVALID_CHARACTERS' }]),
    );
    const { user } = renderDialog();

    const input = screen.getByLabelText(UPLOAD.name);
    await user.clear(input);
    await user.type(input, 'New name');
    await user.click(screen.getByRole('button', { name: SAVE_LABEL }));
    expect(
      await within(nameField()).findByText(SHARED.errors.nameInvalidCharacters),
    ).toBeInTheDocument();

    // The refusal is about the name already sent; the new name cannot be sent for its length,
    // so that is the reason the field shows, and saving sends nothing.
    await user.clear(input);
    await user.paste(ASTRAL.repeat(UPLOAD_NAME_MAX_LENGTH + 1));
    expect(within(nameField()).getByRole('alert')).toHaveTextContent(NAME_TOO_LONG);
    await user.click(screen.getByRole('button', { name: SAVE_LABEL }));
    expect(bodies).toHaveLength(1);
  });

  it('shows the field sentence once for a 422 on fields the form has no input for', async () => {
    capturePatch(
      validationApiError([
        { field: 'other', code: 'SOME_FUTURE_FIELD_CODE' },
        { field: 'another', code: 'ANOTHER_FUTURE_FIELD_CODE' },
      ]),
    );
    const { user, onOpenChange } = renderDialog();

    await user.click(screen.getByRole('button', { name: SAVE_LABEL }));

    expect(await screen.findAllByText(SHARED.errors.field)).toHaveLength(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
