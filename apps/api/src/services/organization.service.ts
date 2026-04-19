import { prisma } from '@pazarsync/db';

export interface OrganizationListItem {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Return every organization where `userId` has an OrganizationMember row.
 * Ordered by name ASC for stable, human-friendly output.
 */
export async function listForUser(userId: string): Promise<OrganizationListItem[]> {
  const memberships = await prisma.organizationMember.findMany({
    where: { userId },
    include: { organization: true },
    orderBy: { organization: { name: 'asc' } },
  });

  return memberships.map(({ organization: o }) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  }));
}
