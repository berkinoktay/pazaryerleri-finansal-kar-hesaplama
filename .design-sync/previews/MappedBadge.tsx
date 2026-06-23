import { MappedBadge } from '@pazarsync/web';

const TONE = {
  DELIVERED: 'success',
  SHIPPED: 'info',
  PENDING: 'warning',
  CANCELLED: 'destructive',
  RETURNED: 'neutral',
} as const;

const LABEL = {
  DELIVERED: 'Teslim Edildi',
  SHIPPED: 'Kargoda',
  PENDING: 'Beklemede',
  CANCELLED: 'İptal',
  RETURNED: 'İade',
};

export const OrderStatuses = () => (
  <div className="gap-xs flex flex-wrap items-center">
    <MappedBadge value="DELIVERED" toneMap={TONE} labelMap={LABEL} />
    <MappedBadge value="SHIPPED" toneMap={TONE} labelMap={LABEL} />
    <MappedBadge value="PENDING" toneMap={TONE} labelMap={LABEL} />
    <MappedBadge value="CANCELLED" toneMap={TONE} labelMap={LABEL} />
    <MappedBadge value="RETURNED" toneMap={TONE} labelMap={LABEL} />
  </div>
);

export const WithOverflow = () => (
  <MappedBadge value="DELIVERED" toneMap={TONE} labelMap={LABEL} overflowCount={3} />
);
