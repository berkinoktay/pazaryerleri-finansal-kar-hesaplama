import { describe, expect, it } from 'vitest';

import { NavGroup } from '@/components/patterns/nav-group';
import { render, screen } from '@/../tests/helpers/render';

describe('NavGroup', () => {
  it('default-collapses the body so sub-items are not visible', () => {
    render(
      <NavGroup label="Karlılık Analizi" icon="📈">
        <button>Sipariş Karlılığı</button>
        <button>Ürün Karlılığı</button>
      </NavGroup>,
    );
    const header = screen.getByRole('button', { name: /karlılık analizi/i });
    // The header reflects the collapsed state via aria-expanded.  Sub-items
    // ARE in the DOM (they sit inside the collapsed grid row + overflow:hidden
    // wrapper), so we don't query for absence — `aria-expanded='false'` is
    // the canonical assertion.  jest-dom's `toBeVisible` does NOT detect
    // overflow-hidden clipping in happy-dom, so we don't lean on it here.
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Sipariş Karlılığı')).toBeInTheDocument();
  });

  it('expands when the header is clicked', async () => {
    const { user } = render(
      <NavGroup label="Karlılık Analizi" icon="📈">
        <button>Sipariş Karlılığı</button>
      </NavGroup>,
    );
    const header = screen.getByRole('button', { name: /karlılık analizi/i });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    await user.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Sipariş Karlılığı')).toBeVisible();
  });

  it('honors defaultExpanded prop and renders body visible from first paint', () => {
    render(
      <NavGroup label="Karlılık Analizi" icon="📈" defaultExpanded>
        <button>Sipariş Karlılığı</button>
      </NavGroup>,
    );
    const header = screen.getByRole('button', { name: /karlılık analizi/i });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Sipariş Karlılığı')).toBeVisible();
  });

  it('renders the optional inline badge', () => {
    render(
      <NavGroup label="Karlılık Analizi" icon="📈" badge={{ variant: 'beta', label: 'Beta' }}>
        <button>Sipariş Karlılığı</button>
      </NavGroup>,
    );
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });
});
