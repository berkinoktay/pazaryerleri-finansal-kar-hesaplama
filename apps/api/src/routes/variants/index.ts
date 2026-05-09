import { createSubApp } from '../../lib/create-hono-app';

import variantCostProfilesRoute from './cost-profiles.route';

const app = createSubApp<{ Variables: { userId: string } }>();

app.route('/', variantCostProfilesRoute);

export default app;
