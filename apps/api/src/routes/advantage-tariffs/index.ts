import { createSubApp } from '../../lib/create-hono-app';
import commissionSourceRoute from './commission-source.route';
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
app.route('/', exportRoute);
app.route('/', selectionsRoute);
app.route('/', commissionSourceRoute);
app.route('/', estimateRoute);
app.route('/', detailRoute);
app.route('/', deleteRoute);

export default app;
