/**
 * Supabase JWT Bearer token. Documented in the OpenAPI spec under
 * `components.securitySchemes.bearerAuth`. Applied via `security: [{ bearerAuth: [] }]`
 * on each authenticated route.
 */
export const bearerAuthScheme = {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: 'Supabase JWT token issued by `/v1/auth/signin`',
} as const;
