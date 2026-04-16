import { z } from "@hono/zod-openapi";

export const OrganizationSchema = z
  .object({
    id: z.string().uuid().openapi({ example: "00000000-0000-0000-0000-000000000000" }),
    name: z.string().openapi({ example: "Akyıldız Store" }),
    slug: z.string().openapi({ example: "akyildiz-store" }),
    createdAt: z.string().datetime().openapi({ example: "2026-01-15T10:30:00Z" }),
    updatedAt: z.string().datetime().openapi({ example: "2026-04-01T14:00:00Z" }),
  })
  .openapi("Organization", {
    description: "An organization (tenant). Users can be members of multiple organizations.",
  });

export const OrganizationListResponseSchema = z
  .object({
    data: z.array(OrganizationSchema),
  })
  .openapi("OrganizationListResponse");

export type Organization = z.infer<typeof OrganizationSchema>;
export type OrganizationListResponse = z.infer<typeof OrganizationListResponseSchema>;
