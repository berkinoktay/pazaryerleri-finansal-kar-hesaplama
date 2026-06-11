import { createSubApp } from '../../lib/create-hono-app';

import listRoute from './list.route';
import summaryRoute from './summary.route';

const app = createSubApp<{ Variables: { userId: string } }>();

app.route('/', summaryRoute);
app.route('/', listRoute);

export default app;
