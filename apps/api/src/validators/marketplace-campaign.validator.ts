// Kampanyalar (Trendyol'un kurguladığı kampanyalara katılım) API'sinin wire sözleşmesi.
//
// Kurgu alanları İndirimler ile AYNI beş türü paylaşır (CODE hariç — kupon burada ayrı
// bir tür değildir, Berkin kararı 2026-08-02) ve tür başına zorunluluk kuralları da
// aynıdır; bu yüzden `refineDiscountConfig` YENİDEN KULLANILIR, kopyalanmaz. Kampanyalar'ın
// eklediği tek alan `trendyolFundingPct`.
//
// Hem multipart yükleme hem JSON PATCH kurguyu AYNI string alanlarıyla taşır, böylece iki
// giriş yolu tek kapıdan geçer.

import { z } from '@hono/zod-openapi';
import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';
import { CampaignPriceSelection, DiscountType, DiscountValueKind } from '@pazarsync/db/enums';

import type { DiscountConfig } from '../services/discount-math-commons';
import { refineDiscountConfig } from './discount-list.validator';
import { QuoteBreakdownSchema } from './product-pricing.validator';

const DECIMAL_RE = /^\d+(\.\d{1,2})?$/;
const INT_RE = /^\d+$/;

/** Karşılama oranının üst sınırı; indirimin tamamı Trendyol'da olabilir ama fazlası olamaz. */
const MAX_FUNDING_PCT = 100;

/**
 * Kampanyalar sayfasının sunduğu kurgular. `DiscountType` enum'unun altı değerinden
 * beşi — `CODE` (kupon) burada YOKTUR çünkü kupon kampanyaları matematiksel olarak
 * mevcut kurgularla ifade edilir (tasarım kararı 4).
 */
export const CAMPAIGN_DISCOUNT_TYPES = [
  'NET',
  'CONDITIONAL_BASKET',
  'CONDITIONAL_QUANTITY',
  'BUY_X_PAY_Y',
  'NTH_PRODUCT',
] as const satisfies ReadonlyArray<(typeof DiscountType)[keyof typeof DiscountType]>;

export const CampaignDiscountTypeSchema = z
  .enum(CAMPAIGN_DISCOUNT_TYPES)
  .openapi('CampaignDiscountType', {
    description:
      'Kampanya kurgusu: NET / CONDITIONAL_BASKET (min sepet) / CONDITIONAL_QUANTITY (N adet) / ' +
      'BUY_X_PAY_Y / NTH_PRODUCT (X. ürüne). Kupon ayrı bir tür değildir.',
  });

export const CampaignValueKindSchema = z.enum(DiscountValueKind).openapi('CampaignValueKind', {
  description: 'Değer türü: AMOUNT (TL) / PERCENT (%) / FIXED_PRICE (yalnız NTH_PRODUCT).',
});

export const MarketplaceCampaignConfigFieldsSchema = z
  .object({
    discountType: CampaignDiscountTypeSchema,
    valueKind: CampaignValueKindSchema.optional(),
    value: z.string().regex(DECIMAL_RE, 'INVALID_DISCOUNT_VALUE').optional(),
    minBasketAmount: z.string().regex(DECIMAL_RE, 'INVALID_MIN_BASKET').optional(),
    minQuantity: z.string().regex(INT_RE, 'INVALID_MIN_QUANTITY').optional(),
    buyQuantity: z.string().regex(INT_RE, 'INVALID_BUY_QUANTITY').optional(),
    payQuantity: z.string().regex(INT_RE, 'INVALID_PAY_QUANTITY').optional(),
    nthIndex: z.string().regex(INT_RE, 'INVALID_NTH_INDEX').optional(),
    // Trendyol karşılama oranı, yüzde. Verilmezse 0 — satıcı indirimin tamamını üstlenir.
    trendyolFundingPct: z
      .string()
      .regex(DECIMAL_RE, 'INVALID_FUNDING_PCT')
      .default('0')
      .openapi({ description: 'Trendyol karşılama oranı (%), 0–100. Varsayılan 0.' }),
    startsAt: z.string().datetime({ offset: true }).optional(),
    endsAt: z.string().datetime({ offset: true }).optional(),
  })
  .superRefine((val, ctx) => {
    // Kurgu kuralları İndirimler ile birebir aynı — tek gerçek kaynağı yeniden kullan.
    refineDiscountConfig(val, ctx);
    if (Number(val.trendyolFundingPct) > MAX_FUNDING_PCT) {
      ctx.addIssue({
        code: 'custom',
        message: 'FUNDING_PCT_OVER_100',
        path: ['trendyolFundingPct'],
      });
    }
  });

export type MarketplaceCampaignConfigFields = z.infer<typeof MarketplaceCampaignConfigFieldsSchema>;

/** Doğrulanmış alanları compute'ün DiscountConfig'ine indirir. */
export function campaignConfigFromFields(f: MarketplaceCampaignConfigFields): DiscountConfig {
  switch (f.discountType) {
    case 'NET':
      return { type: 'NET', valueKind: nonFixedKind(f), value: new Decimal(f.value ?? '0') };
    case 'CONDITIONAL_BASKET':
      return {
        type: 'CONDITIONAL_BASKET',
        valueKind: nonFixedKind(f),
        value: new Decimal(f.value ?? '0'),
        minBasketAmount: new Decimal(f.minBasketAmount ?? '0'),
      };
    case 'CONDITIONAL_QUANTITY':
      return {
        type: 'CONDITIONAL_QUANTITY',
        valueKind: nonFixedKind(f),
        value: new Decimal(f.value ?? '0'),
        minQuantity: Number(f.minQuantity ?? '1'),
      };
    case 'BUY_X_PAY_Y':
      return {
        type: 'BUY_X_PAY_Y',
        buyQuantity: Number(f.buyQuantity ?? '1'),
        payQuantity: Number(f.payQuantity ?? '1'),
      };
    case 'NTH_PRODUCT':
      return {
        type: 'NTH_PRODUCT',
        valueKind: f.valueKind ?? 'AMOUNT',
        value: new Decimal(f.value ?? '0'),
        nthIndex: Number(f.nthIndex ?? '2'),
      };
    default: {
      const _exhaustive: never = f.discountType;
      throw new Error(`Unhandled campaign discount type: ${String(_exhaustive)}`);
    }
  }
}

function nonFixedKind(f: MarketplaceCampaignConfigFields): 'AMOUNT' | 'PERCENT' {
  // refineDiscountConfig FIXED_PRICE'ı NTH dışında zaten reddetti; burada daralt.
  return f.valueKind === 'PERCENT' ? 'PERCENT' : 'AMOUNT';
}

/**
 * Type guard narrowing the FULL six-member `DiscountType` down to the five Kampanyalar
 * supports. Needed because `MarketplaceCampaignList.discountType` is a Prisma column typed
 * as the full `DiscountType` (the column is shared with İndirimler's schema shape and can't
 * express "five of six" at the DB/type level), while `campaignConfigFromFields`'s switch is
 * only exhaustive over the five-member `CAMPAIGN_DISCOUNT_TYPES` union. A caller reading a
 * real Prisma row needs a way to narrow the wide column type without an `as` (banned
 * repo-wide) — this guard is that way.
 */
export function isCampaignDiscountType(
  value: DiscountType,
): value is (typeof CAMPAIGN_DISCOUNT_TYPES)[number] {
  return (CAMPAIGN_DISCOUNT_TYPES as readonly string[]).includes(value);
}

/** Kaydedilmiş liste satırının compute'e ilgili kurgu alanları. */
export interface MarketplaceCampaignConfigRow {
  // FULL DiscountType (not the narrowed campaign union) — see isCampaignDiscountType above.
  // The write path (MarketplaceCampaignConfigFieldsSchema) makes a CODE row unwritable
  // through this vertical, but the column itself is the shared DiscountType and cannot
  // enforce that at the type level; campaignConfigFromListRow guards it as defense in depth
  // against a hand-edited or migrated row.
  discountType: DiscountType;
  valueKind: (typeof DiscountValueKind)[keyof typeof DiscountValueKind] | null;
  value: Prisma.Decimal | null;
  minBasketAmount: Prisma.Decimal | null;
  minQuantity: number | null;
  buyQuantity: number | null;
  payQuantity: number | null;
  nthIndex: number | null;
  trendyolFundingPct: Prisma.Decimal;
}

/**
 * İkinci köprü: kaydedilmiş satırdan compute'ün DiscountConfig'ini kurar. Satır yazılırken
 * zaten doğrulamadan geçtiği için burada yeniden doğrulama yapılmaz — alanlar string'e
 * indirilip AYNI switch'ten geçirilir (kopya switch yok). Tek istisna `discountType`: satır
 * teorik olarak CODE taşıyabileceği için (yukarıya bakın) `campaignConfigFromFields`'a
 * geçmeden ÖNCE `isCampaignDiscountType` ile daraltılır; CODE görülürse açık bir hata
 * fırlatılır — sessizce yanlış bir DiscountConfig üretmek yerine.
 */
export function campaignConfigFromListRow(row: MarketplaceCampaignConfigRow): DiscountConfig {
  if (!isCampaignDiscountType(row.discountType)) {
    throw new Error(
      `Campaign list row carries an unsupported discount type: ${row.discountType}. ` +
        'Kampanyalar only supports NET, CONDITIONAL_BASKET, CONDITIONAL_QUANTITY, ' +
        'BUY_X_PAY_Y, NTH_PRODUCT — CODE is İndirimler-only.',
    );
  }
  return campaignConfigFromFields({
    discountType: row.discountType,
    valueKind: row.valueKind ?? undefined,
    value: row.value !== null ? row.value.toString() : undefined,
    minBasketAmount: row.minBasketAmount !== null ? row.minBasketAmount.toString() : undefined,
    minQuantity: row.minQuantity !== null ? row.minQuantity.toString() : undefined,
    buyQuantity: row.buyQuantity !== null ? row.buyQuantity.toString() : undefined,
    payQuantity: row.payQuantity !== null ? row.payQuantity.toString() : undefined,
    nthIndex: row.nthIndex !== null ? row.nthIndex.toString() : undefined,
    trendyolFundingPct: row.trendyolFundingPct.toString(),
  });
}

// ─── Path params ────────────────────────────────────────────────────────────

export const MarketplaceCampaignStorePathSchema = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
  storeId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'storeId', in: 'path' } }),
});

export const MarketplaceCampaignPathSchema = MarketplaceCampaignStorePathSchema.extend({
  campaignId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'campaignId', in: 'path' } }),
});

export const MarketplaceCampaignItemPathSchema = MarketplaceCampaignPathSchema.extend({
  itemId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'itemId', in: 'path' } }),
});

// ─── Import (multipart upload) ──────────────────────────────────────────────

// `.extend()` on a schema that already carries `.superRefine()` PRESERVES that refinement
// in this Zod version (unlike the sibling's plain-object + refine-applied-per-usage-site
// pattern) — so this form still inherits BOTH refineDiscountConfig's per-type rules AND the
// funding>100 check from MarketplaceCampaignConfigFieldsSchema without re-declaring them.
export const ImportMarketplaceCampaignFormSchema = MarketplaceCampaignConfigFieldsSchema.extend({
  file: z.instanceof(File).openapi({
    type: 'string',
    format: 'binary',
    description: 'Trendyol Kampanyalar ürün seçim dosyası (.xlsx)',
  }),
  name: z.string().optional().openapi({ description: 'İsteğe bağlı görünen ad; yoksa dosya adı.' }),
});

export const ImportMarketplaceCampaignResponseSchema = z
  .object({
    campaignId: z.string().uuid(),
    name: z.string(),
    itemCount: z.number().int(),
    matched: z.number().int(),
    unmatched: z.number().int(),
    skippedRows: z.number().int(),
  })
  .openapi('ImportMarketplaceCampaignResponse');

export type ImportMarketplaceCampaignResponse = z.infer<
  typeof ImportMarketplaceCampaignResponseSchema
>;

// ─── Shared response enums ───────────────────────────────────────────────────

export const CampaignPriceSelectionSchema = z
  .enum(CampaignPriceSelection)
  .openapi('CampaignPriceSelection', {
    description:
      'Satıcının kalem başına fiyat seçimi: NONE (kampanyaya katılmıyor) / MAX (Excel’in ' +
      '“Maksimum Girebileceğin Fiyat” değeri) / CUSTOM (satıcının kendi girdiği fiyat).',
  });

export const CampaignCommissionSourceSchema = z
  .enum(['band', 'product', 'category'])
  .openapi('CampaignCommissionSource', {
    description:
      'Komisyon nereden geldi: komisyon tarifesi bandı (band) / ürünün senkronlanan ' +
      'komisyonu (product) / kategori oranı (category).',
  });

export const CampaignItemReasonSchema = z
  .enum(['NO_PRODUCT', 'NO_COST', 'NO_SHIPPING', 'NO_COMMISSION'])
  .openapi('CampaignItemReason', {
    description:
      'Kâr hesaplanamama nedeni: ürün eşleşmedi / maliyet yok / kargo yok / komisyon yok.',
  });

export const CampaignScenarioPresentationSchema = z
  .enum(['UNIT', 'ORDER'])
  .openapi('CampaignScenarioPresentation', {
    description:
      "Which row layout the list's config calls for: UNIT (the unit price genuinely drops — show " +
      'the discounted unit) or ORDER (the effective unit is a synthetic average — show the whole ' +
      'campaign order).',
  });

export const CampaignScenarioSchema = z
  .object({
    price: z.string(),
    commissionPct: z.string().nullable(),
    commissionSource: CampaignCommissionSourceSchema.nullable(),
    netProfit: z.string().nullable(),
    marginPct: z.string().nullable(),
  })
  .openapi('CampaignScenario', {
    description:
      'One priced scenario for a campaign item (at the current, max, or custom price): the ' +
      'resolved commission and the resulting net profit / margin. commissionPct/commissionSource/' +
      'netProfit/marginPct are null when the item is not calculable at this price.',
  });

// Mirrors the İndirimler CommissionBand shape on the wire (no shared exported schema — each
// vertical declares its own). One price band of the resolved commission tariff: [lowerLimit,
// upperLimit] window + the commission that applies inside it.
export const CampaignCommissionBandSchema = z
  .object({
    /** Lower price bound (GROSS TRY); null on the lowest band (open-ended below). */
    lowerLimit: z.string().nullable(),
    /** Upper price bound (GROSS TRY); null on the top band (open-ended above). */
    upperLimit: z.string().nullable(),
    /** The band's commission PERCENT (e.g. "13.1000"), at 4-decimal precision. */
    commissionPct: z.string(),
  })
  .openapi('CampaignCommissionBand', {
    description:
      'Ürünün komisyon tarifesindeki bir fiyat bandı: [lowerLimit, upperLimit] penceresi ' +
      've o pencereye düşen komisyon oranı. Cari, maksimum ve özel fiyatın hangi banda düştüğü ' +
      'UI popover’ında bu ladder ile işaretlenir.',
  });

// Single-product-basket settlement scenario for basket-scoped campaign types (mirrors the
// İndirimler DiscountBasketScenarioSchema), plus the ONE field this vertical adds:
// trendyolFundedTotal — what Trendyol covers of that basket's discount.
export const CampaignBasketScenarioSchema = z
  .object({
    assumedQuantity: z
      .number()
      .int()
      .openapi({
        description:
          'Assumed basket quantity (n): the minimum quantity of this product whose single-product ' +
          'basket satisfies the discount condition — ceil(minBasket/price) for basket, minQuantity ' +
          'for quantity, buyQuantity for X-al-Y, nthIndex for Nth-product.',
      }),
    basketTotal: z.string().openapi({
      description:
        'Undiscounted basket total (n × the CAMPAIGN price the seller enters — NOT the current ' +
        'price), 2-decimal string. The campaign promotion runs ON TOP of the campaign price, so ' +
        'anchoring here keeps basketDiscountTotal to the promotion alone and lets ' +
        'trendyolFundedTotal reconcile as a share of it.',
    }),
    basketPaidTotal: z.string().openapi({
      description:
        'What the customer pays for the assumed basket (n × the 2dp effective unit price), ' +
        '2-decimal string — always consistent with the row’s displayed unit price.',
    }),
    basketDiscountTotal: z.string().openapi({
      description: 'The basket discount (basketTotal − basketPaidTotal), 2-decimal string.',
    }),
    trendyolFundedTotal: z.string().openapi({
      description:
        'The share of basketDiscountTotal that Trendyol funds for this assumed basket ' +
        '(basketDiscountTotal × trendyolFundingPct / 100), 2-decimal string. The remainder is ' +
        'absorbed by the seller — at trendyolFundingPct=0 this is "0.00".',
    }),
    orderNetProfit: z
      .string()
      .nullable()
      .openapi({
        description:
          'Order net profit for the assumed n-unit basket, from the real profit engine over the ' +
          'order (n× product cost, 1× shipping, 1× PSF — the platform service and shipping are ' +
          'per-parcel and a basket of n identical units ships once); 2-decimal string, null when ' +
          'the priced scenario is not calculable.',
      }),
    orderMarginPct: z
      .string()
      .nullable()
      .openapi({
        description:
          "Order margin: orderNetProfit over the SELLER's settlement total for the basket " +
          '(n × the seller-effective unit price, i.e. what Trendyol pays out), × 100, 2-decimal ' +
          'string. The denominator is the seller amount — not what the customer paid — because ' +
          'commission and settlement both run off the seller amount. Null when the priced ' +
          'scenario is not calculable or the settlement total is zero.',
      }),
    currentOrderNetProfit: z
      .string()
      .nullable()
      .openapi({
        description:
          'Same-basis campaign-free baseline: the order net profit for the same n units at the ' +
          'current price, 2-decimal string; null when the current scenario is not calculable.',
      }),
  })
  .openapi('CampaignBasketScenario', {
    description:
      'Single-product-basket settlement scenario for basket-scoped campaign discount types. Null ' +
      'for NET (its showcase price genuinely changes) or a non-positive price.',
  });

// ─── Detail response DTO ──────────────────────────────────────────────────────

// discountType..trendyolFundingPct config alanları HEM liste HEM detay yanıtında
// birebir aynı — tek ortak shape'i iki şemaya da spread ederiz (kopyalama yok).
// Değerler wire'da string: para Decimal→2 hane, tarih ISO; adet alanları tamsayı.
// `trendyolFundingPct` liste satırında da görünür — §7 "Liste ekranı" satır başına
// karşılama oranı rozetini (sıfırsa gizli) buradan render eder.
const marketplaceCampaignConfigShape = {
  discountType: CampaignDiscountTypeSchema,
  valueKind: CampaignValueKindSchema.nullable(),
  value: z.string().nullable(),
  minBasketAmount: z.string().nullable(),
  minQuantity: z.number().int().nullable(),
  buyQuantity: z.number().int().nullable(),
  payQuantity: z.number().int().nullable(),
  nthIndex: z.number().int().nullable(),
  trendyolFundingPct: z.string().openapi({
    description: 'Trendyol karşılama oranı (%), 0–100. Varsayılan "0".',
  }),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
};

export const MarketplaceCampaignDetailItemSchema = z
  .object({
    id: z.string().uuid(),
    barcode: z.string(),
    productCode: z.string().nullable(),
    externalId: z.string().nullable(),
    productTitle: z.string(),
    brand: z.string().nullable(),
    color: z.string().nullable(),
    size: z.string().nullable(),
    category: z.string().nullable(),
    stock: z.number().int().nullable(),
    imageUrl: z.string().nullable(),
    // "Mevcut Satış Fiyatı" — kampanyasız taban senaryo.
    currentPrice: z.string(),
    // "Maksimum Girebileceğin Fiyat" — birinci fiyat seçeneği VE özel fiyatın tavanı.
    maxPrice: z.string(),
    hasCommissionTariff: z.boolean(),
    selection: CampaignPriceSelectionSchema,
    customPrice: z.string().nullable(),
    calculable: z.boolean(),
    reason: CampaignItemReasonSchema.nullable(),
    // Üç fiyat senaryosu — İndirimler'in current/discounted ikilisinden farklı olarak
    // Kampanyalar'ın "Maksimum Girebileceğin Fiyat" VE satıcının özel fiyatı ayrı ayrı
    // gösterilir; ikisi de aynı ürünün farklı fiyat noktalarındaki kâr projeksiyonu.
    current: CampaignScenarioSchema,
    maxScenario: CampaignScenarioSchema,
    customScenario: CampaignScenarioSchema.nullable(),
    /**
     * The item's commission-band ladder (top-down), resolved from the campaign-anchored
     * tariff week. Lets the UI show WHICH band the current/max/custom price land in. Null
     * when no covering tariff week resolved bands for the barcode (the item's rate fell to
     * the synced product rate or category rate).
     */
    commissionBands: z.array(CampaignCommissionBandSchema).nullable(),
    /**
     * Single-product-basket settlement scenario: the assumed basket, its paid total, its
     * discount, Trendyol's funded share, and the order-level net profit. Null for NET (its
     * showcase price genuinely changes) or a non-positive price.
     */
    scenario: CampaignBasketScenarioSchema.nullable(),
  })
  .openapi('MarketplaceCampaignDetailItem');

export const MarketplaceCampaignListItemSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    ...marketplaceCampaignConfigShape,
    itemCount: z.number().int(),
    selectedCount: z.number().int().openapi({
      description: 'Number of items whose selection is not NONE (MAX or CUSTOM).',
    }),
    exported: z.boolean(),
    updatedAt: z.string(),
  })
  .openapi('MarketplaceCampaignListItem');

export const MarketplaceCampaignListResponseSchema = z
  .object({ data: z.array(MarketplaceCampaignListItemSchema) })
  .openapi('MarketplaceCampaignListResponse');

export const MarketplaceCampaignDetailSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    ...marketplaceCampaignConfigShape,
    exported: z.boolean(),
    // Şeffaflık: bantları besleyen komisyon tarifesi + dönem (kaynak yoksa null).
    // Bantlar yalnız anchor'ı KAPSAYAN tarife haftasından gelir; kapsayan hafta yoksa null.
    commissionTariffName: z.string().nullable(),
    commissionPeriodLabel: z.string().nullable(),
    // Mağazanın komisyon tarifesi var ama hiçbiri anchor'ı kapsamıyorsa (yüklemeler bayat ya
    // da kampanya başlangıcına ulaşmıyor) true — komisyon ürün/kategori oranına düşer ve detay
    // satıcıyı uyarır. Kapsayan hafta çözüldüyse ya da mağazanın hiç tarifesi yoksa false.
    commissionTariffOutdated: z.boolean(),
    // Which row layout the list's config calls for — the frontend renders the UNIT vs ORDER
    // row from this single flag instead of re-deriving it from the config.
    scenarioPresentation: CampaignScenarioPresentationSchema,
    items: z.array(MarketplaceCampaignDetailItemSchema),
  })
  .openapi('MarketplaceCampaignDetail');

// ─── Selections + config update body ─────────────────────────────────────────

export const UpdateCampaignSelectionsBodySchema = z
  .object({
    // mode: 'set' tek tek satır günceller; 'all'/'none' TÜM listeyi işaretler/temizler
    // (500 satırlık listede tek istek — happy-path varsaymama kuralı). 'all' MAX seçimini
    // uygular; her satırın özel fiyat isteyip istemediğini API bilemez.
    mode: z.enum(['set', 'all', 'none']).default('set'),
    selections: z
      .array(
        z.object({
          itemId: z.string().uuid(),
          selection: CampaignPriceSelectionSchema,
          customPrice: z.string().regex(DECIMAL_RE, 'INVALID_CUSTOM_PRICE').nullable(),
        }),
      )
      .max(5000)
      .default([]),
  })
  .superRefine((val, ctx) => {
    if (val.mode === 'set' && val.selections.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'SELECTIONS_REQUIRED', path: ['selections'] });
    }
    // CUSTOM seçimi fiyatsız KALICILAŞAMAZ. Aksi hâlde satıcı satırı "katılıyorum" diye
    // işaretler, kaydeder, dosyayı indirir ve o satırın fiyat hücresi BOŞ çıkar — Trendyol da
    // ürünü sessizce yok sayar. Tavan aşımı (CUSTOM_PRICE_ABOVE_MAX) gürültülü hatasının
    // ayna görüntüsüdür ve satıcı açısından daha tehlikelidir, çünkü hiçbir uyarı vermez.
    // Kusurlu satırı arayüzün vurgulayabilmesi için tavan kapısıyla AYNI biçimde raporlanır:
    // alan `selections`, `meta.itemId` kusurlu kalemi adlandırır.
    for (const entry of val.selections) {
      if (entry.selection === CampaignPriceSelection.CUSTOM && entry.customPrice === null) {
        ctx.addIssue({
          code: 'custom',
          message: 'CUSTOM_PRICE_REQUIRED',
          path: ['selections'],
          params: { itemId: entry.itemId },
        });
      }
    }
  })
  .openapi('UpdateCampaignSelectionsBody');

export const UpdateCampaignSelectionsResponseSchema = z
  .object({ updated: z.number().int() })
  .openapi('UpdateCampaignSelectionsResponse');

// Same inheritance-through-extend as ImportMarketplaceCampaignFormSchema above — this PATCH
// body still runs refineDiscountConfig + the funding>100 check via the base schema's
// superRefine; nothing here re-applies them.
export const UpdateMarketplaceCampaignBodySchema = MarketplaceCampaignConfigFieldsSchema.extend({
  name: z.string().min(1).optional(),
}).openapi('UpdateMarketplaceCampaignBody');

export const UpdateMarketplaceCampaignResponseSchema = z
  .object({ id: z.string().uuid() })
  .openapi('UpdateMarketplaceCampaignResponse');

// ─── Estimate (on-demand breakdown for a campaign item) ──────────────────────
//
// The breakdown modal picks ONE of the three scenarios the detail row shows: `current`
// (the "Mevcut Satış Fiyatı"), `max` (the "Maksimum Girebileceğin Fiyat"), or `custom` (the
// seller's own price). The service runs the SAME chain + engine the detail uses, so the
// modal never disagrees with the row.

export const EstimateCampaignItemBodySchema = z
  .object({
    scenario: z.enum(['current', 'max', 'custom']).openapi({
      description:
        'Hangi senaryonun dökümü: current (mevcut satış fiyatı) / max (maksimum girilebilecek ' +
        'fiyat) / custom (satıcının özel fiyatı).',
    }),
    customPrice: z.string().regex(DECIMAL_RE, 'INVALID_CUSTOM_PRICE').optional().openapi({
      description:
        'scenario=custom iken denenecek fiyat; kalemin kayıtlı customPrice’ını geçici olarak geçersiz kılar.',
    }),
  })
  .openapi('EstimateCampaignItemBody');

export const EstimateCampaignItemResultSchema = z
  .object({
    itemId: z.string().uuid(),
    scenario: z.enum(['current', 'max', 'custom']),
    price: z.string().openapi({
      description:
        'What the SELLER earns, 2-decimal string: at `breakdownScope: "unit"` the settlement ' +
        'price for one unit (the commission base — what Trendyol pays out, funding included); ' +
        'at `breakdownScope: "order"` the whole assumed basket’s settlement total.',
    }),
    // ── Trendyol karşılama payının BİRİM dökümü ────────────────────────────────
    // `price` satıcının hakedişidir; müşterinin ödediği ondan DÜŞÜKtür ve aradaki farkı
    // Trendyol karşılar. Sepet bloğu bu ayrımı yalnız sipariş gösterimli kurgularda
    // gösterebiliyordu (NET ve koşulluların yüzde varyantlarında blok null'dır), oysa canlı
    // kampanyaların çoğu "Net %X İndirim"dir — yani satıcının Trendyol'un katkısını en çok
    // görmesi gereken kurgu, tam da göremediği kurguydu. Bu iki alan o boşluğu BİRİM kapsamda
    // doldurur; sipariş kapsamında ikisi de null'dır (birim-etkin fiyat orada yapay bir
    // ortalamadır, aşağıdaki açıklamaya bakın) ve ayrım sepet bloğunun toplamlarından okunur.
    customerPaidUnitPrice: z
      .string()
      .nullable()
      .openapi({
        description:
          'What the CUSTOMER pays for ONE unit under the campaign, 2-decimal string, alongside ' +
          'the seller’s unit settlement `price`. Null for the `current` scenario (no campaign ' +
          'applied) AND whenever `breakdownScope` is "order": at ORDER presentation the ' +
          'per-unit effective price is a synthetic average that describes no real unit (in a ' +
          '2-al-1-öde the customer pays full price for one unit and nothing for the other), so ' +
          'the split is reported as basket totals on `CampaignBasketScenario` instead.',
      }),
    trendyolFundedUnitAmount: z
      .string()
      .nullable()
      .openapi({
        description:
          'What Trendyol contributes for ONE unit, 2-decimal string — the difference between ' +
          'the seller’s unit settlement price and `customerPaidUnitPrice`, so ' +
          'customerPaidUnitPrice + trendyolFundedUnitAmount closes on `price` to the kuruş at ' +
          'unit scope. "0.00" when the campaign’s funding rate is zero. Null in exactly the ' +
          'same cases as `customerPaidUnitPrice`: the `current` scenario and order scope.',
      }),
    commissionPct: z.string().nullable(),
    commissionSource: CampaignCommissionSourceSchema.nullable(),
    calculable: z.boolean(),
    reason: CampaignItemReasonSchema.nullable(),
    breakdown: QuoteBreakdownSchema.nullable(),
    breakdownScope: z.enum(['unit', 'order']).openapi({
      description:
        'Scope of `breakdown` and `price`. It follows the CAMPAIGN’s presentation, not the ' +
        'scenario: an ORDER-presentation campaign (BUY_X_PAY_Y / NTH_PRODUCT / a ' +
        'conditional-AMOUNT discount) returns `order` for EVERY scenario — including `current`, ' +
        'whose order is the same assumed basket priced campaign-free — so the modal always ' +
        'totals to the figure the seller clicked in the row. `order` means the whole n-unit ' +
        'single-product basket: `price` is the order revenue and `breakdown` is the order-level ' +
        'profit (n× product cost, 1× shipping, 1× PSF). Everything else is `unit`: per-unit ' +
        'economics.',
    }),
    // Şeffaflık: bant kademesini besleyen komisyon tarifesi + dönem. Bir kaynak
    // çözüldüyse (kalem product/category'e düşse bile) doludur; yoksa null.
    commissionTariffName: z.string().nullable(),
    commissionPeriodLabel: z.string().nullable(),
  })
  .openapi('EstimateCampaignItemResult');

export type EstimateCampaignItemBody = z.infer<typeof EstimateCampaignItemBodySchema>;
export type EstimateCampaignItemResult = z.infer<typeof EstimateCampaignItemResultSchema>;

// ─── Target margin (suggest a price per item for a target margin) ────────────

export const TargetMarginBodySchema = z
  .object({
    targetMarginPct: z.string().regex(DECIMAL_RE, 'INVALID_TARGET_MARGIN'),
  })
  .openapi('TargetMarginBody');

export const TargetMarginResultSchema = z
  .object({
    suggestions: z.array(
      z.object({
        itemId: z.string().uuid(),
        price: z.string().nullable().openapi({
          description: 'Suggested price reaching the target margin; null when reason is set.',
        }),
        reason: z
          .enum(['UNREACHABLE', 'NOT_CALCULABLE'])
          .nullable()
          .openapi({
            description:
              'UNREACHABLE = no price up to maxPrice reaches the target margin. ' +
              'NOT_CALCULABLE = required cost/commission/shipping inputs are missing for this item. ' +
              'Null when `price` is present.',
          }),
      }),
    ),
  })
  .openapi('TargetMarginResult');

export type TargetMarginBody = z.infer<typeof TargetMarginBodySchema>;
export type TargetMarginResult = z.infer<typeof TargetMarginResultSchema>;

// ─── Inferred TS types (consumed by the service + route layers) ──────────────

/**
 * The five-member discount-type union Kampanyalar exposes on the wire — the narrowed form of
 * the shared six-member `DiscountType` column. Services reading a persisted row narrow to this
 * with {@link isCampaignDiscountType} before building a DTO.
 */
export type CampaignWireDiscountType = (typeof CAMPAIGN_DISCOUNT_TYPES)[number];

export type UpdateCampaignSelectionsBody = z.infer<typeof UpdateCampaignSelectionsBodySchema>;
/** One row of the selections payload: the item, its price choice and the custom price. */
export type CampaignSelection = UpdateCampaignSelectionsBody['selections'][number];

export type MarketplaceCampaignListItem = z.infer<typeof MarketplaceCampaignListItemSchema>;
export type CampaignCommissionBand = z.infer<typeof CampaignCommissionBandSchema>;
export type CampaignBasketScenario = z.infer<typeof CampaignBasketScenarioSchema>;
export type MarketplaceCampaignDetailItem = z.infer<typeof MarketplaceCampaignDetailItemSchema>;
export type MarketplaceCampaignDetail = z.infer<typeof MarketplaceCampaignDetailSchema>;
export type UpdateMarketplaceCampaignBody = z.infer<typeof UpdateMarketplaceCampaignBodySchema>;
