import { createSubApp } from '../../lib/create-hono-app';
import {
  createWorkbookExportRoute,
  createWorkbookImportRoute,
} from '../../workbooks/route-factory';
import { discountListAdapter } from '../../workbooks/verticals/discount-list.adapter';
import deleteRoute from './delete.route';
import detailRoute from './detail.route';
import estimateRoute from './estimate.route';
import listRoute from './list.route';
import selectionsRoute from './selections.route';
import updateRoute from './update.route';

const app = createSubApp<{ Variables: { userId: string } }>();

app.route('/', listRoute);
// The generic workbook import, in the slot the legacy import route held.
app.route('/', createWorkbookImportRoute(discountListAdapter));
app.route('/', selectionsRoute);
app.route('/', updateRoute);
app.route('/', estimateRoute);
// The generic workbook export, in the slot the legacy export route held.
app.route('/', createWorkbookExportRoute(discountListAdapter));
app.route('/', detailRoute);
app.route('/', deleteRoute);

export default app;
