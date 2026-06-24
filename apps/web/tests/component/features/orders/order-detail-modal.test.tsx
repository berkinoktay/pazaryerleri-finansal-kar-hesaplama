import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { OrderDetailModal } from '@/features/orders/components/order-detail-modal';

import { HttpResponse, http, server } from '../../../helpers/msw';
import { render, screen } from '../../../helpers/render';

vi.mock('next/navigation', () => ({ useRouter: vi.fn(() => ({ push: vi.fn() })) }));

const ORG = '11111111-1111-1111-1111-111111111111';
const STORE = '22222222-2222-2222-2222-222222222222';
const API = 'http://localhost:3001';

const selection = {
  id: 'ord-1',
  title: 'TY-12345',
  orderDate: '2026-06-20T10:00:00.000Z',
};

describe('OrderDetailModal', () => {
  it('renders nothing when no order is selected', () => {
    const { container } = render(
      <OrderDetailModal orgId={ORG} storeId={STORE} order={null} onClose={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the order title in the header and fires onClose on dismiss', async () => {
    // The detail body fetch is out of scope here — a 404 keeps OrderDetailClient
    // in a defined state while the header title (from the selection prop) and the
    // close affordance, which this test targets, render regardless.
    server.use(
      http.get(`${API}/v1/organizations/${ORG}/stores/${STORE}/orders/ord-1`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Not Found', status: 404, code: 'NOT_FOUND' },
          { status: 404 },
        ),
      ),
    );
    const onClose = vi.fn();
    render(<OrderDetailModal orgId={ORG} storeId={STORE} order={selection} onClose={onClose} />);

    expect(await screen.findByText('TY-12345')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /kapat/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
