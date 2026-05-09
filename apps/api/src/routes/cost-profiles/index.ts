import { createSubApp } from '../../lib/create-hono-app';

import archiveRoute from './archive.route';
import attachedVariantsRoute from './attached-variants.route';
import createRoute from './create.route';
import getRoute from './get.route';
import listRoute from './list.route';
import restoreRoute from './restore.route';
import versionsRoute from './versions.route';
import updateRoute from './update.route';

const app = createSubApp<{ Variables: { userId: string } }>();

app.route('/', listRoute);
app.route('/', createRoute);
app.route('/', getRoute);
app.route('/', updateRoute);
app.route('/', archiveRoute);
app.route('/', restoreRoute);
app.route('/', versionsRoute);
app.route('/', attachedVariantsRoute);

export default app;
