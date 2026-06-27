import { createSubApp } from '../../lib/create-hono-app';

import getConfig from './get-config.route';
import patchConfig from './patch-config.route';

const app = createSubApp<{ Variables: { userId: string } }>();

app.route('/', getConfig);
app.route('/', patchConfig);

export default app;
