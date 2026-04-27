// Read-side counterpart to ProductSyncService. Pure DB reads scoped to
// (orgId, storeId), with the four filters (q / status / brandId /
// categoryId) and 1-indexed offset pagination. Status filtering happens
// at the variant level so the parent's `variants[]` array is filtered
// to matching variants — but the parent itself is included whenever
// ≥1 of its variants matches.

import { prisma } from '@pazarsync/db';
import type { Prisma } from '@pazarsync/db';

import type {
  ListProductsQuery,
  ProductListSort,
  ProductVariantStatus,
} from '../validators/product.validator';
import {
  toProductWithVariantsResponse,
  type ListProductsResponseSchema,
  type ProductFacetsResponseSchema,
} from '../validators/product.validator';
import type { z } from '@hono/zod-openapi';

type ListResponse = z.infer<typeof ListProductsResponseSchema>;
type FacetsResponse = z.infer<typeof ProductFacetsResponseSchema>;

// ─── Where-clause builders ─────────────────────────────────────────────

function variantStatusWhere(status: ProductVariantStatus): Prisma.ProductVariantWhereInput {
  switch (status) {
    case 'onSale':
      return { onSale: true, archived: false, blacklisted: false, locked: false };
    case 'archived':
      return { archived: true };
    case 'locked':
      return { locked: true };
    case 'blacklisted':
      return { blacklisted: true };
  }
}

function buildSearchWhere(q: string): Prisma.ProductWhereInput {
  return {
    OR: [
      { title: { contains: q, mode: 'insensitive' } },
      { productMainId: { contains: q, mode: 'insensitive' } },
      { variants: { some: { barcode: { contains: q, mode: 'insensitive' } } } },
      { variants: { some: { stockCode: { contains: q, mode: 'insensitive' } } } },
    ],
  };
}

function buildOrderBy(sort: ProductListSort): Prisma.ProductOrderByWithRelationInput {
  switch (sort) {
    case '-platformModifiedAt':
      return { platformModifiedAt: 'desc' };
    case 'platformModifiedAt':
      return { platformModifiedAt: 'asc' };
    case 'title':
      return { title: 'asc' };
    case '-title':
      return { title: 'desc' };
  }
}

// ─── List ──────────────────────────────────────────────────────────────

export async function list(opts: {
  organizationId: string;
  storeId: string;
  filters: ListProductsQuery;
}): Promise<ListResponse> {
  const { organizationId, storeId, filters } = opts;

  const variantWhere =
    filters.status !== undefined ? variantStatusWhere(filters.status) : undefined;

  const productWhere: Prisma.ProductWhereInput = {
    organizationId,
    storeId,
    ...(filters.brandId !== undefined ? { brandId: filters.brandId } : {}),
    ...(filters.categoryId !== undefined ? { categoryId: filters.categoryId } : {}),
    ...(variantWhere !== undefined ? { variants: { some: variantWhere } } : {}),
    ...(filters.q !== undefined ? buildSearchWhere(filters.q) : {}),
  };

  const skip = (filters.page - 1) * filters.perPage;

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where: productWhere,
      include: {
        // Filter the variants[] in the response when status is set —
        // matches the contract documented on ListProductsQuerySchema.
        variants: variantWhere !== undefined ? { where: variantWhere } : true,
        images: true,
        _count: { select: { variants: true } },
      },
      orderBy: buildOrderBy(filters.sort),
      take: filters.perPage,
      skip,
    }),
    prisma.product.count({ where: productWhere }),
  ]);

  const totalPages = total === 0 ? 0 : Math.ceil(total / filters.perPage);

  return {
    data: products.map((product) =>
      toProductWithVariantsResponse(product, product._count.variants),
    ),
    pagination: {
      page: filters.page,
      perPage: filters.perPage,
      total,
      totalPages,
    },
  };
}

// ─── Facets ────────────────────────────────────────────────────────────

export async function facets(opts: {
  organizationId: string;
  storeId: string;
}): Promise<FacetsResponse> {
  const { organizationId, storeId } = opts;

  const [brandRows, categoryRows] = await Promise.all([
    prisma.product.groupBy({
      by: ['brandId', 'brandName'],
      where: { organizationId, storeId, brandId: { not: null }, brandName: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { brandId: 'desc' } },
    }),
    prisma.product.groupBy({
      by: ['categoryId', 'categoryName'],
      where: {
        organizationId,
        storeId,
        categoryId: { not: null },
        categoryName: { not: null },
      },
      _count: { _all: true },
      orderBy: { _count: { categoryId: 'desc' } },
    }),
  ]);

  return {
    brands: brandRows
      .filter(
        (r): r is typeof r & { brandId: bigint; brandName: string } =>
          r.brandId !== null && r.brandName !== null,
      )
      .map((r) => ({
        id: r.brandId.toString(),
        name: r.brandName,
        count: r._count._all,
      })),
    categories: categoryRows
      .filter(
        (r): r is typeof r & { categoryId: bigint; categoryName: string } =>
          r.categoryId !== null && r.categoryName !== null,
      )
      .map((r) => ({
        id: r.categoryId.toString(),
        name: r.categoryName,
        count: r._count._all,
      })),
  };
}
