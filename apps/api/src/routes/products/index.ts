import { createSubApp } from '../../lib/create-hono-app';

import missingCostStatsRoute from './missing-cost-stats.route';

const app = createSubApp<{ Variables: { userId: string } }>();

app.route('/', missingCostStatsRoute);

export default app;
