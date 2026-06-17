import { describe, expect, it } from 'vitest';

import { PromotionIndicator } from '@/components/patterns/promotion-indicator';

import trMessages from '../../messages/tr.json';
import { render, screen, within } from '../helpers/render';

const LABEL = trMessages.promotionIndicator.label;
const TITLE = trMessages.promotionIndicator.title;

describe('PromotionIndicator', () => {
  it('renders nothing when there are no promotions', () => {
    const { container } = render(<PromotionIndicator promotions={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an empty promotion array', () => {
    const { container } = render(<PromotionIndicator promotions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the badge label when promotions are present', () => {
    render(
      <PromotionIndicator
        promotions={[{ displayName: 'Sepette %10 İndirim', amountGross: '20.00' }]}
      />,
    );
    expect(screen.getByText(LABEL)).toBeInTheDocument();
  });

  it('reveals the served promotion names + amounts in a tooltip on hover', async () => {
    const { user } = render(
      <PromotionIndicator
        promotions={[
          { displayName: 'Sepette %10 İndirim', amountGross: '20.00' },
          { displayName: 'Kupon İndirimi', amountGross: '15.00' },
        ]}
      />,
    );

    await user.hover(screen.getByText(LABEL));

    // Radix copies tooltip content into an accessible role="tooltip" node; the
    // visible portal node carries the names. Assert on the tooltip subtree so a
    // duplicated trigger label never satisfies the promotion-name assertion.
    const tooltip = await screen.findByRole('tooltip');
    const scoped = within(tooltip);
    expect(scoped.getByText(TITLE)).toBeInTheDocument();
    expect(scoped.getByText('Sepette %10 İndirim')).toBeInTheDocument();
    expect(scoped.getByText('Kupon İndirimi')).toBeInTheDocument();
  });
});
