import { createSubApp } from '../../lib/create-hono-app';

import chartRoute from './chart.route';
import kpisRoute from './kpis.route';
import ordersRoute from './orders.route';
import todayProductsRoute from './today-products.route';

const app = createSubApp<{ Variables: { userId: string } }>();

app.route('/', kpisRoute);
app.route('/', chartRoute);
app.route('/', todayProductsRoute);
app.route('/', ordersRoute);

export default app;
