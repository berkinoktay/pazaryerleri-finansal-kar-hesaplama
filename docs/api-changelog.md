# API Changelog

All notable changes to the PazarSync REST API.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this API follows [Semantic Versioning](https://semver.org/) within each URL
path version (`/v1/`, `/v2/`, …). The major number of `info.version` is locked
to the URL path version. While the API is internal-only, breaking changes
within `/v1/` bump minor — see `docs/plans/2026-04-16-api-docs-design.md`
section "Versioning" for details.

## [Unreleased]

### Changed

- **Advantage tariff detail item gained a `commissionBands` field** (`GET
  /v1/organizations/{orgId}/stores/{storeId}/advantage-tariffs/{tariffId}`) — Each detail item now
  carries `commissionBands`: the product's commission-band ladder (`AdvantageCommissionBand[]`,
  top-down band1 → band4, each `{ lowerLimit, upperLimit, commissionPct }` with money at 2 decimals
  and percent at 4), resolved from the item's commission source. This lets the UI show WHICH
  commission band a price lands in (the "Ürün Komisyon Teklifleri" popup equivalent), so a seller
  can tell tier thresholds apart from commission-band boundaries. `null` when the source is the
  category rate or the barcode has no matching band (no ladder to show). The bands are read from the
  same source already loaded for the per-tier compute — no extra query. Non-breaking (additive
  field).
- **Advantage tariff item estimate gained a `scenario: "current"` mode** (`POST
  /v1/organizations/{orgId}/stores/{storeId}/advantage-tariffs/{tariffId}/items/{itemId}/estimate`)
  — In addition to the custom-price mode (`price`), the body now accepts `{ scenario: "current" }`
  (no price). It returns the breakdown of the item's CURRENT scenario: priced on its customer price
  at its current commission (the band the customer price lands in, else the category rate — resolved
  exactly as the detail baseline resolves it), so the breakdown matches the detail row's `current`
  byte-for-byte (same engine, same price, same commission). `commissionPct` / `commissionSource`
  echo the current rate and its source. New `422` codes: `PRICE_REQUIRED` (no price outside current
  mode) and `INVALID_ESTIMATE_MODE` (price sent alongside `scenario:"current"`). Non-breaking —
  existing price-based callers are unaffected.
- **Commission tariff item estimate gained a `scenario: "current"` mode** (`POST
  /v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}/items/{itemId}/estimate`)
  — In addition to the price-based modes (`price` + optional `bandKey`), the body now accepts
  `{ scenario: "current" }` (no price/bandKey). It returns the breakdown of the item's CURRENT
  scenario: priced on its commission-base price (or the sale price when that column is absent) at
  its current commission, so the breakdown matches the detail row's `currentNetProfit` badge
  byte-for-byte (same engine, same price, same commission). The response `bandKey` is `null` and
  `commissionPct` is the item's current rate. New `422` codes: `PRICE_REQUIRED` (no price in a
  non-current mode) and `INVALID_ESTIMATE_MODE` (price/bandKey sent alongside `scenario:"current"`).
  Non-breaking — existing price-based callers are unaffected.
- **Commission tariff export is now window-bucketed** (`POST
  /v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}/export`) — Replaces the
  old single-file "last period wins" combine (a latent data-loss bug). A split week (3-Gün + 4-Gün)
  is bucketed into up to **three** window files, only the non-empty ones: a whole-week
  `"7 Günlük Fiyat"` file for products priced the same in both sub-periods, plus `"3 Günlük Fiyat"`
  and `"4 Günlük Fiyat"` files for period-specific prices (a product priced differently across the
  windows lands in both). The seller re-uploads each file to its Trendyol tab. When more than one
  file is produced they are delivered as a single `.zip`. The `200` response advertises **two**
  content types — `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (a lone file:
  a full-week single-period tariff, or a split week where only one bucket is non-empty) and
  `application/zip` (multiple buckets) — and the download name comes from `Content-Disposition`.
  Non-breaking for clients that read the response as a binary blob + `Content-Disposition`.
- **CORS now exposes `Content-Disposition` and `X-Request-Id`** — Cross-origin browser JS could not
  read these response headers (the default CORS allowlist hides them), so the file-download routes'
  server-chosen filename was invisible to the frontend and a `.zip` export was mis-saved as `.xlsx`
  ("corrupt file"). `Access-Control-Expose-Headers` now lists both.
- **Plus commission tariffs are now multi-period** (the whole `/v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs`
  family) — A single Plus upload can carry several "Tarih Aralığı (N Gün)" date-range blocks (a 3-Gün
  + 4-Gün split week), so the Plus tariff moved from the old single-folded-period shape to the same
  three-level shape as the product tariff (tariff → period → item). Concretely:
  - **Detail (`GET .../{tariffId}`) now returns `periods[]`** — an array of `{ dateRangeLabel,
    dayCount, validity }` date-range tabs instead of the tariff-level single label/day count. Each
    detail item's row belongs to a period; a product priced across two sub-periods can carry a
    different reduced Plus commission per period. Callers that read the tariff's single period must
    switch to the `periods[]` array.
  - **The detail item's `plus` scenario is now always the CEILING scenario** — `plus.price` always
    equals `plusPriceUpperLimit`, and `plus.netProfit` / `plus.marginPct` are computed at the ceiling,
    even when the seller has committed a custom Plus price below it. The committed custom price no
    longer feeds the on-read compute (it is still echoed as `customPrice`, still written by the export,
    and still priced free-form by the item estimate endpoint), and `plusIsBetter` now compares the
    ceiling scenario against the current one. The response shape is unchanged — no field added or
    removed — so this is a pure semantics fix (the offer card is a pure ceiling option).
  - **Import (`POST .../import`) response gained `periodCount`** — how many date-range periods were
    persisted from the upload (1 for a full-week file, 2 for a split week), alongside the existing
    `productCount` / `itemCount` / match counts.
  - **Item estimate (`POST .../{tariffId}/items/{itemId}/estimate`) gained a `scenario: "current"`
    mode** — mirroring the product tariff estimate: pass `{ scenario: "current" }` (no `price`) to get
    the item's CURRENT baseline breakdown (its commission-base price at its current commission, so it
    matches the detail row's `currentNetProfit` byte-for-byte). New `422` codes `PRICE_REQUIRED` (no
    price in the custom-price mode) and `INVALID_ESTIMATE_MODE` (`price` sent with `scenario:"current"`).
    Existing price-based callers are unaffected.
  - **Export (`POST .../{tariffId}/export`) is now window-bucketed** — like the product tariff export,
    a split week is bucketed into up to three window files, only the non-empty ones: a whole-week
    `"7 Günlük Fiyat"` file for products opted in at the same price in both sub-periods (carrying ONE
    Plus price but a `"Hesaplanan Komisyon (N Gün)"` cell per sub-period, each at that period's own
    reduced percent), plus `"3 Günlük Fiyat"` / `"4 Günlük Fiyat"` files for period-specific prices.
    Multiple files are delivered as a single `.zip`; the `200` response now advertises **two** content
    types — `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and `application/zip` —
    with the download name in `Content-Disposition`. Non-breaking for clients that read the response as
    a binary blob + `Content-Disposition`.

### Added

- **`commissionBasePrice` on `TariffDetailItem`** (`GET .../commission-tariffs/{tariffId}`) — Nullable
  decimal string carrying the Excel's "KOMİSYONA ESAS FİYAT" (the customer-seen price commission is
  charged on; lower than the sale price when the product is discounted). The import now reads this
  column, and the current-scenario profit (`currentNetProfit` / `currentMarginPct`) is computed on
  THIS price rather than the sale price (`currentPrice`). `null` for tariffs imported before the
  column was read — the compute then falls back to `currentPrice`, and a re-import backfills it.
  Non-breaking additive field.

- **Plus Commission Tariffs API** (`/v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs`)
  — Sibling of the commission-tariffs endpoints for Trendyol's "Plus Komisyon" Excel. Seven routes:
  `GET` (list), `POST /import` (multipart .xlsx → 201 with counts), `GET /{tariffId}` (detail with
  per-item CURRENT vs PLUS profit computed on read — the Plus deal is a reduced commission for
  dropping the price to the Plus ceiling), `PATCH /{tariffId}/selections` (boolean opt-in + optional
  custom price), `POST /{tariffId}/export` (byte-preserving re-uploadable .xlsx), `POST
  /{tariffId}/items/{itemId}/estimate` (custom-price what-if), `DELETE /{tariffId}`. Store-scoped +
  RLS; profit never stored. Simpler than the product tariff in its offer (a single reduced Plus
  commission per product, no band ladder), but shares its multi-period shape — see the "Plus
  commission tariffs are now multi-period" note under Changed for the current `periods[]` / bucketed
  export contract. NOTE: the export's exact opt-in cell format is pending vendor verification.

- **Flash Products API** (`/v1/organizations/{orgId}/stores/{storeId}/flash-products`) — Fourth
  campaign vertical, for Trendyol's "Flaş Ürünler" (Teklif Ürünleri) Excel. Routes: `GET` (list, with
  distinct-product / item / selected counts), `POST /import` (multipart .xlsx → 201 with counts — a
  row carries up to two flash OFFERS, a 24-hour and a 3-hour window each with its own price + window
  dates, and the same product spans several date rows), `GET /{listId}` (detail with per-scenario
  profit computed on read: the current baseline plus each present offer, `offer24` / `offer3`, with
  its window, `validity`, commission and profit), `PATCH /{listId}/selections` (chosen offer H24/H3
  XOR custom price — the mutual exclusion is now server-enforced, `422` `INVALID_SELECTION_XOR` when
  both are sent), `POST /{listId}/items/{itemId}/estimate` (custom-price what-if `price`, or
  `scenario: "current"` — `422` codes `PRICE_REQUIRED` / `INVALID_ESTIMATE_MODE` / `INVALID_CUSTOM_PRICE`),
  `POST /{listId}/export` (byte-preserving re-uploadable Trendyol .xlsx — writes each selected row's
  participation label into "Güncellenecek Fiyat": `24 Saat` / `3 Saat` / `Senin Belirlediğin Flaş
  Fiyatı`, plus the numeric custom price into "Senin Belirlediğin Flaş Fiyatı" on custom rows only;
  selections are per-row so a choice never bleeds onto another date row of the same product; single
  file, verbatim on zero selection, marks the list exported; `409` when no source file was kept —
  fixed ASCII filename `flas-urunler.xlsx`), `DELETE /{listId}`. Store-scoped + RLS; profit never
  stored. The vertical's novelty: an offer has NO commission in the Excel — the reduced rate is
  resolved AUTOMATICALLY (no upload-time picker, unlike Advantage) from the store's Commission Tariff
  by the offer window's START (covering week → covering sub-period → barcode band), falling back to
  the flat "Mevcut Komisyon" rate with NO category fallback. Each detail item exposes
  `commissionSource` (`band` / `current`) and, on a band, `commissionBands` (the ladder for the ⓘ
  popover). NOTE: the exact J/M participation label casing is pending a live vendor round-trip.

### Removed

- **`returnScenarioNetProfit` (order list + `ProfitBreakdown`) and `returnScenarioMarginPct`
  (`ProfitBreakdown`)** — The deterministic "if fully returned" profit-scenario fields were
  removed from the `OrderListItem` and `ProfitBreakdown` schemas (feature dropped). Clients no
  longer receive these keys. The backing `Order.estimatedReturnScenario*` columns and the
  profit-engine `computeReturnScenario` were removed as well.

### Added

- **`imageUrl` on `TariffDetailItem`** (`GET .../commission-tariffs/{tariffId}`) — Nullable string
  carrying the barcode-matched catalog product's position-0 image, so the tariff detail rows can
  show the same product thumbnail as the products screen. `null` for items with no matched product
  (or a matched product that has no image). Non-breaking additive field.

- **`POST /v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}/items/{itemId}/estimate`**
  — Computes the full profit breakdown for one tariff item at a given `price` (body `{ price,
  bandKey? }`), reusing the same profit engine + resolvers (cost, shipping, fee definitions) the
  detail view uses — so an estimate at a band's price equals that band's profit in the detail
  response. Two modes: pass `bandKey` to use that band's commission verbatim (the band-click
  breakdown modal, exact even on touching band boundaries), or omit it to derive the band from the
  price (the custom-price what-if). Read-only (`DATA_READ`; POST only because it carries a body).
  Returns `{ itemId, price, bandKey, commissionPct, calculable, reason, breakdown }` where
  `breakdown` is the shared `QuoteBreakdown` (GROSS decimal strings) or `null` when the item is
  unmatched / uncostable (`reason` explains). `404` for an item not in this tariff/store; `422`
  (`INVALID_CUSTOM_PRICE`) for a malformed price.

- **`POST /v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/import`** — Imports
  Trendyol's "Ürün Komisyon Tarifeleri" `.xlsx` (multipart `file`). The fixed-layout sheet is
  read by position (its `1.KOMİSYON`..`4.KOMİSYON` headers repeat per period, so header matching
  cannot disambiguate them); each present period (3-day / 4-day) becomes a period and each product
  row joins to a `ProductVariant` by barcode. Persists one tariff with its periods + product rows;
  profit is computed later, on read. Returns counts `{ tariffId, productCount, periodCount,
  itemCount, matched, unmatched, skippedRows }`. Store-scoped (`DATA_WRITE`). A file whose header
  layout does not match the expected export → `422 VALIDATION_ERROR` (`INVALID_TARIFF_FORMAT`).
  (Engine note: `@pazarsync/spreadsheet` now strips a bogus single-cell `<dimension>` that
  Trendyol writes, which otherwise made the reader drop every data row.)

- **`POST /v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}/export`** —
  Returns Trendyol's ORIGINAL uploaded file (kept at import) with the seller's choices patched in:
  the chosen band price into "YENİ TSF (FİYAT GÜNCELLE)" and "{N} Günlük Fiyat" into "Tarife
  Seçimi" for every selected product. Every other cell is byte-for-byte unchanged, so the file is
  re-uploadable to Trendyol verbatim. Marks the tariff exported. Store-scoped (`DATA_WRITE`);
  returns the `.xlsx` (`Content-Disposition: attachment`). `409` if no source file was stored.
  (The import now reads the tariff layout by HEADER, not fixed positions, so it handles any period
  count — 1-period (27-col), 2-period (35-col), … — and the column shift that comes with it.)

- **`PATCH /v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}/selections`** —
  Persists the seller's chosen band (`band1`..`band4`, or null) and optional custom price per
  item, in a single bulk update scoped to the tariff (items from another tariff/store are
  ignored). Selection runs client-side over the backend-computed margins; this records the
  result. Store-scoped (`DATA_WRITE`). Returns `{ updated }`.

- **`GET /v1/organizations/{orgId}/stores/{storeId}/commission-tariffs`** — Lists saved
  commission-tariff uploads for a store (master list): per tariff `name`, `productCount`,
  `selectedCount`, `exported`, overall `validity` (`active`/`upcoming`/`past`, or null when
  period dates are unparseable) and `updatedAt`. Store-scoped (`requireStoreAccess`,
  `DATA_READ`); newest first.

- **`GET /v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}`** — Returns
  one tariff with its periods and, per product row, the four price bands with `netProfit` and
  `marginPct` **computed on read** by the profit engine. The commission comes from the Excel
  band; everything else (cost, shipping, PSF, stoppage, VAT) reuses the Ürün Fiyatlandırma
  resolvers. Profit is never stored. When a row cannot be costed, `calculable=false`, `reason`
  (`NO_PRODUCT`/`NO_COST`/`NO_SHIPPING`) explains why and band profits are null. `bestBandKey`
  marks the most profitable band. Money is GROSS decimal strings. A cross-store/org id → `404`.

- **`DELETE /v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}`** — Hard
  deletes a tariff and (via cascade) its periods + items. Store-scoped (`DATA_WRITE`); a
  cross-store id returns `404`, indistinguishable from missing. `204` on success.

- **`GET /v1/organizations/{orgId}/stores/{storeId}/profit-settings`** — Returns the resolved
  per-store profit-formula toggles (`ProfitSettings`: `includeStopaj`, `includeNegativeNetVat`),
  with defaults applied (`includeStopaj=true`, `includeNegativeNetVat=false`). Store-scoped: the
  lookup filters by `(id, organizationId)`, so a cross-org store id returns `404 NOT_FOUND`.
  Readable by any org member with access to the store (`requireStoreAccess`).

- **`PATCH /v1/organizations/{orgId}/stores/{storeId}/profit-settings`** — Shallow-merges a partial
  `UpdateProfitSettingsInput` (`includeStopaj?`, `includeNegativeNetVat?`) into the store's JSONB blob
  (only supplied keys change). Gated to OWNER/ADMIN (`STORES_CONFIGURE`) → `403 FORBIDDEN` otherwise.
  SNAPSHOT-AT-CREATE: the change only affects orders created afterwards; existing orders keep their
  stored profit values (no recompute). Defined types: `ProfitSettings`, `UpdateProfitSettingsInput`.

- **`GET /v1/me/preferences`** — Returns the authenticated user's preferences blob (`{}`
  for new users). User-scoped: always returns the calling user's own row. Supports
  `marginColoring` (threshold-based margin color scale, opt-in).

- **`PATCH /v1/me/preferences`** — Shallow-merges a partial `Preferences` object into the
  stored blob (only supplied top-level keys are overwritten). Body validated by
  `PreferencesSchema`: `marginColoring.buckets` must be 2–8 entries with strictly ascending,
  unique thresholds; returns `422 VALIDATION_ERROR` otherwise. Scoped to the JWT subject —
  no caller-supplied id is accepted. Defined types: `MarginBucket`, `MarginColoring`, `Preferences`.

- **`GET /v1/organizations/{orgId}/stores/{storeId}/orders`** — liste öğelerine (`OrderListItem`)
  `profitExcludedAt` (nullable datetime) ve `profitExclusionReason` (nullable enum:
  `COST_DEADLINE_MISSED` / `LATE_UNCOSTED_ARRIVAL` / `LEGACY_BACKFILL`) alanları eklendi. "Kâr Hesabı
  Dışı" sekmesinde her satırın dışlanma sebebini + tarihini göstermek için (daha önce yalnız sipariş
  detayında vardı). Hesaplanan siparişlerde her ikisi de null. Ek alanlar geriye dönük uyumludur.

- **`GET /v1/organizations/{orgId}/stores/{storeId}/orders/{orderId}`** — `profitBreakdown` nesnesine mikro
  ihracat ücret alanları eklendi: `internationalServiceGross` / `internationalServiceVat` (Uluslararası
  Hizmet Bedeli, PSF yerine) ve `overseasReturnOperationGross` / `overseasReturnOperationVat` (Yurt Dışı
  İade Operasyon Bedeli). Normal (non-micro) siparişlerde tümü `"0.00"` döner; değerler backend'de
  hesaplanır (`buildProfitBreakdown`), frontend yalnızca render eder. Ek alanlar geriye dönük uyumludur.

- **`GET /v1/organizations/{orgId}/stores/{storeId}/orders`** — liste öğelerine `costMarkupPct` (ROI =
  kâr / Σ maliyet brüt × 100, consumed: `settled ?? estimated`) alanı eklendi; yeni `lossOnly` sorgu
  parametresi yalnız consumed net kârı negatif siparişleri döndürür ("sadece zararlı" hızlı filtresi).

- **`GET /v1/organizations/{orgId}/stores/{storeId}/orders/summary`** — yeni KPI özet ucu. Liste ile aynı
  filtreleri (status / reconciliationStatus / tarih / `q` / `costStatus` / `lossOnly`) onurlandırarak
  `totalRevenueGross`, `netProfitGross` (consumed), `avgMarginPct` ve `lossOrderRate`
  ({lossCount, totalCount, pct}) döndürür. Sayfalama/sort kabul etmez; tüm finansal değerler backend'de hesaplanır.

- **`GET /v1/organizations/{orgId}/stores/{storeId}/product-pricing`** — org+store kapsamlı ürün fiyatlandırma
  listesi: her onaylı `ProductVariant` için mevcut satış fiyatı, birim net kâr (`netProfit`), satış marjı
  (`saleMarginPct`) ve maliyet markup'ı (`costMarkupPct`) backend'de hesaplanarak döner. Maliyet, komisyon
  veya kargo tahmini eksik olan varyantlar `calculable: false` ile listelenir; eksiklik `costStatus` /
  `commissionStatus` / `shippingEstimateStatus` alanlarıyla raporlanır. Tüm finansal değerler backend'de
  hesaplanır, frontend yalnızca render eder. Sayfalama ve metin arama (`q`) desteklenir. (Dilim 2.5
  genişletmesi — aşağıda)

- **`GET /v1/organizations/{orgId}/stores/{storeId}/product-pricing`** — Dilim 2.5: liste endpoint'i
  sunucu tarafında genişletildi. Yeni sorgu parametreleri:
  - `profitStatus` (`profitable` / `breakeven` / `loss` / `all`, varsayılan `all`) — net kâra göre
    sunucu bellekte filtreler (kârlı: `netProfit > 0`, başabaş: `= 0`, zararlı: `< 0`).
  - `marginMin` / `marginMax` (ondalıklı string, negatife izin verilir) — satış marjı (`saleMarginPct`)
    aralığı filtresi.
  - `categoryId` / `brandId` (rakam string) — SQL düzeyinde kategori ve marka filtresi.
  - `sortBy` — yeni sıralama seçenekleri: `netProfit:asc|desc`, `saleMarginPct:asc|desc`,
    `costMarkupPct:asc|desc`; mevcut `salePrice:asc|desc` ve `title:asc|desc` korunur. Hesaplanamayanlar
    (null kâr/marj) her iki yönde de sona düşer.
  Yeni yanıt alanları (`ProductPricingItem` başına): `imageUrl` (ürünün ilk görselinin URL'i, nullable),
  `cost` (ondalıklı string, nullable), `categoryId` / `categoryName` / `brandId` / `brandName`
  (nullable). Kâr her istekte bellekte hesaplanır — kalıcı yazma yoktur. `total` filtreli küme sayısını
  yansıtır (tümü bellekte toplanır). Additive, geriye dönük uyumlu.

- **`POST /v1/organizations/{orgId}/stores/{storeId}/product-pricing/quote`** — tek bir varyant için
  hedef marj, markup veya kâr değerinden geriye çözülen satış fiyatını hesaplar. İstek gövdesi:
  `{ variantId, target: { type: 'margin' | 'markup' | 'profit', value: string } }`. Maliyet eksik ise
  `{ calculable: false, reason: 'NO_COST' }` döner; hedef erişilemez ise `reason: 'UNREACHABLE_TARGET'`.
  Kalıcı yazma yoktur; yetki `DATA_READ` yeterlidir.

- **`POST /v1/organizations/{orgId}/stores/{storeId}/product-pricing/price`** — bir varyantın yeni
  satış fiyatını Trendyol'a **gerçekten yazar** (canlı, geri alınamaz — Trendyol barkod başına günde
  yalnızca bir fiyat değişikliğine izin verir). İstek gövdesi: `{ variantId, salePrice }` (salePrice
  KDV-dahil, pozitif ondalık string). Yalnızca **OWNER/ADMIN** çağırabilir; MEMBER/VIEWER `403 FORBIDDEN`
  alır. Her çağrı `PriceChangeLog` denetim tablosuna kaydedilir (kim, hangi varyant/barkod, eski→yeni
  fiyat, batchId, sonuç). Akış: fiyat Trendyol'a gönderilir → `batchId` alınır → kısa, sınırlı bir
  pencerede sonuç yoklanır. Onaylanan başarıda yerel `ProductVariant.salePrice` güncellenir ve
  `{ status: 'SUCCESS', variantId, newSalePrice, batchId }` döner; pencere içinde onay gelmezse yerel
  fiyat **değiştirilmez** ve `{ status: 'PENDING', ... }` döner (değişiklik Trendyol tarafında daha sonra
  uygulanabilir). Trendyol kalemi reddederse `422 MARKETPLACE_WRITE_FAILED` (`meta.errorCode` satıcıya
  dönen ham hata kodunu taşır). Kimlik bilgileri yalnızca bellekte çözülür, asla loglanmaz. Yeni hata
  kodu: `MARKETPLACE_WRITE_FAILED` (422).

- **`GET /v1/organizations/{orgId}/stores/{storeId}/orders`** ve
  **`GET /v1/organizations/{orgId}/stores/{storeId}/live-performance/orders`** — liste/canlı satırlarına
  yeni `promotionDisplays` (`{ displayName, amountGross }[] | null`) alanı: sipariş alımında yakalanan
  satıcı-indirimi promosyon adları + brüt (KDV-dahil) tutarları. İndirim/promosyon yoksa `null`
  (canlı buffer satırlarında her zaman `null`). Liste ve canlı satırlarında indirimli siparişi
  işaretleyen gürültüsüz rozet/tooltip'i besler; sipariş detayındaki kâr dökümüyle aynı veridir.
  **Frontend yalnızca render eder, türetmez.** (GROSS Faz 2)

- **`GET /v1/organizations/{orgId}/stores/{storeId}/orders`** — liste satırlarına yeni
  `saleMarginPct` (`string | null`) alanı: backend-hesaplı satış marjı `settledSaleMarginPct ??
  estimatedSaleMarginPct` (kâr / satış brüt × 100). Sipariş listesindeki yeni "Marj %" sütununu
  besler; **frontend yalnızca render eder, türetmez**. Ayrıca `sort` query parametresi eklendi:
  `-orderDate` (varsayılan, en yeni önce), `marginPct` / `-marginPct` (marj sütunu artan/azalan;
  `Order.estimatedSaleMarginPct` üzerinden sıralar, null marjlar her iki yönde de sona düşer).
  (GROSS Faz 2)

- **`GET /v1/organizations/{orgId}/stores/{storeId}/orders/{orderId}`** — yeni `profitBreakdown`
  alanı (`ProfitBreakdown | null`). Berkin'in otoritatif kâr formülünü (Satış − Maliyet −
  Komisyon − Kargo − PSF − Stopaj − Net KDV = Kâr) ekrana koymak için backend-hesaplı brüt
  (KDV-dahil) toplamlar + Net KDV kırılımı. Değerler `buildProfitBreakdown` (packages/profit) +
  persist edilen `Order.estimatedNetVat`. profit-excluded / maliyet-eksik siparişte `null`.
  **Frontend hiçbir finansal değeri türetmez** — backend hesaplar+kaydeder+servis eder.

- **`GET /v1/organizations/{orgId}/stores/{storeId}/orders/{orderId}`** — `profitBreakdown`
  nesnesine iade senaryosu alanları eklendi: `returnScenarioNetProfit` (`string | null`) ve
  `returnScenarioMarginPct` (`string | null`). "Tam iade gelirse kâr" deterministik senaryosu —
  `Order.estimatedReturnScenarioNetProfit` / `estimatedReturnScenarioMarginPct` alanlarından
  servis edilir. Zaten iade olan siparişlerde, kâr-dışı siparişlerde ve hesaplanamaz senaryolarda
  `null` döner. Backend-hesaplanır ve kaydedilir; frontend yalnızca render eder. Additive,
  geriye dönük uyumlu.

- **`GET /v1/organizations/{orgId}/stores/{storeId}/orders`** — liste öğelerine (`OrderListItem`)
  `returnScenarioNetProfit` (`string | null`) alanı eklendi: sipariş listesi tablosundaki yeni
  "İade senaryosu kârı" sütununu besler. `Order.estimatedReturnScenarioNetProfit` alanından
  servis edilir; zaten iade olan/kâr-dışı siparişlerde `null`. Backend-hesaplanır ve kaydedilir;
  frontend yalnızca render eder. Additive, geriye dönük uyumlu.

### Removed

- **`PATCH /v1/organizations/{orgId}/stores/{storeId}/orders/{orderId}/items/{itemId}/cost`** —
  late per-item cost entry is gone (spec 2026-06-12, decision K2): the ONLY cost window is the
  order's business day (buffer + product-level cost-profile attach). Orders persist either
  CALCULATED or permanently profit-EXCLUDED. (#322)

### Changed

- `GET .../live-performance/today-products` — unresolved barcodes are no longer dropped:
  the row falls back to barcode identity (`unresolved: true`, `variantId: null`, nullable
  name/stockCode/thumb). Closes the "1 order today but empty product list" inconsistency. (#324)

- `GET /v1/organizations/{orgId}/stores/{storeId}/orders` — `costStatus` vocabulary:
  `pending` → `excluded` (filter is now `profit_excluded_at IS NOT NULL`); `counts` is
  `{ calculated, excluded }`. There is no "pending" order state anymore — orders persist
  CALCULATED or EXCLUDED (spec 2026-06-12). Detail gains `profitExcludedAt` +
  `profitExclusionReason`. (#322)

### Added

- **`GET /v1/organizations/{orgId}/stores/{storeId}/claims`** — paginated return-claims list
  with status tab counts and derived per-row fields (`derivedStatus`, `scope`, product/reason
  summaries). Feeds the new `/returns` page. (#295)
- **`GET /v1/organizations/{orgId}/stores/{storeId}/claims/summary`** — returns-KPI strip:
  open/resolved counts plus the return trio's gross totals and `netImpactGross` for the period
  (default last 30 days; counts on `claimDate`, financials on `OrderFee.capturedAt`). (#295)
- **`GET /v1/organizations/{orgId}/stores/{storeId}/live-performance/kpis`** — today vs. yesterday KPI summary. Volume (revenue, order count, units sold) is aggregated over the whole business-day universe (`orders` ∪ today's cost-missing buffer); net profit, margin (÷ costed revenue), and profit/cost ratio (÷ costed cost) over the costed subset only (`orders` with a non-null estimate); plus `pendingRevenueToday` / `pendingOrderCountToday` = today's universe − costed (the gap awaiting cost). Store-scoped (`requireStoreAccess`); money values are Decimal strings, counts are ints. (Live Performance — Slice A)
- **`GET /v1/organizations/{orgId}/stores/{storeId}/live-performance/chart`** — hourly cumulative **revenue + net-profit** curves for today and yesterday (24 business-hour buckets), for the dual-mode (ciro/kâr) intraday chart toggled client-side. Today's revenue includes the cost-missing buffer; profit is the costed subset. (Live Performance — Slice A)
- **`GET /v1/organizations/{orgId}/stores/{storeId}/live-performance/today-products`** — every product variant that sold today, one row per barcode, merged over the business-day universe (`orders` ∪ today's cost-missing buffer). Reports distinct `orderCount`, `unitsSold`, `revenue` (all known without cost), a `costStatus` (`costed` if the variant has an active cost profile, else `missing`) and the costed net `unitCost` (from the order-item snapshot). No per-product profit. Store-scoped (`requireStoreAccess`); money values are Decimal strings, counts are ints. Supersedes the removed `missing-cost` + `top-products` endpoints. (Live Performance — Slice B)
- **`GET /v1/organizations/{orgId}/stores/{storeId}/live-performance/orders?filter=all|calculated|pending`** — today's order feed unioning the calculated orders table with the cost-missing buffer, each row tagged by `source`; `counts` reports every tab's total. All business-day windows resolve through the single app business timezone helper (`@pazarsync/utils`).
- `POST /v1/webhooks/orders/:storeId` — Trendyol order status webhook receiver. Per-store endpoint authenticated via store-scoped Basic Auth (Trendyol HMAC desteklemiyor — `Authorization: Basic <base64(user:pass)>`). Idempotent via composite `(storeId, platformOrderId, status, lastModifiedDate)` `WebhookEvent` unique constraint. Mounted **before** the global Bearer JWT auth middleware. Status mapping: 13 Trendyol statuses → 6 PazarSync `OrderStatus` (Order Sync design §2b); unknown statuses log + 200 without touching `Order.status` (forward-compat). `createdBy === 'transfer'` overrides status to `CANCELLED` per `webhook-model.md`. Errors: 401 (auth) / 404 (store / disabled) / 422 (payload) / 5xx → Trendyol retries every 5 min.
- `POST /v1/organizations/:orgId/stores/:storeId/webhook/rotate-secret` — manual rotation of the Trendyol webhook Basic Auth credential. Generates a fresh credential pair, calls Trendyol PUT `/webhooks/:id` (or POST `/webhooks` for first-time activation when `Store.webhookId` is null), persists the new AES-256-GCM blob, and bumps `Store.webhookActiveAt`. The old credentials are rejected immediately. OWNER/ADMIN only. Use case: leak suspicion, audit, or one-shot retry after a failed connect-time register.
- **`GET /v1/organizations/{orgId}/stores/{storeId}/live-performance/buffer/{bufferId}`** — enriched detail for a cost-missing buffer entry. Each line carries product name + thumbnail + variant id (barcode → `ProductVariant` lookup, falling back to the barcode when unresolved); no fees/profit (none exist until the order graduates). Store-scoped (`requireStoreAccess`); money values are Decimal strings. (Live Performance — Slice C)
- **`PATCH /v1/organizations/{orgId}/stores/{storeId}/orders/{orderId}/items/{itemId}/cost`** — set a **frozen** per-item cost snapshot from a saved cost profile (`{ source: 'profile', profileId }`) or a manual NET amount + VAT rate (`{ source: 'manual', netAmount, vatRate }`), then recompute the order estimate once all items are costed. Write-once: an already-costed item → 409 `CONFLICT`; unknown/archived profile → 422 `INVALID_REFERENCE`. Writes only the snapshot columns (no `OrderFee`). Store-scoped (`requireStoreAccess`); money values are Decimal strings. (Live Performance — Slice C)
- **`LiveOrderRow`** gains `orderId` / `bufferId` (nullable) — the identity bridge so the live feed can deep-link a row to its in-page detail (orders → `orderId`, buffer → `bufferId`). (Live Performance — Slice C)
- **`GET /v1/organizations/{orgId}/stores/{storeId}/live-performance/notification-summary?source=orders|buffer&id=<uuid>`** — canonical revenue/profit summary for a realtime new-order toast. Returns `revenue` (sale subtotal net), `profit` (estimated net profit; null when cost is pending), `costStatus` (`costed`/`pending`), and `isToday` (so the global notifier drops backfills/historical inserts). Store-scoped (`requireStoreAccess`); cross-tenant id → 404; money values are Decimal strings. (Live Performance — Slice D)

### Removed

- **`GET .../live-performance/missing-cost`** and **`GET .../live-performance/top-products`** — consolidated into the single `today-products` endpoint above (every product that sold today, one row per barcode, cost-status flagged inline). (Live Performance — Slice B)

### Changed

- `GET /v1/organizations/{orgId}/stores/{storeId}/orders/{orderId}` — `items[]` gains
  `barcode` (nullable): the vendor barcode is the only product trace on an unmatched line
  (`productVariantId` null) until variant resolution links it. (#315)
- `POST /v1/webhooks/orders/:storeId` — behavior only: an order line whose barcode resolves
  to no variant no longer hard-skips the whole order. The order now routes through the
  cost-missing path (today → live-performance buffer; past-day → persisted with null profit;
  the unmatched line keeps its barcode with a null variant FK). The `orders.skipped`
  log event is gone. No wire-shape change. (#311)
- `POST /v1/organizations/:orgId/stores` — a successful connect now also bootstraps the
  initial sync chain: four PENDING `sync_logs` rows enqueued in priority order
  (PRODUCTS → ORDERS → SETTLEMENTS → CLAIMS, FIFO via staggered `started_at`), so the
  seller's data starts flowing immediately instead of waiting for the first cron tick.
  Best-effort/non-blocking like webhook registration — an enqueue failure never fails the
  connect; the cron fan-outs re-enqueue with the same dedupe guard. No wire-shape change.
- `GET /v1/organizations/{orgId}/stores/{storeId}/orders/{orderId}` — description only: the `claims` array is no longer "empty until PR-13"; it is populated by the new CLAIMS sync worker (6h cadence, 60-day creation-date window, Trendyol getClaims). No wire-shape change — `OrderClaimDetail`/`OrderClaimItemDetail` schemas were already final. (PR-13)
- `GET /v1/organizations/{orgId}/stores/{storeId}/orders/{orderId}` — `fees[].feeType` enum domain gains `COST_RETURN`: a CREDIT leg the settlement Return handler books from the returned unit's cost snapshot (the unit went back to stock, so its cost never materialized — product decision 2026-06-10). Emitted alongside `REFUND_DEDUCTION` + `COMMISSION_REFUND` per Trendyol Return row. (#291/#296)
- `GET /v1/organizations/{orgId}/stores/{storeId}/orders` — new optional `costStatus` query param (`calculated` | `pending`) filtering on `estimatedNetProfit IS [NOT] NULL`, and a new `counts: { calculated, pending }` field in the response. Counts honor the sibling filters (status/reconciliationStatus/from/to/q) but ignore `costStatus`, so both segment tabs show honest totals.
- `POST /v1/organizations/:orgId/stores` — successful TRENDYOL + PRODUCTION connects now also register a Trendyol webhook subscription (best-effort, non-blocking on failure). `Store.webhookId/Secret/ActiveAt` are populated on success; failures leave them null so the UI can surface a "webhook bağlı değil" badge and the user can rotate to retry.
- `DELETE /v1/organizations/:orgId/stores/:storeId` — disconnect now also calls Trendyol DELETE `/webhooks/:id` (best-effort) before the local cascade delete, freeing the 15-webhook-per-seller cap (`webhook-model.md`). Failure does not block the local delete.

### Added

- ADD: `GET /v1/organizations/:orgId/shipping-carriers` — list shipping carriers
- ADD: `GET /v1/organizations/:orgId/shipping-carriers/:carrierId/tariffs` — get a carrier's desi-bazlı (NORMAL) tariff plus its Barem desteği tier table when supported. Org-scoped (membership-gated) but the tariff data is platform-wide reference. Returns 404 when the carrier id is unknown or inactive.
- ADD: `GET /v1/organizations/:orgId/stores/:storeId/shipping-config` — get store's shipping config
- ADD: `PATCH /v1/organizations/:orgId/stores/:storeId/shipping-config` — update carrier/source (OWNER/ADMIN gated)
- ADD: `GET /v1/organizations/:orgId/stores/:storeId/own-shipping-tariff` — list own contract tariff rows (V1 always empty)
- CHANGE (BREAKING): `GET /v1/organizations/:orgId/stores/:storeId/shipping-config` and `PATCH ...` no longer return `defaultShippingCarrierId` at the top level. The full carrier (with id) lives in `defaultShippingCarrier`. Clients should read `defaultShippingCarrier?.id`. Input shape (`UpdateShippingConfigInput`) is unchanged.
- CHANGE: `GET /v1/organizations/:orgId/stores/:storeId/products` per-variant response now includes `estimatedShippingNet`, `shippingCarrierCode`, `shippingTariffApplied`, `shippingEstimateStatus` — computed inline by a raw-SQL CTE that mirrors `estimateShippingCostForVariant` (canonical algorithm in `apps/api/src/services/shipping-estimator.service.ts`). Additive, non-breaking. See spec §5.4 / §6.2 in `docs/superpowers/specs/2026-05-17-shipping-cost-estimation-design.md`.
- **`GET /v1/organizations/{orgId}/stores/{storeId}/commission-rates`** — new
  endpoint exposing the imported Trendyol commission tariff for the panel UI.
  Required query: `ruleKind` (`CATEGORY` | `CATEGORY_BRAND`). Optional: `q`
  (substring match across `categoryName` / `parentCategoryName` / `brandName`),
  `productScope` (`all` default; `active` filters to (categoryId, brandId)
  combinations the store actually sells — approved Product with at least one
  non-archived variant), `sort` (`category_name:asc` default; `base_rate:asc` /
  `base_rate:desc` / `product_count:desc`), `cursor`, `limit` (default 50, max
  100). Response includes a `productCount` field per row (count of approved
  non-archived products in the store for that category / category+brand pair).
  `product_count:desc` requires `productScope=active` (returns 422
  `INVALID_SORT_FOR_SCOPE` otherwise — the unbounded path would materialize
  the full 135K-row set in memory). Sort-aware cursor: reusing a cursor with
  a different sort returns 422 `CURSOR_SORT_MISMATCH`. Cross-org store id
  returns 404 (no existence leak).
- `GET /v1/organizations/{orgId}/stores/{storeId}/products`
  - New optional query param `overrideMissing: 'cost' | 'vat'` — variant-level filter for products with at least one variant missing the corresponding override field. Composes with `status` via AND.
  - Sort vocabulary widened with `salePrice` / `-salePrice` / `totalStock` / `-totalStock`. `salePrice` currently falls back to `platformModifiedAt` (documented limitation pending `Product.minSalePrice` / `maxSalePrice` denormalization); `totalStock` sorts on the new `Product.totalStock` column.
- `GET /v1/organizations/{orgId}/stores/{storeId}/products/facets`
  - New required field `overrideCounts: { missingCost: number; missingVat: number; total: number }`. Counts are computed against the unfiltered store-scoped set.
- **`SyncLogResponse.skippedPages`** (array | null) — pages the worker
  skipped after exhausting MAX_ATTEMPTS on a `MARKETPLACE_UNREACHABLE`
  error. Each entry: `{ page, attemptedAt, errorCode, httpStatus,
xRequestId?, responseBodySnippet? }`. Surfaces deterministic upstream
  5xx-on-a-single-page failures (real-world: a corrupted seller record
  at a specific Trendyol catalog offset that crashes their serializer
  every time we hit it). Worker now advances past the bad page instead
  of terminally failing the whole sync; the SyncCenter UI shows a
  "X sayfa atlandı" warning chip on `COMPLETED` rows when the array is
  non-empty. `null` when no pages were skipped (the typical case).
  Additive, non-breaking.
- **`SyncLogResponse.organizationId`** (uuid, required) — the tenant id is
  now surfaced on every sync-log row returned by the org-scoped and
  store-scoped sync endpoints. Lets the web client's in-memory
  reconstruction of a `SyncLog` from a Realtime `postgres_changes` event
  carry tenant identity through the cache. Defense-in-depth: the
  Realtime channel's `organization_id=eq.<orgId>` filter still gates
  rows server-side, so this is purely additive — no client behavior
  depends on it today, but a future refactor that drops the filter
  would silently lose tenant identity without it. Additive,
  non-breaking.

### Changed

- **`ProductWithVariants.variantCount` semantic changed: now matches
  `variants[].length` instead of returning the unfiltered DB total.**
  Under a `status` filter, both `variants[]` and `variantCount` reflect
  the filtered set, so UI consumers (variant count chip, Beden chip
  overflow, expand affordance) can never disagree. Trendyol's seller
  panel uses the same "what you see is what you count" semantic. The
  earlier total-count contract surfaced phantom variants in our count
  chip — e.g. a product with 2 onSale + 2 archived variants showed
  "4 varyant" on the onSale tab but expanded to only 2 sub-rows. **Wire-
  level breaking change** for callers that read `variantCount` to know
  "how many variants exist beyond this filter"; that need is rare and
  can be served by issuing a second unfiltered request. The validator's
  `variantCount` description on `/v1/organizations/:orgId/stores/:storeId/products`
  documents the new contract.
- **`GET /v1/organizations/:orgId/stores/:storeId/products` default sort
  changed from `-platformModifiedAt` to `-platformCreatedAt`** — newest
  listings first, matching the Trendyol seller-panel ordering (Trendyol's
  upstream `/products/approved` exposes the same notion via
  `orderByDirection: SellerCreatedDate, DESC`). The sort vocabulary gains
  `platformCreatedAt` / `-platformCreatedAt` as new options. NULL
  `platformCreatedAt` rows (legacy syncs from before the column was
  populated) sort to the end via `nulls: 'last'`. **Wire-level breaking
  change** for callers that explicitly relied on the previous default;
  existing callers passing `sort=-platformModifiedAt` continue to work
  unchanged. The frontend nuqs default and the `tanstackToSort` fallback
  in `apps/web/src/features/products/components/products-table.tsx` were
  updated in lockstep.
- **`POST /v1/organizations/:orgId/stores/:storeId/products/sync` response
  shape** — sync trigger now returns `{ syncLogId, status: 'PENDING',
enqueuedAt }` instead of the prior `{ syncLogId, status: 'RUNNING',
startedAt }`. The endpoint became a thin enqueue (INSERT `PENDING` + 202) once the worker process took over execution; `status` reflects
  the row's actual state at insertion time, and the timestamp field was
  renamed to match. The 409 `SYNC_IN_PROGRESS` body now includes
  `meta.existingSyncLogId` so the UI can navigate to the live run when a
  duplicate trigger is rejected. **Wire-level breaking change**, but the
  PazarSync frontend already treats `PENDING` and `RUNNING` as
  interchangeable "active" states, so no UX regression. Released as part
  of the sync-engine v2 architecture migration (see
  `docs/plans/2026-04-27-sync-engine-architecture-implementation.md`).
- `SyncLogResponse.status` enum widened from `'RUNNING' | 'COMPLETED' | 'FAILED'`
  to `'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'FAILED_RETRYABLE'`.
  Schema-only — `PENDING` and `FAILED_RETRYABLE` are reserved for the
  worker-based pipeline (see
  `docs/plans/2026-04-27-sync-engine-architecture-implementation.md`)
  and never appear on the wire today; existing flows continue to emit
  `RUNNING` / `COMPLETED` / `FAILED`. **Backwards compatible** — clients
  that switch on the legacy three values keep working; new values land in
  PR 4 of the sync-engine migration.
- `SyncLogResponse` gains a `storeId` field (UUID). Required by the new
  org-scoped sync-logs endpoint so the dashboard SyncCenter can group
  rows by store across the organization; redundant on store-scoped
  endpoints where the caller already knows the storeId from the URL.
  **Backwards compatible** — additive field, no existing field changed.
- `SyncLogResponse` gains `attemptCount` (int, default 0) and
  `nextAttemptAt` (ISO8601 datetime, null on non-FAILED_RETRYABLE rows).
  Both already exist on the DB column set (PR #61) but weren't on the
  wire. Required by the SyncCenter "Yeniden deneniyor" section so users
  can see when a row in retry backoff will next be claimed and which
  attempt the worker is on (max 5 before terminal FAIL). **Backwards
  compatible** — additive fields, no existing field changed.

### Added

- `GET /v1/organizations/:orgId/sync-logs` — org-scoped twin of the
  store-scoped sync-logs endpoint. Returns RUNNING / PENDING /
  FAILED_RETRYABLE active + last 5 finished across every store the
  caller can see. Powers the dashboard-shell SyncBadge so any active
  sync surfaces to every authenticated org member regardless of which
  page they're on. Optional `?active=true` query param omits recent
  finished rows. Backwards compatible — additive endpoint.
- `GET /v1/organizations` response is enriched with **four caller-scoped
  fields** per organization: `role` (caller's `MemberRole` on this org),
  `storeCount` (every status counted — ACTIVE, CONNECTION_ERROR, DISABLED),
  `lastSyncedAt` (`MAX(stores.last_sync_at)` aggregate; `null` if no store
  has synced yet), and `lastAccessedAt` (caller's
  `organization_members.last_accessed_at`; `null` if the caller has never
  switched into the org via `POST /:orgId/access`). Powers the redesigned
  org/store switcher's role badges, "X mağaza · son senkron N dk" meta,
  and recently-used pinning. **Backwards compatible** — fields are
  additive, all existing fields keep their shape.
- `POST /v1/organizations/:orgId/access` — records that the caller
  accessed this organization by setting
  `organization_members.last_accessed_at = NOW()`. Returns 204 on
  success, 404 when the caller is not a member of the requested org
  (existence non-disclosure — same response whether the org doesn't
  exist or just isn't visible to the caller). Called by the frontend
  org-store switcher so the next sign-in can resume the most-recently-
  used context.
- **Store connection (Trendyol Phase 1)** — four new endpoints under
  `/v1/organizations/:orgId/stores`:
  - `GET /stores` — list connected stores for the organization, most
    recent first. Response never includes `credentials`.
  - `POST /stores` — connect a marketplace account. Request body is
    `{ name, environment, credentials: { platform: 'TRENDYOL',
supplierId, apiKey, apiSecret } }`. Credentials are probed against
    Trendyol (cheapest product-filter endpoint) BEFORE persist — a
    failed probe leaves no DB row. Encrypted at rest with AES-256-GCM.
    Rate-limited at 5 requests/minute/user.
  - `GET /stores/:storeId` — single store. 404 on cross-tenant access.
  - `DELETE /stores/:storeId` — hard delete, cascades products/orders/
    settlements/sync_logs.
- Three new pan-app error codes:
  - `MARKETPLACE_AUTH_FAILED` (422) — credentials rejected by vendor.
  - `MARKETPLACE_ACCESS_DENIED` (422) — environment-specific access
    block (e.g. Trendyol sandbox IP whitelist missing).
  - `MARKETPLACE_UNREACHABLE` (503) — upstream 5xx / timeout.
- New validator-level error codes on `POST /stores`:
  `INVALID_SUPPLIER_ID_FORMAT`, `INVALID_API_KEY_FORMAT`,
  `INVALID_NAME_TOO_SHORT`, `INVALID_NAME_TOO_LONG`,
  `SANDBOX_NOT_ALLOWED`, `DUPLICATE_STORE_CONNECTION`.
- Store schema columns: `environment` (StoreEnvironment:
  PRODUCTION|SANDBOX), `externalAccountId` (unencrypted supplierId /
  merchantId), `status` (StoreStatus: ACTIVE|CONNECTION_ERROR|DISABLED),
  `lastConnectedAt`. Composite unique
  `(organization_id, platform, external_account_id)` enforces
  one-account-per-org.
- Every response now carries an `X-Request-Id` header. Value is either
  echoed from an inbound `X-Request-Id` header (so a client / gateway
  can supply its own correlation id) or generated server-side as a UUID
  v4. Error response bodies additionally embed the same id at
  `meta.requestId` via the RFC 7807 `ProblemDetails` schema — support
  tickets can quote this id to find the exact server log line. Generated
  by `requestIdMiddleware` in `apps/api/src/middleware/`, stamped into
  error bodies by `app.onError` + `problemDetailsForError({ requestId })`.

### Changed

- Global per-user rate limit of 300 req/min applies to every
  authenticated route via in-memory token-bucket middleware. Surfaces
  as `RATE_LIMITED` (429) with `Retry-After` header.

- `POST /v1/organizations` — creates an organization and attaches the
  authenticated caller as OWNER in a single Prisma transaction. Request
  body is `{ name: string }` (2–80 chars, must contain a letter/digit,
  blocklist of reserved names). Slug is auto-generated from the name
  via `slugify + collision retry`. Response includes the new org
  (id, name, slug, currency, timezone, timestamps) plus the membership
  record `{ role: "OWNER" }`. Error codes: `INVALID_NAME_TOO_SHORT`,
  `INVALID_NAME_TOO_LONG`, `INVALID_NAME_NO_ALPHANUMERIC`,
  `INVALID_NAME_RESERVED` (422), `UNAUTHENTICATED` (401).
- `GET /v1/me` — returns the authenticated user's profile
  (`id`, `email`, `timezone`, `preferredLanguage`, timestamps). Never
  404s: if the `user_profiles` row is missing (e.g., legacy user
  pre-trigger), the service upserts defensively from the JWT's email
  claim and returns 200.
- New columns on `user_profiles`: `timezone` (default `'Europe/Istanbul'`)
  and `preferred_language` (default `'tr'`). These drive viewer-side
  localisation of timestamps and UI language.
- New columns on `organizations`: `currency` (default `'TRY'`) and
  `timezone` (default `'Europe/Istanbul'`) for business-ops localisation
  (reporting period boundaries, sync windows, settlement day cuts) —
  distinct from per-user viewer timezone.
- Supabase `auth.users` AFTER INSERT trigger
  (`supabase/sql/triggers.sql`) auto-creates a matching `user_profiles`
  row on signup. SECURITY DEFINER so Supabase Auth's anonymous signup
  path can write into a table it doesn't own. Applied by
  `pnpm db:apply-policies` alongside the RLS file.
- Self-write RLS policies for `user_profiles`:
  `user_profiles_self_insert` and `user_profiles_self_update`
  (`WITH CHECK (id = auth.uid())`). Covers the defensive upsert path
  and the future account-settings screen.
- Extended tenant-isolation test matrix to cover `POST /v1/organizations`
  (a new org created by user A is invisible to user B).
- RLS tests extended to assert API-only-write invariants on
  `organizations` and `organization_members` (authenticated client
  cannot INSERT/UPDATE directly; writes must go through the Hono API
  via Prisma).

- Auth middleware chain. `authMiddleware` delegates to
  `supabase.auth.getUser(token)` to verify the Bearer token and sets
  `userId` + `email` on the request context. `orgContextMiddleware`
  verifies `OrganizationMember` for `:orgId` path params and sets
  `organizationId` + `memberRole`. SDK-delegated verification handles
  both HS256 and asymmetric (ES256/RS256) tokens transparently — the
  backend stays correct as Supabase migrates projects between signing
  modes.
- RFC 7807 error handler mapping `UnauthorizedError` → 401
  `UNAUTHENTICATED` and `ForbiddenError` → 403 `FORBIDDEN`. Unknown
  errors collapse to a generic 500 `INTERNAL_ERROR`.
- `createAuthenticatedTestUser` helper in
  `apps/api/tests/helpers/auth.ts` creates real Supabase Auth users via
  the admin API and returns a genuine access token. Replaces the
  hand-signed HS256 tokens used previously; tests now exercise the same
  verification path as production.
- `createApp()` factory in `apps/api/src/app.ts` — single source of
  truth for route registration, used by both the runtime entry and
  `scripts/dump-openapi.ts` (replaces the previous duplication).
- Row-Level Security policies on all 11 tenant-scoped tables
  (`user_profiles`, `organizations`, `organization_members`, `stores`,
  `products`, `orders`, `order_items`, `expenses`, `settlements`,
  `settlement_items`, `sync_logs`). Applied via `pnpm db:push` (which
  chains `pnpm db:apply-policies`). SELECT policies only in this phase
  — INSERT/UPDATE/DELETE default-deny until CRUD endpoints ship their
  own. Helper `is_org_member(uuid)` (SECURITY DEFINER) avoids the
  classic "infinite recursion detected in policy" trap.
- `createRlsScopedClient()` test helper in
  `apps/api/tests/helpers/rls-client.ts` — composes on
  `createAuthenticatedTestUser` and returns a Supabase JS client whose
  queries route through PostgREST with the authenticated role. Used in
  `tests/integration/rls/*.rls.test.ts` to prove each policy enforces;
  Prisma via `DATABASE_URL` bypasses RLS and cannot verify policies.
- Coverage test (`tests/integration/rls/coverage.rls.test.ts`) asserts
  every tenant-scoped table has RLS enabled + at least one SELECT
  policy. Forgetting a policy on a new table flips it red.

### Changed

- `GET /v1/organizations` now returns real organizations the
  authenticated user is a member of, ordered by name ascending.
  Replaces the previous stub payload. Responds `401 UNAUTHENTICATED`
  without a valid Bearer token.
- `/v1/health`, `/v1/openapi.json`, and `/v1/docs` remain public. All
  other routes under `/v1/*` now require a Bearer token.
- First live consumer of `/v1/organizations`: the Next.js frontend's
  dashboard OrganizationsPanel. No backend shape change — noting the
  integration so future response-shape edits are known to have a UI
  caller and require a coordinated frontend update.
- Frontend now has the full self-serve auth flow: sign in, sign up,
  email confirmation (via `/auth/callback`), forgot/reset password,
  sign out, and a global session-expired handler that drives 401
  responses into toast + redirect. No backend change — all flows
  terminate on Supabase Auth and backend-verified Bearer tokens.

### Deprecated

- (Mark endpoints scheduled for removal)

### Removed

- (Document removed endpoints / fields)

### Fixed

- `POST /v1/organizations` (and every future validated route) now emits
  RFC 7807 `ProblemDetails` with `code: 'VALIDATION_ERROR'` and a
  field-level `errors[]` array for Zod failures. Previously the route
  returned the library's default 400 shape — the documented `INVALID_NAME_*`
  codes lived only as Zod issue messages and never surfaced as
  `ProblemDetails.code`. Status also changes from **400 → 422** to match
  RFC 7807 semantics (400 reserved for shape-invalid bodies).

### Security

- (Document security-relevant changes)

## [1.0.0] — 2026-04-16

Initial release. API exposed under `/v1/`. Documentation served via Scalar at
`/v1/docs` (dev/staging only). Spec at `/v1/openapi.json`. Frontend consumes
via the `@pazarsync/api-client` workspace package.

### Added

- `GET /v1/health` (tag: System) — public, unauthenticated liveness check.
- `GET /v1/organizations` (tag: Organizations) — lists organizations for the
  authenticated user. **Currently returns stub data**; real Prisma query +
  auth middleware are deferred to a follow-up plan. The route is already
  documented with `security: [{ bearerAuth: [] }]`, so the contract is
  stable — only enforcement is pending.
- OpenAPI 3.1 spec at `/v1/openapi.json` and Scalar UI at `/v1/docs`, both
  env-gated to `NODE_ENV !== "production"`.
- `bearerAuth` HTTP security scheme (Supabase JWT).
- `@pazarsync/api-client` workspace package with a committed `openapi.json`
  snapshot, an `openapi-typescript`-generated `paths`/`components` interface,
  and an `openapi-fetch`-based `createApiClient` factory consumed by
  `apps/web/src/lib/api-client.ts`.
- Shared OpenAPI components under `apps/api/src/openapi/`:
  - `ProblemDetailsSchema` (RFC 7807 with machine-readable `code`) and
    `ValidationErrorDetailSchema`.
  - `RateLimitHeaders` (Zod object: `X-RateLimit-Limit/Remaining/Reset`) and
    `Common429Response` (with `Retry-After` header and `ProblemDetails` body).
  - `CursorMetaSchema` + `paginated<T>(itemSchema)` helper.
- Cursor pagination utilities in `@pazarsync/utils`: `cursorPaginationSchema`,
  `encodeCursor`/`decodeCursor`, `CursorSortMismatchError`,
  `InvalidCursorError`. Replaces the previous offset `paginationSchema`.

### Security

- API spec and docs UI are NOT exposed in production builds.
- `bearerAuth` is the only documented security scheme; no OAuth flows or
  cookie-based auth are implied.

### Notes

- Path keys in the generated spec are version-prefixed (`/v1/health`,
  `/v1/organizations`) because `@hono/zod-openapi` inlines `basePath("/v1")`.
  Frontend `baseUrl` pairs with this by NOT including `/v1`.
