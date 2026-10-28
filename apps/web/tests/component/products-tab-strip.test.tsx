import { describe, expect, it, vi } from 'vitest';

import { ProductsTabStrip } from '@/features/products/components/products-tab-strip';

import trMessages from '../../messages/tr.json';
import { render, screen } from '../helpers/render';

// Tab labels come from the real catalog so this file stays ASCII.
const tabs = trMessages.products.overrideTabs;

// Accessible tab names are "<label><count>"; match on the label prefix.
function named(label: string): (accessibleName: string) => boolean {
  return (accessibleName) => accessibleName.startsWith(label);
}

describe('ProductsTabStrip', () => {
  it('renders only the all and missing-cost tabs, each with its formatted count', () => {
    render(
      <ProductsTabStrip
        value="all"
        counts={{ missingCost: 117, total: 118 }}
        onChange={() => {}}
      />,
    );
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: named(tabs.all) })).toHaveTextContent('118');
    expect(screen.getByRole('tab', { name: named(tabs.missingCost) })).toHaveTextContent('117');
  });

  it('calls onChange with cost when the missing-cost tab is clicked', async () => {
    const onChange = vi.fn();
    const { user } = render(
      <ProductsTabStrip
        value="all"
        counts={{ missingCost: 117, total: 118 }}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('tab', { name: named(tabs.missingCost) }));
    expect(onChange).toHaveBeenCalledWith('cost');
  });

  it('renders both tabs without counts while the facets load', () => {
    render(<ProductsTabStrip value="all" loading onChange={() => {}} />);
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });
});
