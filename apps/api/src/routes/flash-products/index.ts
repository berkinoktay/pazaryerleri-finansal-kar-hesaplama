import { createSubApp } from '../../lib/create-hono-app';
import {
  createWorkbookExportRoute,
  createWorkbookImportRoute,
} from '../../workbooks/route-factory';
import { flashProductListAdapter } from '../../workbooks/verticals/flash-product-list.adapter';
import deleteRoute from './delete.route';
import detailRoute from './detail.route';
import estimateRoute from './estimate.route';
import listRoute from './list.route';
import selectionsRoute from './selections.route';

const app = createSubApp<{ Variables: { userId: string } }>();

app.route('/', listRoute);
// The generic workbook import, in the slot the legacy import route held.
app.route('/', createWorkbookImportRoute(flashProductListAdapter));
app.route('/', selectionsRoute);
app.route('/', estimateRoute);
// The generic workbook export, in the slot the legacy export route held.
app.route('/', createWorkbookExportRoute(flashProductListAdapter));
app.route('/', detailRoute);
app.route('/', deleteRoute);

export default app;
