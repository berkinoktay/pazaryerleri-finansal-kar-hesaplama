import { z } from '@hono/zod-openapi';

export const MeResponseSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '00000000-0000-0000-0000-000000000000' }),
    email: z.string().email().openapi({ example: 'seller@example.com' }),
    timezone: z.string().openapi({ example: 'Europe/Istanbul' }),
    preferredLanguage: z.string().openapi({ example: 'tr' }),
    createdAt: z.string().datetime().openapi({ example: '2026-04-20T10:30:00Z' }),
    updatedAt: z.string().datetime().openapi({ example: '2026-04-20T10:30:00Z' }),
  })
  .openapi('MeResponse', {
    description:
      'The authenticated user’s own profile. Returns timezone + preferred language so ' +
      'the frontend can format timestamps in the viewer’s locale and preselect UI language. ' +
      'Never 404s for an authenticated user — the profile row is auto-created by trigger on ' +
      'signup, and GET /v1/me upserts it defensively if the trigger missed.',
  });

export type MeResponse = z.infer<typeof MeResponseSchema>;
