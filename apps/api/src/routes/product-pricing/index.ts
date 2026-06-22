import { createSubApp } from '../../lib/create-hono-app';
import listRoutes from './list.routes';
import quoteRoutes from './quote.routes';
import updatePriceRoutes from './update-price.routes';

const app = createSubApp<{ Variables: { userId: string } }>();

app.route('/', listRoutes);
app.route('/', quoteRoutes);
app.route('/', updatePriceRoutes);

export default app;
