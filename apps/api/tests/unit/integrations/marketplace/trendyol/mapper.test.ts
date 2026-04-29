import { describe, expect, it } from 'vitest';

import {
  mapTrendyolApprovedResponse,
  mapTrendyolContent,
  type TrendyolApprovedProductsResponse,
  type TrendyolContent,
} from '@pazarsync/marketplace';

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
    expect(out.color).toBe('Beyaz Beyaz');
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
    expect(variant?.size).toBe('210 cm Beden');
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

  it('joins multiple Renk attribute values with a space', () => {
    // Trendyol panel concatenates attrId 47 + 295 (both name "Renk") as
    // "Red Haki". Picking only the first dropped the second token.
    const out = mapTrendyolContent({
      ...STAGING_SAMPLE_DFSF,
      attributes: [
        { attributeId: 47, attributeName: 'Renk', attributeValue: 'Red' },
        {
          attributeId: 295,
          attributeName: 'Renk',
          attributeValueId: 68678,
          attributeValue: 'Haki',
        },
      ],
    });
    expect(out.color).toBe('Red Haki');
  });

  it('preserves duplicate Renk values to mirror the Trendyol panel ("Mavi Mavi")', () => {
    const out = mapTrendyolContent({
      ...STAGING_SAMPLE_DFSF,
      attributes: [
        { attributeId: 47, attributeName: 'Renk', attributeValue: 'Mavi' },
        { attributeId: 295, attributeName: 'Renk', attributeValueId: 1, attributeValue: 'Mavi' },
      ],
    });
    expect(out.color).toBe('Mavi Mavi');
  });

  it('captures prefixed Renk attribute names from staging or category overrides', () => {
    // Staging environment and some category configs emit "[STG] Renk" or
    // "[A-TDG]_Renk" instead of plain "Renk". endsWith catches both shapes.
    const out = mapTrendyolContent({
      ...STAGING_SAMPLE_DFSF,
      attributes: [
        { attributeId: 47, attributeName: '[A-TDG]_Renk', attributeValue: 'Male' },
        {
          attributeId: 295,
          attributeName: '[A-TDG]_Renk',
          attributeValueId: 1,
          attributeValue: '[A-TDG]_Siyah',
        },
      ],
    });
    expect(out.color).toBe('Male [A-TDG]_Siyah');
  });

  it('returns null color when no Renk attribute is present', () => {
    const out = mapTrendyolContent({ ...STAGING_SAMPLE_DFSF, attributes: [] });
    expect(out.color).toBeNull();
  });

  it('returns null variant label when the variant has no attributes', () => {
    const variant = STAGING_SAMPLE_DFSF.variants?.[0];
    if (variant === undefined) throw new Error('fixture variant missing');
    const out = mapTrendyolContent({
      ...STAGING_SAMPLE_DFSF,
      variants: [{ ...variant, attributes: [] }],
    });
    expect(out.variants[0]?.size).toBeNull();
  });

  it('captures non-Beden variant attributes (Boyut/Ebat, Kullanım Alanı, …)', () => {
    // Real failure mode from staging: textile variants come through with
    // attributeName "Boyut/Ebat" (attrId 92) — filtering on "Beden" silently
    // dropped the entire variant label. Panel shows "20 Boyut/Ebat".
    const variant = STAGING_SAMPLE_DFSF.variants?.[0];
    if (variant === undefined) throw new Error('fixture variant missing');
    const out = mapTrendyolContent({
      ...STAGING_SAMPLE_DFSF,
      variants: [
        {
          ...variant,
          attributes: [
            {
              attributeId: 92,
              attributeName: 'Boyut/Ebat',
              attributeValueId: 20337,
              attributeValue: '20',
            },
          ],
        },
      ],
    });
    expect(out.variants[0]?.size).toBe('20 Boyut/Ebat');
  });

  it('joins multiple variant attributes when a category emits more than one', () => {
    const variant = STAGING_SAMPLE_DFSF.variants?.[0];
    if (variant === undefined) throw new Error('fixture variant missing');
    const out = mapTrendyolContent({
      ...STAGING_SAMPLE_DFSF,
      variants: [
        {
          ...variant,
          attributes: [
            { attributeId: 293, attributeName: 'Beden', attributeValueId: 1, attributeValue: 'XS' },
            {
              attributeId: 196,
              attributeName: 'Kullanım Alanı',
              attributeValueId: 2,
              attributeValue: 'Günlük',
            },
          ],
        },
      ],
    });
    expect(out.variants[0]?.size).toBe('XS Beden Günlük Kullanım Alanı');
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
    const variant = STAGING_SAMPLE_DFSF.variants?.[0];
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

  it('defaults to ₺0,00 when a variant arrives without a price block', () => {
    const variant = STAGING_SAMPLE_DFSF.variants?.[0];
    if (variant === undefined) throw new Error('fixture variant missing');
    const { price: _droppedPrice, ...variantWithoutPrice } = variant;
    void _droppedPrice;
    const out = mapTrendyolContent({
      ...STAGING_SAMPLE_DFSF,
      variants: [variantWithoutPrice],
    });
    expect(out.variants[0]?.salePrice).toBe('0.00');
    expect(out.variants[0]?.listPrice).toBe('0.00');
  });

  it('defaults to 0 quantity when a variant arrives without a stock block', () => {
    const variant = STAGING_SAMPLE_DFSF.variants?.[0];
    if (variant === undefined) throw new Error('fixture variant missing');
    const { stock: _droppedStock, ...variantWithoutStock } = variant;
    void _droppedStock;
    const out = mapTrendyolContent({
      ...STAGING_SAMPLE_DFSF,
      variants: [variantWithoutStock],
    });
    expect(out.variants[0]?.quantity).toBe(0);
  });

  it('defaults delivery to null/false/[] when deliveryOptions is missing', () => {
    const variant = STAGING_SAMPLE_DFSF.variants?.[0];
    if (variant === undefined) throw new Error('fixture variant missing');
    const { deliveryOptions: _droppedDelivery, ...variantWithoutDelivery } = variant;
    void _droppedDelivery;
    const out = mapTrendyolContent({
      ...STAGING_SAMPLE_DFSF,
      variants: [variantWithoutDelivery],
    });
    expect(out.variants[0]?.deliveryDuration).toBeNull();
    expect(out.variants[0]?.isRushDelivery).toBe(false);
    expect(out.variants[0]?.fastDeliveryOptions).toEqual([]);
  });

  it('handles missing content-level images and attributes with empty defaults', () => {
    const { images: _i, attributes: _a, ...stripped } = STAGING_SAMPLE_DFSF;
    void _i;
    void _a;
    const out = mapTrendyolContent(stripped);
    expect(out.images).toEqual([]);
    expect(out.attributes).toEqual([]);
    expect(out.color).toBeNull();
  });

  it('handles a content with no variants array (defaults to [])', () => {
    const { variants: _v, ...stripped } = STAGING_SAMPLE_DFSF;
    void _v;
    const out = mapTrendyolContent(stripped);
    expect(out.variants).toEqual([]);
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
