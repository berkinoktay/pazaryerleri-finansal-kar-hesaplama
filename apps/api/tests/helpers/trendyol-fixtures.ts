/**
 * Shared Trendyol wire fixtures for tests that mock `globalThis.fetch`.
 *
 * `approvedProductsResponse` is the REAL approved-products page shape (the one
 * the catalog sync + single-barcode eager repair both map). Lives in apps/api
 * helpers because sync-worker tests already import from here (the reverse
 * direction is not allowed).
 *
 * Consumers: apps/sync-worker variant-resolution tests, apps/api webhook
 * buffer-rule tests (eager catalog repair — spec 2026-06-12 PR-2).
 */

export function approvedProductsResponse(barcode: string, count: number): unknown {
  return {
    totalElements: count,
    totalPages: 1,
    page: 0,
    size: 100,
    nextPageToken: null,
    content: Array.from({ length: count }, (_, i) => ({
      contentId: 700_000 + i,
      productMainId: `pmid-${barcode}`,
      brand: { id: 1, name: 'Brand' },
      category: { id: 1, name: 'Category' },
      creationDate: 1777246115403,
      lastModifiedDate: 1777246115403,
      title: 'Vendor Product',
      description: 'desc',
      images: [{ url: 'https://cdn.example.com/x.jpg' }],
      attributes: [],
      variants: [
        {
          variantId: 7_000_000 + i,
          supplierId: 2738,
          barcode,
          attributes: [],
          onSale: true,
          deliveryOptions: { deliveryDuration: 1, isRushDelivery: false, fastDeliveryOptions: [] },
          stock: { quantity: 5, lastModifiedDate: 0 },
          price: { salePrice: 100, listPrice: 120 },
          stockCode: `sk-${barcode}`,
          vatRate: 20,
          locked: false,
          archived: false,
          blacklisted: false,
        },
      ],
    })),
  };
}

export function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
