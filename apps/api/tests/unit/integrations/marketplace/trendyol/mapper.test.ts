import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  mapTrendyolApprovedResponse,
  mapTrendyolContent,
} from '../../../../../src/integrations/marketplace/trendyol/mapper';
import type {
  TrendyolApprovedProductsResponse,
  TrendyolContent,
} from '../../../../../src/integrations/marketplace/trendyol/types';

// First staging Postman sample provided by the user (April 2026):
// single-variant product "dfsf" with one Beden attribute on the variant
// and a duplicated Renk attribute on the content.
const STAGING_SAMPLE_DFSF: TrendyolContent = {
  contentId: 1122684425,
  productMainId: 'sdfsdfs',
  brand: { id: 2032, name: 'Modline' },
  category: { id: 2122, name: 'Dolap ve Gardrop' },
  creationDate: 1777246115403,
  lastModifiedDate: 1777246115403,
  lastModifiedBy: 'quakka@trendyol.com',
  title: 'dfsf',
  description: 'dfsdfd',
  images: [
    {
      url: 'https://cdn.dsmcdn.com/mediacenter-stage8/stage/QC_PREP/20260427/02/de9bebd6-e781-3d1d-9f76-10765a8c3b3c/1_org_zoom.jpg',
    },
  ],
  attributes: [
    { attributeId: 47, attributeName: 'Renk', attributeValue: 'Beyaz' },
    { attributeId: 295, attributeName: 'Renk', attributeValueId: 2882, attributeValue: 'Beyaz' },
  ],
  variants: [
    {
      variantId: 1565552107,
      supplierId: 2738,
      barcode: '1231231231',
      attributes: [
        {
          attributeId: 293,
          attributeName: 'Beden',
          attributeValueId: 18346,
          attributeValue: '210 cm',
        },
      ],
      productUrl:
        'https://stage.trendyol.com/abc/xyz-p-1122684425?&merchantId=2738&filterOverPriceListings=false',
      onSale: true,
      deliveryOptions: { deliveryDuration: null, isRushDelivery: false, fastDeliveryOptions: [] },
      stock: { quantity: 12312, lastModifiedDate: 0 },
      price: { salePrice: 131231, listPrice: 131231 },
      stockCode: '122',
      vatRate: 10,
      sellerCreatedDate: 1777246127000,
      sellerModifiedDate: 1777246131000,
      locked: false,
      lockReason: null,
      lockDate: null,
      archived: false,
      archivedDate: null,
      docNeeded: false,
      hasViolation: false,
      blacklisted: false,
      locationBasedDelivery: 'DISABLED',
    },
  ],
};

describe('mapTrendyolContent', () => {
  it('maps the dfsf staging sample end-to-end', () => {
    const out = mapTrendyolContent(STAGING_SAMPLE_DFSF);

    expect(out.platformContentId).toBe(BigInt(1122684425));
    expect(out.productMainId).toBe('sdfsdfs');
    expect(out.title).toBe('dfsf');
    expect(out.description).toBe('dfsdfd');
    expect(out.brandId).toBe(BigInt(2032));
    expect(out.brandName).toBe('Modline');
    expect(out.categoryId).toBe(BigInt(2122));
    expect(out.categoryName).toBe('Dolap ve Gardrop');
    expect(out.color).toBe('Beyaz');
    expect(out.images).toEqual([
      {
        url: 'https://cdn.dsmcdn.com/mediacenter-stage8/stage/QC_PREP/20260427/02/de9bebd6-e781-3d1d-9f76-10765a8c3b3c/1_org_zoom.jpg',
        position: 0,
      },
    ]);
    expect(out.platformCreatedAt).toEqual(new Date(1777246115403));
    expect(out.variants).toHaveLength(1);

    const variant = out.variants[0];
    expect(variant?.platformVariantId).toBe(BigInt(1565552107));
    expect(variant?.barcode).toBe('1231231231');
    expect(variant?.stockCode).toBe('122');
    expect(variant?.size).toBe('210 cm');
    expect(variant?.salePrice).toBe('131231.00');
    expect(variant?.listPrice).toBe('131231.00');
    expect(variant?.quantity).toBe(12312);
    expect(variant?.deliveryDuration).toBeNull();
    expect(variant?.isRushDelivery).toBe(false);
    expect(variant?.fastDeliveryOptions).toEqual([]);
    expect(variant?.productUrl).toContain('stage.trendyol.com');
    expect(variant?.locationBasedDelivery).toBe('DISABLED');
    expect(variant?.onSale).toBe(true);
    expect(variant?.archived).toBe(false);
    expect(variant?.blacklisted).toBe(false);
    expect(variant?.locked).toBe(false);
  });

  it('extracts color from the first Renk attribute even when duplicated', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = mapTrendyolContent(STAGING_SAMPLE_DFSF);
    expect(out.color).toBe('Beyaz');
    // both Renk attrs say "Beyaz" — no warn expected
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('warns on disagreeing duplicate Renk values but still picks the first', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = mapTrendyolContent({
      ...STAGING_SAMPLE_DFSF,
      attributes: [
        { attributeId: 47, attributeName: 'Renk', attributeValue: 'Beyaz' },
        { attributeId: 295, attributeName: 'Renk', attributeValueId: 2882, attributeValue: 'Mavi' },
      ],
    });
    expect(out.color).toBe('Beyaz');
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatch(/Renk attrs that disagree/);
    warn.mockRestore();
  });

  it('returns null color when no Renk attribute is present', () => {
    const out = mapTrendyolContent({ ...STAGING_SAMPLE_DFSF, attributes: [] });
    expect(out.color).toBeNull();
  });

  it('returns null size when no Beden attribute is present on the variant', () => {
    const variant = STAGING_SAMPLE_DFSF.variants[0];
    if (variant === undefined) throw new Error('fixture variant missing');
    const out = mapTrendyolContent({
      ...STAGING_SAMPLE_DFSF,
      variants: [{ ...variant, attributes: [] }],
    });
    expect(out.variants[0]?.size).toBeNull();
  });

  it('handles missing brand and category gracefully', () => {
    const out = mapTrendyolContent({
      ...STAGING_SAMPLE_DFSF,
      brand: undefined,
      category: undefined,
    });
    expect(out.brandId).toBeNull();
    expect(out.brandName).toBeNull();
    expect(out.categoryId).toBeNull();
    expect(out.categoryName).toBeNull();
  });

  it('formats prices to fixed two-decimal strings', () => {
    const variant = STAGING_SAMPLE_DFSF.variants[0];
    if (variant === undefined) throw new Error('fixture variant missing');
    const out = mapTrendyolContent({
      ...STAGING_SAMPLE_DFSF,
      variants: [{ ...variant, price: { salePrice: 49.5, listPrice: 60 } }],
    });
    expect(out.variants[0]?.salePrice).toBe('49.50');
    expect(out.variants[0]?.listPrice).toBe('60.00');
  });

  it('treats epoch 0 as null on date fields', () => {
    const out = mapTrendyolContent({
      ...STAGING_SAMPLE_DFSF,
      creationDate: 0,
      lastModifiedDate: 0,
    });
    expect(out.platformCreatedAt).toBeNull();
    expect(out.platformModifiedAt).toBeNull();
  });
});

describe('mapTrendyolApprovedResponse', () => {
  it('forwards the page meta and maps content[]', () => {
    const wire: TrendyolApprovedProductsResponse = {
      totalElements: 137,
      totalPages: 2,
      page: 0,
      size: 100,
      nextPageToken: null,
      content: [STAGING_SAMPLE_DFSF],
    };
    const { batch, pageMeta } = mapTrendyolApprovedResponse(wire);
    expect(batch).toHaveLength(1);
    expect(batch[0]?.title).toBe('dfsf');
    expect(pageMeta).toEqual({
      totalElements: 137,
      totalPages: 2,
      page: 0,
      size: 100,
      nextPageToken: null,
    });
  });

  it('passes through nextPageToken when present', () => {
    const wire: TrendyolApprovedProductsResponse = {
      totalElements: 50000,
      totalPages: 500,
      page: 99,
      size: 100,
      nextPageToken: 'abc-token',
      content: [STAGING_SAMPLE_DFSF],
    };
    const { pageMeta } = mapTrendyolApprovedResponse(wire);
    expect(pageMeta.nextPageToken).toBe('abc-token');
  });
});

// Reset mocks left behind by tests using vi.spyOn to be safe.
beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});
