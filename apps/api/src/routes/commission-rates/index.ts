import { createSubApp } from '../../lib/create-hono-app';
import listRoute from './list.route';

const app = createSubApp<{ Variables: { userId: string } }>();

app.route('/', listRoute);

export default app;
