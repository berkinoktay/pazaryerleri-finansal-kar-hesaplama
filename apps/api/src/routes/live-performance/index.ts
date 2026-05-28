import { createSubApp } from '../../lib/create-hono-app';

import chartRoute from './chart.route';
import kpisRoute from './kpis.route';
import missingCostRoute from './missing-cost.route';
import ordersRoute from './orders.route';
import topProductsRoute from './top-products.route';

const app = createSubApp<{ Variables: { userId: string } }>();

app.route('/', kpisRoute);
app.route('/', chartRoute);
app.route('/', missingCostRoute);
app.route('/', topProductsRoute);
app.route('/', ordersRoute);

export default app;
