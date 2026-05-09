import { createSubApp } from '../../lib/create-hono-app';

import attachRoute from './attach.route';
import detachRoute from './detach.route';
import replaceRoute from './replace.route';

const app = createSubApp<{ Variables: { userId: string } }>();

app.route('/', attachRoute);
app.route('/', detachRoute);
app.route('/', replaceRoute);

export default app;
