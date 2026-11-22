import { describe, expect, it } from 'vitest';

import {
  ProfitIssueNotices,
  type ProfitIssueWire,
} from '@/features/orders/components/profit-issue-notices';

import trMessages from '../../messages/tr.json';
import { render, screen } from '../helpers/render';

// Turkish copy referenced through the catalog so this source file stays ASCII.
const copy = trMessages.orderDetail.profitIssues;

function issue(code: ProfitIssueWire['code'], detail: string | null = null): ProfitIssueWire {
  return { code, orderItemId: null, detail };
}

describe('ProfitIssueNotices', () => {
  it('shows the seller cargo agreement notice', () => {
    render(<ProfitIssueNotices issues={[issue('SELLER_CARGO_AGREEMENT_ESTIMATE')]} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(copy.SELLER_CARGO_AGREEMENT_ESTIMATE.title);
    expect(alert).toHaveTextContent(copy.SELLER_CARGO_AGREEMENT_ESTIMATE.description);
  });

  it('renders nothing for an unrecognized carrier: it blocks the profit and the blocker alert names it', () => {
    const { container } = render(
      <ProfitIssueNotices issues={[issue('CARRIER_NOT_RECOGNIZED', 'Alternative Delivery')]} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for issue codes that are not notices', () => {
    const { container } = render(
      <ProfitIssueNotices issues={[issue('UNMAPPED_MARKETPLACE_RECORD', 'record-1')]} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when there are no issues', () => {
    const { container } = render(<ProfitIssueNotices issues={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
