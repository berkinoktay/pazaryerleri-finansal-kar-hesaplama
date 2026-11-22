import { describe, expect, it } from 'vitest';

import { ProductVariantStatus } from '@pazarsync/db/enums';
import {
  deriveStatusReason,
  deriveVariantStatus,
  mapTrendyolApprovedResponse,
  mapTrendyolContent,
  type TrendyolApprovedProductsWithContent,
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
      deliveryOptions: {},
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

// Every key a mapped variant carries, sorted. upsertCatalogBatch persists each
// of them, so a key outside this list would be a field nothing writes.
const MAPPED_VARIANT_KEYS = [
  'attributes',
  'barcode',
  'deliveryDuration',
  'listPrice',
  'platformVariantId',
  'productUrl',
  'quantity',
  'salePrice',
  'size',
  'status',
  'statusReason',
  'stockCode',
  'syncedCommissionRate',
  'syncedDimensionalWeight',
  'vatRate',
] as const;

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
    expect(out.imageUrls).toEqual([
      'https://cdn.dsmcdn.com/mediacenter-stage8/stage/QC_PREP/20260427/02/de9bebd6-e781-3d1d-9f76-10765a8c3b3c/1_org_zoom.jpg',
    ]);
    expect(out.platformCreatedAt).toEqual(new Date(1777246115403));
    expect(out.variants).toHaveLength(1);

    const variant = out.variants[0];
    expect(variant?.platformVariantId).toBe(BigInt(1565552107));
    expect(variant?.barcode).toBe('1231231231');
    expect(variant?.stockCode).toBe('122');
    expect(variant?.size).toBe('210 cm Beden');
    // onSale=true with every other flag false, and lockReason null on the wire.
    expect(variant?.status).toBe(ProductVariantStatus.ON_SALE);
    expect(variant?.statusReason).toBeNull();
    expect(variant?.salePrice).toBe('131231.00');
    expect(variant?.listPrice).toBe('131231.00');
    expect(variant?.quantity).toBe(12312);
    expect(variant?.deliveryDuration).toBeNull();
    expect(variant?.productUrl).toContain('stage.trendyol.com');
  });

  it('emits exactly the variant fields the catalog upsert persists', () => {
    const variant = mapTrendyolContent(STAGING_SAMPLE_DFSF).variants[0];
    expect(variant).toBeDefined();
    expect(Object.keys(variant ?? {}).sort()).toEqual([...MAPPED_VARIANT_KEYS]);
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

  it('defaults deliveryDuration to null when deliveryOptions is missing', () => {
    const variant = STAGING_SAMPLE_DFSF.variants?.[0];
    if (variant === undefined) throw new Error('fixture variant missing');
    const { deliveryOptions: _droppedDelivery, ...variantWithoutDelivery } = variant;
    void _droppedDelivery;
    const out = mapTrendyolContent({
      ...STAGING_SAMPLE_DFSF,
      variants: [variantWithoutDelivery],
    });
    expect(out.variants[0]?.deliveryDuration).toBeNull();
  });

  it('keeps deliveryDuration 0 (ships today) from the current deliveryOptions shape', () => {
    const variant = STAGING_SAMPLE_DFSF.variants?.[0];
    if (variant === undefined) throw new Error('fixture variant missing');
    const out = mapTrendyolContent({
      ...STAGING_SAMPLE_DFSF,
      variants: [{ ...variant, deliveryOptions: { deliveryDuration: 0 } }],
    });
    expect(out.variants[0]?.deliveryDuration).toBe(0);
  });

  it('handles missing content-level images and attributes with empty defaults', () => {
    const { images: _i, attributes: _a, ...stripped } = STAGING_SAMPLE_DFSF;
    void _i;
    void _a;
    const out = mapTrendyolContent(stripped);
    expect(out.imageUrls).toEqual([]);
    expect(out.attributes).toEqual([]);
    expect(out.color).toBeNull();
  });

  it('handles a content with no variants array (defaults to [])', () => {
    const { variants: _v, ...stripped } = STAGING_SAMPLE_DFSF;
    void _v;
    const out = mapTrendyolContent(stripped);
    expect(out.variants).toEqual([]);
  });

  it('maps variant commission to syncedCommissionRate as a 2-decimal string', () => {
    const variant = STAGING_SAMPLE_DFSF.variants?.[0];
    if (variant === undefined) throw new Error('fixture variant missing');
    const out = mapTrendyolContent({
      ...STAGING_SAMPLE_DFSF,
      variants: [{ ...variant, commission: 7.83 }],
    });
    expect(out.variants[0]?.syncedCommissionRate).toBe('7.83');
    // A single-decimal wire value must be padded — proves the .toFixed(2) intent.
    const padded = mapTrendyolContent({
      ...STAGING_SAMPLE_DFSF,
      variants: [{ ...variant, commission: 7.8 }],
    });
    expect(padded.variants[0]?.syncedCommissionRate).toBe('7.80');
  });

  it('maps no desi from Trendyol (absent, null, 0, rounds to 0, not a number, negative) to null', () => {
    const variant = STAGING_SAMPLE_DFSF.variants?.[0];
    if (variant === undefined) throw new Error('fixture variant missing');
    const { dimensionalWeight: _droppedDesi, ...variantWithoutDesi } = {
      ...variant,
      dimensionalWeight: 1,
    };
    void _droppedDesi;
    // 0 is in the list: Trendyol sends 0 for a product whose desi was never entered.
    // So is a positive desi that rounds to 0 at 2 decimals (0.004 -> 0.00): a
    // Trendyol 0 is never written, whichever way it arrives.
    const wireValues = [null, 0, 0.004, Number.NaN, Number.POSITIVE_INFINITY, -1];
    const outs = [
      mapTrendyolContent({ ...STAGING_SAMPLE_DFSF, variants: [variantWithoutDesi] }),
      ...wireValues.map((dimensionalWeight) =>
        mapTrendyolContent({
          ...STAGING_SAMPLE_DFSF,
          variants: [{ ...variant, dimensionalWeight }],
        }),
      ),
    ];
    for (const out of outs) {
      expect(out.variants[0]?.syncedDimensionalWeight).toBeNull();
    }
  });

  it('pads a positive desi from Trendyol to 2 decimals', () => {
    const variant = STAGING_SAMPLE_DFSF.variants?.[0];
    if (variant === undefined) throw new Error('fixture variant missing');
    const small = mapTrendyolContent({
      ...STAGING_SAMPLE_DFSF,
      variants: [{ ...variant, dimensionalWeight: 0.5 }],
    });
    const decimal = mapTrendyolContent({
      ...STAGING_SAMPLE_DFSF,
      variants: [{ ...variant, dimensionalWeight: 1.5 }],
    });
    // The smallest desi that does not round to 0 keeps its rounded value.
    const roundsUp = mapTrendyolContent({
      ...STAGING_SAMPLE_DFSF,
      variants: [{ ...variant, dimensionalWeight: 0.005 }],
    });
    expect(small.variants[0]?.syncedDimensionalWeight).toBe('0.50');
    expect(decimal.variants[0]?.syncedDimensionalWeight).toBe('1.50');
    expect(roundsUp.variants[0]?.syncedDimensionalWeight).toBe('0.01');
  });

  it('collapses absent and zero commission to null', () => {
    // A real %0 commission does not exist on the wire, so both an omitted value and
    // a literal 0 mean "unknown" (the desi mapping reads a wire 0 the same way).
    const variant = STAGING_SAMPLE_DFSF.variants?.[0];
    if (variant === undefined) throw new Error('fixture variant missing');
    const { commission: _droppedCommission, ...variantWithoutCommission } = {
      ...variant,
      commission: 0,
    };
    void _droppedCommission;
    const outZero = mapTrendyolContent({
      ...STAGING_SAMPLE_DFSF,
      variants: [{ ...variant, commission: 0 }],
    });
    const outAbsent = mapTrendyolContent({
      ...STAGING_SAMPLE_DFSF,
      variants: [variantWithoutCommission],
    });
    expect(outZero.variants[0]?.syncedCommissionRate).toBeNull();
    expect(outAbsent.variants[0]?.syncedCommissionRate).toBeNull();
  });
});

describe('mapTrendyolApprovedResponse', () => {
  it('forwards the page meta and maps content[]', () => {
    const wire: TrendyolApprovedProductsWithContent = {
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
    const wire: TrendyolApprovedProductsWithContent = {
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

interface StatusPrecedenceCase {
  name: string;
  flags: { onSale?: boolean; archived?: boolean; blacklisted?: boolean; locked?: boolean };
  expected: ProductVariantStatus;
}

// Precedence: archived > blacklisted > locked > onSale > not on sale.
const STATUS_PRECEDENCE_CASES: StatusPrecedenceCase[] = [
  {
    name: 'every flag false',
    flags: { onSale: false, archived: false, blacklisted: false, locked: false },
    expected: ProductVariantStatus.NOT_ON_SALE,
  },
  { name: 'every flag missing', flags: {}, expected: ProductVariantStatus.NOT_ON_SALE },
  { name: 'onSale only', flags: { onSale: true }, expected: ProductVariantStatus.ON_SALE },
  { name: 'locked only', flags: { locked: true }, expected: ProductVariantStatus.LOCKED },
  {
    name: 'onSale + locked',
    flags: { onSale: true, locked: true },
    expected: ProductVariantStatus.LOCKED,
  },
  {
    name: 'blacklisted + locked',
    flags: { blacklisted: true, locked: true },
    expected: ProductVariantStatus.BLACKLISTED,
  },
  {
    name: 'onSale + blacklisted',
    flags: { onSale: true, blacklisted: true },
    expected: ProductVariantStatus.BLACKLISTED,
  },
  {
    name: 'archived + locked',
    flags: { archived: true, locked: true },
    expected: ProductVariantStatus.ARCHIVED,
  },
  {
    name: 'archived + onSale',
    flags: { archived: true, onSale: true },
    expected: ProductVariantStatus.ARCHIVED,
  },
  {
    name: 'every flag true',
    flags: { onSale: true, archived: true, blacklisted: true, locked: true },
    expected: ProductVariantStatus.ARCHIVED,
  },
];

describe('deriveVariantStatus', () => {
  it.each(STATUS_PRECEDENCE_CASES)('$name -> $expected', ({ flags, expected }) => {
    expect(deriveVariantStatus(flags)).toBe(expected);
  });
});

describe('deriveStatusReason', () => {
  it('returns the lock reason for a LOCKED variant', () => {
    expect(
      deriveStatusReason(ProductVariantStatus.LOCKED, { lockReason: 'CRITICAL_SALE_PRICE_CHANGE' }),
    ).toBe('CRITICAL_SALE_PRICE_CHANGE');
  });

  it('returns the blacklist reason for a BLACKLISTED variant', () => {
    expect(
      deriveStatusReason(ProductVariantStatus.BLACKLISTED, {
        blacklistReason: 'UNAPPROVED_BRAND_CATEGORY_SPM',
      }),
    ).toBe('UNAPPROVED_BRAND_CATEGORY_SPM');
  });

  it('returns null for a LOCKED variant without a lock reason', () => {
    expect(deriveStatusReason(ProductVariantStatus.LOCKED, {})).toBeNull();
    expect(deriveStatusReason(ProductVariantStatus.LOCKED, { lockReason: null })).toBeNull();
  });

  it('never borrows the reason that belongs to the other status', () => {
    expect(
      deriveStatusReason(ProductVariantStatus.LOCKED, {
        blacklistReason: 'UNAPPROVED_BRAND_CATEGORY_SPM',
      }),
    ).toBeNull();
    expect(
      deriveStatusReason(ProductVariantStatus.BLACKLISTED, { lockReason: 'LOW_SALE_PRICING' }),
    ).toBeNull();
  });

  it.each([
    ProductVariantStatus.ON_SALE,
    ProductVariantStatus.NOT_ON_SALE,
    ProductVariantStatus.ARCHIVED,
  ])('returns null for %s even when Trendyol left a reason behind', (status) => {
    expect(
      deriveStatusReason(status, {
        lockReason: 'LOW_SALE_PRICING',
        blacklistReason: 'UNAPPROVED_BRAND_CATEGORY_SPM',
      }),
    ).toBeNull();
  });

  it('collapses an empty or whitespace-only reason to null', () => {
    expect(deriveStatusReason(ProductVariantStatus.LOCKED, { lockReason: '' })).toBeNull();
    expect(
      deriveStatusReason(ProductVariantStatus.BLACKLISTED, { blacklistReason: '   ' }),
    ).toBeNull();
  });

  it('trims the whitespace around a reported reason', () => {
    expect(
      deriveStatusReason(ProductVariantStatus.LOCKED, { lockReason: ' UNSUPPLIED_PRODUCT ' }),
    ).toBe('UNSUPPLIED_PRODUCT');
  });
});

describe('mapTrendyolContent: variant status', () => {
  it('maps a locked variant to LOCKED with its lock reason', () => {
    const variant = STAGING_SAMPLE_DFSF.variants?.[0];
    if (variant === undefined) throw new Error('fixture variant missing');
    const out = mapTrendyolContent({
      ...STAGING_SAMPLE_DFSF,
      variants: [{ ...variant, locked: true, lockReason: 'CRITICAL_SALE_PRICE_CHANGE' }],
    });
    expect(out.variants[0]?.status).toBe(ProductVariantStatus.LOCKED);
    expect(out.variants[0]?.statusReason).toBe('CRITICAL_SALE_PRICE_CHANGE');
  });

  it('maps a blacklisted variant to BLACKLISTED with its blacklist reason', () => {
    const variant = STAGING_SAMPLE_DFSF.variants?.[0];
    if (variant === undefined) throw new Error('fixture variant missing');
    const out = mapTrendyolContent({
      ...STAGING_SAMPLE_DFSF,
      variants: [
        { ...variant, blacklisted: true, blacklistReason: 'UNAPPROVED_BRAND_CATEGORY_SPM' },
      ],
    });
    expect(out.variants[0]?.status).toBe(ProductVariantStatus.BLACKLISTED);
    expect(out.variants[0]?.statusReason).toBe('UNAPPROVED_BRAND_CATEGORY_SPM');
  });

  it('maps a variant without any status flag to NOT_ON_SALE', () => {
    const variant = STAGING_SAMPLE_DFSF.variants?.[0];
    if (variant === undefined) throw new Error('fixture variant missing');
    const {
      onSale: _onSale,
      archived: _archived,
      blacklisted: _blacklisted,
      locked: _locked,
      ...variantWithoutFlags
    } = variant;
    void _onSale;
    void _archived;
    void _blacklisted;
    void _locked;
    const out = mapTrendyolContent({ ...STAGING_SAMPLE_DFSF, variants: [variantWithoutFlags] });
    expect(out.variants[0]?.status).toBe(ProductVariantStatus.NOT_ON_SALE);
    expect(out.variants[0]?.statusReason).toBeNull();
  });
});
