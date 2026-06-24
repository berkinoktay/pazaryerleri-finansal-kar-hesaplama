import { createSubApp } from '../../lib/create-hono-app';

import getRoute from './get.route';
import listRoute from './list.route';
import summaryRoute from './summary.route';

const app = createSubApp<{ Variables: { userId: string } }>();

app.route('/', listRoute);
// summary before get: '/orders/summary' must not be captured by '/orders/{orderId}'.
app.route('/', summaryRoute);
app.route('/', getRoute);

export default app;
