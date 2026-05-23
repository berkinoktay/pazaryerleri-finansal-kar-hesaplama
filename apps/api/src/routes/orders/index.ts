import { createSubApp } from '../../lib/create-hono-app';

import getRoute from './get.route';
import listRoute from './list.route';
import startSyncRoute from './start-sync.route';

const app = createSubApp<{ Variables: { userId: string } }>();

app.route('/', listRoute);
app.route('/', getRoute);
app.route('/', startSyncRoute);

export default app;
