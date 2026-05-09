import { createSubApp } from '../../lib/create-hono-app';

import latestRoute from './latest.route';

const app = createSubApp<{ Variables: { userId: string } }>();

app.route('/', latestRoute);

export default app;
