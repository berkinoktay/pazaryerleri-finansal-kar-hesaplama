import { DataTable, Currency, Badge } from '@pazarsync/web';

const COLUMNS = [
  { accessorKey: 'order', header: 'Sipariş' },
  { accessorKey: 'store', header: 'Mağaza' },
  {
    accessorKey: 'status',
    header: 'Durum',
    cell: ({ row }) => <Badge tone={row.original.tone}>{row.original.status}</Badge>,
  },
  {
    accessorKey: 'profit',
    header: 'Net Kâr',
    cell: ({ row }) => <Currency value={row.original.profit} />,
  },
];

const DATA = [
  {
    order: '11321228951',
    store: 'Trendyol',
    status: 'Teslim Edildi',
    tone: 'success',
    profit: 142.5,
  },
  { order: '11320655788', store: 'Trendyol', status: 'Kargoda', tone: 'info', profit: 89.9 },
  {
    order: '11319033045',
    store: 'Hepsiburada',
    status: 'İptal',
    tone: 'destructive',
    profit: -12.4,
  },
  {
    order: '11318774512',
    store: 'Trendyol',
    status: 'Teslim Edildi',
    tone: 'success',
    profit: 56.2,
  },
  { order: '11317901233', store: 'Hepsiburada', status: 'Beklemede', tone: 'warning', profit: 0 },
];

export const Orders = () => (
  <div className="w-full">
    <DataTable columns={COLUMNS} data={DATA} enableRowSelection />
  </div>
);
