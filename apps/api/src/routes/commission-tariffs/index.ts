import { createSubApp } from '../../lib/create-hono-app';
import deleteRoute from './delete.route';
import detailRoute from './detail.route';
import listRoute from './list.route';

const app = createSubApp<{ Variables: { userId: string } }>();

app.route('/', listRoute);
app.route('/', detailRoute);
app.route('/', deleteRoute);

export default app;
