import { createSubApp } from '../../lib/create-hono-app';
import listRoutes from './list.routes';
import quoteRoutes from './quote.routes';

const app = createSubApp<{ Variables: { userId: string } }>();

app.route('/', listRoutes);
app.route('/', quoteRoutes);

export default app;
