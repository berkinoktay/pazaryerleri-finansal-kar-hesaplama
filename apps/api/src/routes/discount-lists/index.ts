import { createSubApp } from '../../lib/create-hono-app';
import importRoute from './import.route';

const app = createSubApp<{ Variables: { userId: string } }>();

app.route('/', importRoute);

export default app;
