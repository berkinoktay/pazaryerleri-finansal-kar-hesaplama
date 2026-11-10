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
  it('names the unrecognized carrier reported by the marketplace', () => {
    render(
      <ProfitIssueNotices issues={[issue('CARRIER_NOT_RECOGNIZED', 'Alternative Delivery')]} />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(copy.CARRIER_NOT_RECOGNIZED.title);
    expect(alert).toHaveTextContent('Alternative Delivery');
  });

  it('falls back to the unknown carrier label when the issue carries no detail', () => {
    render(<ProfitIssueNotices issues={[issue('CARRIER_NOT_RECOGNIZED')]} />);

    expect(screen.getByRole('alert')).toHaveTextContent(copy.unknownCarrier);
  });

  it('shows the seller cargo agreement notice', () => {
    render(<ProfitIssueNotices issues={[issue('SELLER_CARGO_AGREEMENT_ESTIMATE')]} />);

    expect(screen.getByRole('alert')).toHaveTextContent(copy.SELLER_CARGO_AGREEMENT_ESTIMATE.title);
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
