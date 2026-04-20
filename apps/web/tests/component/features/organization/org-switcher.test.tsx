import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import { OrgSwitcher } from '@/features/organization/components/org-switcher';
import type { Organization } from '@/features/organization/api/organizations.api';
import trMessages from '../../../../messages/tr.json';

import { render, screen } from '../../../helpers/render';

const setActiveOrgIdMock = vi.fn<(orgId: string) => Promise<void>>(async () => undefined);
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

vi.mock('@/lib/active-org-actions', () => ({
  setActiveOrgIdAction: (...args: [string]) => setActiveOrgIdMock(...args),
}));

const ORGS: Organization[] = [
  {
    id: 'org-1',
    name: 'Akyıldız Ticaret',
    slug: 'akyildiz-ticaret',
    currency: 'TRY',
    timezone: 'Europe/Istanbul',
    createdAt: '2026-04-20T10:00:00Z',
    updatedAt: '2026-04-20T10:00:00Z',
  },
  {
    id: 'org-2',
    name: 'Beta Company',
    slug: 'beta-company',
    currency: 'TRY',
    timezone: 'Europe/Istanbul',
    createdAt: '2026-04-20T11:00:00Z',
    updatedAt: '2026-04-20T11:00:00Z',
  },
];

function renderSwitcher(activeOrgId = 'org-1') {
  return render(
    <NextIntlClientProvider messages={trMessages} locale="tr">
      <OrgSwitcher orgs={ORGS} activeOrgId={activeOrgId} />
    </NextIntlClientProvider>,
  );
}

describe('OrgSwitcher', () => {
  it('renders the active org as the trigger label', () => {
    renderSwitcher('org-1');
    expect(screen.getByRole('button', { name: /organizasyonu değiştir/i })).toBeInTheDocument();
    expect(screen.getAllByText(/Akyıldız Ticaret/i).length).toBeGreaterThan(0);
  });

  it('opens the popover and lists both orgs', async () => {
    const { user } = renderSwitcher('org-1');
    await user.click(screen.getByRole('button', { name: /organizasyonu değiştir/i }));

    // Open popover reveals both org names in the command list.
    expect(await screen.findByText('Beta Company')).toBeInTheDocument();
    expect(screen.getByText(/yeni organizasyon oluştur/i)).toBeInTheDocument();
  });

  it('triggers setActiveOrgIdAction + refresh when another org is selected', async () => {
    const { user } = renderSwitcher('org-1');
    await user.click(screen.getByRole('button', { name: /organizasyonu değiştir/i }));
    await user.click(await screen.findByText('Beta Company'));

    expect(setActiveOrgIdMock).toHaveBeenCalledWith('org-2');
    expect(refreshMock).toHaveBeenCalled();
  });
});
