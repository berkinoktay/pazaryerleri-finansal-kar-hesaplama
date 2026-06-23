import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Currency,
  Badge,
} from '@pazarsync/web';

export const OrdersTable = () => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Sipariş</TableHead>
        <TableHead>Durum</TableHead>
        <TableHead className="text-right">Net Kâr</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow>
        <TableCell className="tabular-nums">11321228951</TableCell>
        <TableCell>
          <Badge tone="success">Teslim Edildi</Badge>
        </TableCell>
        <TableCell className="text-right">
          <Currency value={142.5} />
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell className="tabular-nums">11320655788</TableCell>
        <TableCell>
          <Badge tone="info">Kargoda</Badge>
        </TableCell>
        <TableCell className="text-right">
          <Currency value={89.9} />
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell className="tabular-nums">11319033045</TableCell>
        <TableCell>
          <Badge tone="destructive">İptal</Badge>
        </TableCell>
        <TableCell className="text-right">
          <Currency value={-12.4} />
        </TableCell>
      </TableRow>
    </TableBody>
  </Table>
);
