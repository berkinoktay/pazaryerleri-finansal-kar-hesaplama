import { createSubApp } from '../../lib/create-hono-app';

import getRoute from './get.route';
import listRoute from './list.route';
import setItemCostRoute from './set-item-cost.route';

const app = createSubApp<{ Variables: { userId: string } }>();

app.route('/', listRoute);
app.route('/', getRoute);
app.route('/', setItemCostRoute);

export default app;
