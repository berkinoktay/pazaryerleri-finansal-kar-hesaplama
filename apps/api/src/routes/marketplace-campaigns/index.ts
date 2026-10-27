// Kampanyalar sub-app — the single place app.ts sees.

import { createSubApp } from '../../lib/create-hono-app';
import deleteRoute from './delete.route';
import detailRoute from './detail.route';
import estimateRoute from './estimate.route';
import exportRoute from './export.route';
import importRoute from './import.route';
import listRoute from './list.route';
import selectionsRoute from './selections.route';
import targetMarginRoute from './target-margin.route';
import updateRoute from './update.route';

const app = createSubApp<{ Variables: { userId: string } }>();

app.route('/', listRoute);
app.route('/', importRoute);
app.route('/', selectionsRoute);
app.route('/', updateRoute);
app.route('/', estimateRoute);
app.route('/', targetMarginRoute);
app.route('/', detailRoute);
app.route('/', deleteRoute);
app.route('/', exportRoute);

export default app;
