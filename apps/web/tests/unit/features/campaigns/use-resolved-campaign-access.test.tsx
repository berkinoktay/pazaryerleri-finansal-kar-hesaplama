import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MemberRole, Platform } from '@pazarsync/db/enums';
import { CAPABILITIES, can, WORKBOOK_PAGES } from '@pazarsync/utils';

import { useResolvedCampaignAccess } from '@/features/campaigns/hooks/use-resolved-campaign-access';
import { UPLOAD_GATES } from '@/features/campaigns/lib/campaign-access';

import { TestScope } from '../../../helpers/current-scope';
import { AllProviders, renderHook } from '../../../helpers/render';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/active-store-actions', () => ({ setActiveStoreIdAction: vi.fn() }));
vi.mock('@/lib/active-org-actions', () => ({ setActiveOrgIdAction: vi.fn() }));

const PAGE = WORKBOOK_PAGES.COMMISSION_TARIFF;

function renderAccess(role: MemberRole, platform: Platform) {
  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <AllProviders>
        <TestScope role={role} platform={platform}>
          {children}
        </TestScope>
      </AllProviders>
    );
  }
  return renderHook(() => useResolvedCampaignAccess(PAGE), { wrapper: Wrapper });
}

describe('useResolvedCampaignAccess', () => {
  it.each(Object.values(MemberRole))('derives canWrite from DATA_WRITE for %s', (role) => {
    const { result } = renderAccess(role, Platform.TRENDYOL);
    expect(result.current.canWrite).toBe(can(role, CAPABILITIES.DATA_WRITE));
  });

  it('hides the upload for a VIEWER on HEPSIBURADA', () => {
    const { result } = renderAccess(MemberRole.VIEWER, Platform.HEPSIBURADA);
    expect(result.current).toEqual({ canWrite: false, upload: UPLOAD_GATES.HIDDEN });
  });

  it('marks the upload unsupported for an OWNER on HEPSIBURADA', () => {
    const { result } = renderAccess(MemberRole.OWNER, Platform.HEPSIBURADA);
    expect(result.current).toEqual({ canWrite: true, upload: UPLOAD_GATES.UNSUPPORTED_PLATFORM });
  });

  it('enables the upload for an OWNER on TRENDYOL', () => {
    const { result } = renderAccess(MemberRole.OWNER, Platform.TRENDYOL);
    expect(result.current).toEqual({ canWrite: true, upload: UPLOAD_GATES.ENABLED });
  });

  it('keeps the returned object identical across re-renders', () => {
    const { result, rerender } = renderAccess(MemberRole.OWNER, Platform.TRENDYOL);
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
