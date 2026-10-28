import { describe, expect, it, vi } from 'vitest';

import { MissingCostWarningBanner } from '@/features/products/components/missing-cost-warning-banner';

import trMessages from '../../../../messages/tr.json';
import { http, HttpResponse, server } from '../../../helpers/msw';
import { render, screen } from '../../../helpers/render';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const STORE_ID = '00000000-0000-0000-0000-0000000000a1';
const OTHER_STORE_ID = '00000000-0000-0000-0000-0000000000b2';
const STATS_URL = `http://localhost:3001/v1/organizations/${ORG_ID}/products/missing-cost-stats`;

// Copy comes from the real catalog so this file stays ASCII.
const banner = trMessages.products.missingCostBanner;

function expectedTitle(products: number, variants: number): string {
  return banner.title
    .replace('{products}', String(products))
    .replace('{variants}', String(variants));
}

interface StoreStats {
  storeId: string;
  missingCount: number;
  missingProductCount: number;
  totalVariants: number;
}

function mockStats(byStore: StoreStats[]): void {
  const sum = (pick: (entry: StoreStats) => number): number =>
    byStore.reduce((total, entry) => total + pick(entry), 0);
  server.use(
    http.get(STATS_URL, () =>
      HttpResponse.json({
        count: sum((entry) => entry.missingCount),
        missingProductCount: sum((entry) => entry.missingProductCount),
        totalVariants: sum((entry) => entry.totalVariants),
        byStore,
      }),
    ),
  );
}

function renderBanner(props: { orgId: string | null; storeId: string; onFilterClick: () => void }) {
  return render(<MissingCostWarningBanner {...props} />);
}

describe('MissingCostWarningBanner', () => {
  it('renders nothing when orgId is null', () => {
    const { container } = renderBanner({ orgId: null, storeId: STORE_ID, onFilterClick: vi.fn() });
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the active store has 0 missing (even if another store has missing)', async () => {
    // Active store clean; a SIBLING store has missing variants. The banner must
    // stay hidden: the org-wide count is non-zero but this store's is 0.
    mockStats([
      { storeId: STORE_ID, missingCount: 0, missingProductCount: 0, totalVariants: 100 },
      { storeId: OTHER_STORE_ID, missingCount: 9, missingProductCount: 4, totalVariants: 40 },
    ]);
    const { container } = renderBanner({
      orgId: ORG_ID,
      storeId: STORE_ID,
      onFilterClick: vi.fn(),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container.firstChild).toBeNull();
  });

  it("shows the active store's product and variant counts, never the org-wide sums", async () => {
    mockStats([
      { storeId: STORE_ID, missingCount: 7, missingProductCount: 3, totalVariants: 50 },
      { storeId: OTHER_STORE_ID, missingCount: 100, missingProductCount: 40, totalVariants: 200 },
    ]);
    renderBanner({ orgId: ORG_ID, storeId: STORE_ID, onFilterClick: vi.fn() });
    expect(await screen.findByText(expectedTitle(3, 7))).toBeInTheDocument();
    expect(screen.queryByText(expectedTitle(43, 107))).toBeNull();
    expect(screen.getByRole('button', { name: banner.cta })).toBeInTheDocument();
  });

  it('calls onFilterClick when the CTA button is clicked', async () => {
    const onFilterClick = vi.fn();
    mockStats([{ storeId: STORE_ID, missingCount: 3, missingProductCount: 2, totalVariants: 30 }]);
    const { user } = renderBanner({ orgId: ORG_ID, storeId: STORE_ID, onFilterClick });
    await user.click(await screen.findByRole('button', { name: banner.cta }));
    expect(onFilterClick).toHaveBeenCalledOnce();
  });
});
