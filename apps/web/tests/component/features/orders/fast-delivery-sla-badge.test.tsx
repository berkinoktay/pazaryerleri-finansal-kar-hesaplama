import { describe, expect, it } from 'vitest';

import { FastDeliverySlaBadge } from '@/features/orders/components/fast-delivery-sla-badge';

import trMessages from '../../../../messages/tr.json';
import { render, screen } from '../../../helpers/render';

const sla = trMessages.ordersPage.table.sla;

describe('FastDeliverySlaBadge', () => {
  it('renders nothing for a non-fast-delivery order', () => {
    const { container } = render(
      <FastDeliverySlaBadge fastDelivery={false} deliveredOnTime={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the on-time (advantage kept) badge', () => {
    render(<FastDeliverySlaBadge fastDelivery deliveredOnTime={true} />);
    expect(screen.getByText(sla.onTime.label)).toBeInTheDocument();
  });

  it('shows the late (advantage lost) badge', () => {
    render(<FastDeliverySlaBadge fastDelivery deliveredOnTime={false} />);
    expect(screen.getByText(sla.late.label)).toBeInTheDocument();
  });

  it('shows the pending badge before delivery is known', () => {
    render(<FastDeliverySlaBadge fastDelivery deliveredOnTime={null} />);
    expect(screen.getByText(sla.pending.label)).toBeInTheDocument();
  });
});
