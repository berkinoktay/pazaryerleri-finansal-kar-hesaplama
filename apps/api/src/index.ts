import { serve } from '@hono/node-server';

import { createApp } from './app';
import { validateRequiredEnv } from './lib/env';

// Fail fast if the deployment is missing JWT_SECRET, DATABASE_URL, or
// ENCRYPTION_KEY. Better to crash on boot than serve 401/500 responses
// until ops notices. Only runs for the real runtime entry; tests and
// the OpenAPI dump import `createApp` directly and skip this gate.
validateRequiredEnv();

const app = createApp();
const port = Number(process.env['PORT']) || 3001;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`PazarSync API listening on http://localhost:${info.port}`);
});
