import { createSubApp } from '../../lib/create-hono-app';
import {
  createWorkbookExportRoute,
  createWorkbookImportRoute,
} from '../../workbooks/route-factory';
import { plusCommissionTariffAdapter } from '../../workbooks/verticals/plus-commission-tariff.adapter';
import deleteRoute from './delete.route';
import detailRoute from './detail.route';
import estimateRoute from './estimate.route';
import listRoute from './list.route';
import selectionsRoute from './selections.route';

const app = createSubApp<{ Variables: { userId: string } }>();

app.route('/', listRoute);
// The generic workbook import, in the slot the legacy import route held.
app.route('/', createWorkbookImportRoute(plusCommissionTariffAdapter));
// The generic workbook export, in the slot the legacy export route held.
app.route('/', createWorkbookExportRoute(plusCommissionTariffAdapter));
app.route('/', selectionsRoute);
app.route('/', estimateRoute);
app.route('/', detailRoute);
app.route('/', deleteRoute);

export default app;
