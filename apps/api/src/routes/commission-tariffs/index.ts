import { createSubApp } from '../../lib/create-hono-app';
import deleteRoute from './delete.route';
import detailRoute from './detail.route';
import importRoute from './import.route';
import listRoute from './list.route';
import selectionsRoute from './selections.route';

const app = createSubApp<{ Variables: { userId: string } }>();

app.route('/', listRoute);
app.route('/', importRoute);
app.route('/', selectionsRoute);
app.route('/', detailRoute);
app.route('/', deleteRoute);

export default app;
