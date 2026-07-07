import { createSubApp } from '../../lib/create-hono-app';
import deleteRoute from './delete.route';
import detailRoute from './detail.route';
import estimateRoute from './estimate.route';
import exportRoute from './export.route';
import importRoute from './import.route';
import listRoute from './list.route';
import selectionsRoute from './selections.route';

const app = createSubApp<{ Variables: { userId: string } }>();

app.route('/', listRoute);
app.route('/', importRoute);
app.route('/', selectionsRoute);
app.route('/', estimateRoute);
app.route('/', exportRoute);
app.route('/', detailRoute);
app.route('/', deleteRoute);

export default app;
