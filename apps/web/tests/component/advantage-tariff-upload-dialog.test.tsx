import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The dialog's "upload a commission tariff" CTAs use next-intl's localized <Link>, which
// pulls in `next/navigation` — unresolvable under happy-dom. Stub it with a plain anchor
// so the component renders (mirrors user-menu.test.tsx / app-shell.test.tsx).
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { AdvantageTariffUploadDialog } from '@/features/campaigns/components/advantage-tariff-upload-dialog';

import trMessages from '../../messages/tr.json';
import { HttpResponse, http, server } from '../helpers/msw';
import { render, screen, waitFor } from '../helpers/render';

const UPLOAD = trMessages.productLabelsPage.upload;
const SOURCE = UPLOAD.commissionSource;
const ORG = '00000000-0000-0000-0000-0000000000aa';
const STORE = '00000000-0000-0000-0000-0000000000bb';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const COMMISSION_LIST =
  'http://localhost:3001/v1/organizations/:orgId/stores/:storeId/commission-tariffs';

function makeXlsxFile(name = 'avantajli.xlsx'): File {
  return new File(['pk'], name, { type: XLSX_TYPE });
}

/** The dropzone's hidden `<input type="file">` (sr-only, no label). */
function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('file input not found');
  return input;
}

/** Mocks the store's commission-tariff list (the picker's data source). */
function mockCommissionList(data: readonly unknown[]): void {
  server.use(http.get(COMMISSION_LIST, () => HttpResponse.json({ data })));
}

function tariff(
  id: string,
  weekStartsAt: string,
  weekEndsAt: string,
  validity: 'active' | 'upcoming' | 'past',
): Record<string, unknown> {
  return {
    id,
    name: `tarife-${id}`,
    productCount: 10,
    selectedCount: 0,
    exported: false,
    validity,
    weekStartsAt,
    weekEndsAt,
    updatedAt: '2026-07-01T00:00:00Z',
  };
}

function renderDialog(onFile = vi.fn()) {
  return render(
    <AdvantageTariffUploadDialog
      open
      orgId={ORG}
      storeId={STORE}
      onFile={onFile}
      onOpenChange={vi.fn()}
    />,
  );
}

describe('<AdvantageTariffUploadDialog>', () => {
  beforeEach(() => {
    // Default: no commission tariffs. Individual tests override with a populated list.
    mockCommissionList([]);
  });

  it('renders WITHOUT a re-render loop when the store has no commission tariffs (regression)', async () => {
    // Before the derived-default fix, an empty list made `pickDefault` return
    // undefined and a render-phase setState never converged → "Too many re-renders".
    renderDialog();

    // It rendered: the empty-source guidance is shown and submit stays disabled
    // until the seller makes a conscious choice.
    expect(await screen.findByText(SOURCE.empty)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: UPLOAD.submit })).toBeDisabled();
  });

  it('default-pins the nearest-upcoming week and submits it once a file is chosen', async () => {
    mockCommissionList([
      tariff('t-active', '2026-07-01T05:00:00Z', '2026-07-08T04:59:00Z', 'active'),
      tariff('t-next', '2026-07-08T05:00:00Z', '2026-07-15T04:59:00Z', 'upcoming'),
    ]);
    const onFile = vi.fn();
    const { user } = renderDialog(onFile);

    const submit = screen.getByRole('button', { name: UPLOAD.submit });
    expect(submit).toBeDisabled(); // no file yet

    await user.upload(fileInput(), makeXlsxFile());
    // Enabled only once the list resolves AND the default pin is seeded.
    await waitFor(() => expect(submit).toBeEnabled());

    await user.click(submit);
    expect(onFile).toHaveBeenCalledTimes(1);
    // The nearest-upcoming week (t-next) is the default pin.
    expect(onFile.mock.calls[0]?.[1]).toBe('t-next');
  });

  it('lets the seller choose the category fallback (no pinned tariff → undefined)', async () => {
    mockCommissionList([
      tariff('t-active', '2026-07-01T05:00:00Z', '2026-07-08T04:59:00Z', 'active'),
    ]);
    const onFile = vi.fn();
    const { user } = renderDialog(onFile);

    await user.upload(fileInput(), makeXlsxFile());
    await user.click(await screen.findByText(SOURCE.categoryOption));
    await user.click(screen.getByRole('button', { name: UPLOAD.submit }));

    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0]?.[1]).toBeUndefined();
  });
});
