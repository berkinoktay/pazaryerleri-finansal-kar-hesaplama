import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app';

// Uses the same app factory as the runtime entry, so route registrations
// stay in exactly one place. Importing `src/app.ts` is side-effect free;
// `src/index.ts` would trigger `serve()` and is deliberately avoided.
const app = createApp();

const spec = app.getOpenAPI31Document({
  openapi: '3.1.0',
  info: {
    title: 'PazarSync API',
    version: '1.0.0',
    description: 'Internal REST API.',
  },
  servers: [
    { url: 'http://localhost:3001', description: 'Local dev' },
    { url: 'https://staging-api.pazarsync.com', description: 'Staging' },
  ],
  security: [{ bearerAuth: [] }],
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '../../../packages/api-client/openapi.json');

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(spec, null, 2) + '\n', 'utf-8');

console.log(`\u2713 Wrote OpenAPI 3.1 spec to ${outPath}`);
