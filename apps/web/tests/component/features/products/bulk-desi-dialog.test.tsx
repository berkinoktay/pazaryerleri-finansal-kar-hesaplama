import { delay } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { BulkDesiDialog } from '@/features/products/components/bulk-desi-dialog';

import trMessages from '../../../../messages/tr.json';
import { http, HttpResponse, server } from '../../../helpers/msw';
import { render, screen, waitFor } from '../../../helpers/render';

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

// Turkish copy comes from the catalog so this file stays ASCII.
const bulkDesi = trMessages.products.bulkDesi;
const withCount = (template: string, count: number): string =>
  template.replace('{count}', String(count));

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const STORE_ID = '00000000-0000-0000-0000-000000000002';
const VARIANT_IDS = [
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a2',
];
const BULK_URL = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/products/variants/dimensional-weight`;

function captureBulkPatches(): unknown[] {
  const bodies: unknown[] = [];
  server.use(
    http.patch(BULK_URL, async ({ request }) => {
      const body: unknown = await request.json();
      bodies.push(body);
      return HttpResponse.json({ updated: VARIANT_IDS.length });
    }),
  );
  return bodies;
}

function renderDialog() {
  const onOpenChange = vi.fn();
  const onClearSelection = vi.fn();
  const result = render(
    <BulkDesiDialog
      open
      onOpenChange={onOpenChange}
      orgId={ORG_ID}
      storeId={STORE_ID}
      variantIds={VARIANT_IDS}
      onClearSelection={onClearSelection}
    />,
  );
  return { ...result, onOpenChange, onClearSelection };
}

const applyButtonName = withCount(bulkDesi.apply, VARIANT_IDS.length);

describe('BulkDesiDialog', () => {
  // The parent keeps the dialog mounted and opens it through `open`, so the
  // typed value and an inline error must not survive a close.
  it('starts empty again when reopened after a cancelled attempt', async () => {
    const props = {
      onOpenChange: vi.fn(),
      orgId: ORG_ID,
      storeId: STORE_ID,
      variantIds: VARIANT_IDS,
      onClearSelection: vi.fn(),
    };
    const { user, rerender } = render(<BulkDesiDialog open {...props} />);

    await user.type(screen.getByLabelText(bulkDesi.fieldLabel), '1.500');
    await user.click(screen.getByRole('button', { name: applyButtonName }));
    expect(screen.getByText(bulkDesi.errors.INVALID_DIMENSIONAL_WEIGHT_FORMAT)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: bulkDesi.cancel }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    rerender(<BulkDesiDialog open={false} {...props} />);
    rerender(<BulkDesiDialog open {...props} />);

    expect(screen.getByLabelText(bulkDesi.fieldLabel)).toHaveValue('');
    expect(screen.queryByText(bulkDesi.errors.INVALID_DIMENSIONAL_WEIGHT_FORMAT)).toBeNull();
  });

  // The mutation lives in the always-mounted dialog host, so dismissing the
  // dialog while the save is in flight still ends with the toast and the
  // cleared selection.
  it('still toasts and clears the selection when dismissed while the save is pending', async () => {
    toastSuccess.mockReset();
    server.use(
      http.patch(BULK_URL, async () => {
        await delay(50);
        return HttpResponse.json({ updated: VARIANT_IDS.length });
      }),
    );
    const props = {
      onOpenChange: vi.fn(),
      orgId: ORG_ID,
      storeId: STORE_ID,
      variantIds: VARIANT_IDS,
      onClearSelection: vi.fn(),
    };
    const { user, rerender } = render(<BulkDesiDialog open {...props} />);

    await user.type(screen.getByLabelText(bulkDesi.fieldLabel), '2,5');
    await user.click(screen.getByRole('button', { name: applyButtonName }));
    await user.keyboard('{Escape}');
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    rerender(<BulkDesiDialog open={false} {...props} />);

    await waitFor(() => expect(props.onClearSelection).toHaveBeenCalledTimes(1));
    expect(toastSuccess).toHaveBeenCalledWith(
      withCount(bulkDesi.toast.applied, VARIANT_IDS.length).replace('{value}', '2,5'),
    );
  });

  it('sends "2,5" as the dot string "2.5", toasts the Turkish value and closes', async () => {
    toastSuccess.mockReset();
    const bodies = captureBulkPatches();
    const { user, onOpenChange, onClearSelection } = renderDialog();

    await user.type(screen.getByLabelText(bulkDesi.fieldLabel), '2,5');
    await user.click(screen.getByRole('button', { name: applyButtonName }));

    await waitFor(() =>
      expect(bodies).toEqual([{ variantIds: VARIANT_IDS, dimensionalWeight: '2.5' }]),
    );
    await waitFor(() => expect(onClearSelection).toHaveBeenCalledTimes(1));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toastSuccess).toHaveBeenCalledWith(
      withCount(bulkDesi.toast.applied, VARIANT_IDS.length).replace('{value}', '2,5'),
    );
  });

  it.each([
    ['', 'INVALID_DIMENSIONAL_WEIGHT_FORMAT'],
    ['abc', 'INVALID_DIMENSIONAL_WEIGHT_FORMAT'],
    ['2,555', 'INVALID_DIMENSIONAL_WEIGHT_FORMAT'],
    ['-1', 'INVALID_DIMENSIONAL_WEIGHT_TOO_SMALL'],
    ['1000', 'INVALID_DIMENSIONAL_WEIGHT_TOO_LARGE'],
  ] as const)('shows the error for %j and sends no request', async (raw, code) => {
    const bodies = captureBulkPatches();
    const { user, onClearSelection } = renderDialog();

    if (raw !== '') await user.type(screen.getByLabelText(bulkDesi.fieldLabel), raw);
    await user.click(screen.getByRole('button', { name: applyButtonName }));

    expect(await screen.findByText(bulkDesi.errors[code])).toBeInTheDocument();
    expect(bodies).toEqual([]);
    expect(onClearSelection).not.toHaveBeenCalled();
  });

  it('clears every selected override with null', async () => {
    toastSuccess.mockReset();
    const bodies = captureBulkPatches();
    const { user } = renderDialog();

    await user.click(screen.getByRole('button', { name: bulkDesi.clearAll }));

    await waitFor(() =>
      expect(bodies).toEqual([{ variantIds: VARIANT_IDS, dimensionalWeight: null }]),
    );
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        withCount(bulkDesi.toast.cleared, VARIANT_IDS.length),
      ),
    );
  });
});
