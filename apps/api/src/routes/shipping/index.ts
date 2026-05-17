import { createSubApp } from '../../lib/create-hono-app';

import getConfig from './get-config.route';
import listCarriers from './list-carriers.route';
import listOwnTariff from './list-own-tariff.route';
import patchConfig from './patch-config.route';

const app = createSubApp<{ Variables: { userId: string } }>();

app.route('/', listCarriers);
app.route('/', getConfig);
app.route('/', patchConfig);
app.route('/', listOwnTariff);

export default app;
