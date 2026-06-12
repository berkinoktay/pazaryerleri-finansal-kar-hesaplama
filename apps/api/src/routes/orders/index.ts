import { createSubApp } from '../../lib/create-hono-app';

import getRoute from './get.route';
import listRoute from './list.route';

const app = createSubApp<{ Variables: { userId: string } }>();

app.route('/', listRoute);
app.route('/', getRoute);

export default app;
