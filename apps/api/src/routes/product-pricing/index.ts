import { createSubApp } from '../../lib/create-hono-app';
import listRoutes from './list.routes';

const app = createSubApp<{ Variables: { userId: string } }>();

app.route('/', listRoutes);

export default app;
