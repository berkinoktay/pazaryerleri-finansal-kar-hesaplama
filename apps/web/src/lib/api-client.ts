import { createApiClient, type paths } from '@pazarsync/api-client';

const baseUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

export const apiClient = createApiClient<paths>({ baseUrl });
