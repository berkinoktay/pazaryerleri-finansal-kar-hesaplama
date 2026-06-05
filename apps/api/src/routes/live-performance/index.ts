import { createSubApp } from '../../lib/create-hono-app';

import bufferDetailRoute from './buffer-detail.route';
import chartRoute from './chart.route';
import kpisRoute from './kpis.route';
import notificationSummaryRoute from './notification-summary.route';
import ordersRoute from './orders.route';
import todayProductsRoute from './today-products.route';

const app = createSubApp<{ Variables: { userId: string } }>();

app.route('/', kpisRoute);
app.route('/', chartRoute);
app.route('/', todayProductsRoute);
app.route('/', ordersRoute);
app.route('/', bufferDetailRoute);
app.route('/', notificationSummaryRoute);

export default app;
