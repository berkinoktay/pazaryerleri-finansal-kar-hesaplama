# API Changelog

All notable changes to the PazarSync REST API.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this API follows [Semantic Versioning](https://semver.org/) within each URL
path version (`/v1/`, `/v2/`, …). The major number of `info.version` is locked
to the URL path version. While the API is internal-only, breaking changes
within `/v1/` bump minor — see `docs/plans/2026-04-16-api-docs-design.md`
section "Versioning" for details.

## [Unreleased]

### Removed

- **FX rates endpoint** (`GET /v1/organizations/{orgId}/fx-rates/latest`). The platform now works
  in Turkish lira only, so there is no exchange-rate surface. The route, its
  `FxRatesLatestResponse` and `FxRateEntry` component schemas, and the `FxRates` tag are gone.
  Breaking; the web client ships the matching change in the same PR.
- **Order detail fee and payment-order fields**
  (`GET /v1/organizations/{orgId}/stores/{storeId}/orders/{orderId}`). `fees` (always an empty
  array), `paymentOrderId` and `paymentDate` (always null), and the per-item
  `commissionInvoiceSerialNumber` (always null) are gone, together with the `OrderFeeDetail`
  component schema. The order list never carried them. Breaking; the web client ships the matching
  change in the same PR.

### Changed

- **Seller cost and desi edits reach the day's stored orders until the day ends**
  (`PATCH /v1/organizations/{orgId}/stores/{storeId}/products/variants/{variantId}/dimensional-weight`,
  `PATCH .../products/variants/dimensional-weight`,
  `PATCH /v1/organizations/{orgId}/cost-profiles/{id}`, `POST .../cost-profiles/{id}/archive`,
  `POST .../cost-profiles/{id}/restore`, `POST .../cost-profile-attachments/attach`,
  `POST .../cost-profile-attachments/detach`, `POST .../cost-profile-attachments/replace`, and the
  catalog sync; seen through the order list, summary and detail profit fields). An order's cost
  list and desi are now the values in force at the end of its Istanbul business day (00:00), and a
  stored order follows them until its day is made final. The desi PATCH (single and bulk, a clear
  included) now queues a profit recompute of the variant's stored orders whose seller inputs are
  not final yet (today's orders, and a past day's until the day-close pass has run); a cost profile
  edit, archive or restore and a cost attach, detach or replace do the same for their variants, so
  today's already calculated orders change: they take the new amount, and gain or lose a cost or a
  desi. A cost line is priced by the version in force at the day end, no longer by the amount at
  the order time. About two minutes after 00:00 a worker pass makes the day final (later edits no
  longer reach it) and permanently excludes an order that had no cost (`COST_DEADLINE_MISSED`) or,
  with a cost, no desi (`DESI_DEADLINE_MISSED`) at the day end. Orders dated before the release day
  are final as stored. This supersedes, for orders that are not final, "Entering a desi moves
  today's waiting orders into profit" (clearing a desi no longer leaves stored orders untouched)
  and "Product and store edits no longer reprice stored orders" (a desi override or a cost profile
  change reaches them again until the day ends). Request and response shapes are unchanged.
- **A seller desi is at least 1; a sync without a desi keeps the last known Trendyol desi**
  (`PATCH /v1/organizations/{orgId}/stores/{storeId}/products/variants/{variantId}/dimensional-weight`,
  `PATCH /v1/organizations/{orgId}/stores/{storeId}/products/variants/dimensional-weight`). The
  `dimensionalWeight` body field now accepts the closed range `[1, 999.99]` instead of
  `[0, 999.99]`: `"0"` and anything below 1 (for example `"0.99"`) answer 422 `VALIDATION_ERROR`
  with `INVALID_DIMENSIONAL_WEIGHT_TOO_SMALL` (a negative stays `INVALID_DIMENSIONAL_WEIGHT_FORMAT`).
  `null` still clears the override. This replaces the rule that a seller desi of 0 is a real desi; a
  Trendyol 0 or missing desi still counts as no desi. `syncedDimensionalWeight` (products list,
  the desi PATCH response, live performance) is now the last known Trendyol desi: a catalog sync
  that brings no desi for an existing variant leaves it unchanged instead of clearing it; a real
  new value still replaces it. Only descriptions change in the spec; no field or schema shape changes.
  Breaking for a client that sends a desi below 1; the web client ships the matching change in the
  same PR.

- **Orders and returns date filters select whole Istanbul business days**
  (`GET /v1/organizations/{orgId}/stores/{storeId}/orders`,
  `GET /v1/organizations/{orgId}/stores/{storeId}/orders/summary`,
  `GET /v1/organizations/{orgId}/stores/{storeId}/claims`,
  `GET /v1/organizations/{orgId}/stores/{storeId}/claims/summary`). `from` and `to` are now
  date-only Istanbul business dates (`YYYY-MM-DD`, OpenAPI `format: date`): `from` selects from the
  start of that business day, and `to` includes that whole business day (up to, not including, the
  next business midnight). Before, both were compared as UTC instants, so `from` dropped the first
  three hours of its day and `to` dropped all of its day after 00:00 UTC. Any other value, a
  timestamp with a time of day, another separator (`2026/06/01`) or a day the month does not have
  (`2026-02-30`) included, is now `422 VALIDATION_ERROR` with `errors[].code`
  `INVALID_BUSINESS_DATE`. The claims summary period follows the same rule (the returns page sends it the
  list's `from`/`to`), so its KPI strip and the list cover the same days. A `from`/`to` outside
  2000-01-01..2099-12-31 is now `422 VALIDATION_ERROR` with `errors[].code`
  `INVALID_DATE_OUT_OF_RANGE`. The web client now sends the
  calendar day the user picked instead of its UTC date (which was the previous day for picks east of
  UTC).
- **New profit issue code and a blocking not-recognized carrier**
  (`GET /v1/organizations/{orgId}/stores/{storeId}/orders/{orderId}`, `profitIssues[].code`). The
  `ProfitIssue.code` enum gains `REFERENCE_DATA_MISSING` (blocking): a fee definition (`detail`
  `FEE:<fee type>`) or a micro-export return tier (`detail` `EXPORT_RETURN_TIER`) was missing on the
  order date, so that fee is left out and the profit is not computable. `CARRIER_NOT_RECOGNIZED` is
  now blocking: an order shipped under Trendyol's agreement whose carrier is not recognized gets no
  shipping estimate instead of a zero one; a seller-cargo-agreement order no longer records it. Its
  return leg likewise gets no return shipping line instead of a zero one, and a blocking
  `SHIPPING_ESTIMATE_UNAVAILABLE` with the new `detail` `RETURN_CARRIER_NOT_RECOGNIZED`, which a
  return cargo invoice lifts in the best-known view; a seller-cargo-agreement order keeps its zero
  return line and no issue. `SHIPPING_ESTIMATE_UNAVAILABLE` has a new `detail`, `NO_TARIFF_VERSION` (`RETURN_NO_TARIFF_VERSION`
  on the return leg), for a carrier with no tariff version in force on the order date; it was
  reported as `DESI_OVERFLOW` before. The product pricing routes still report that case as
  `DESI_OVERFLOW`. Clients must accept the new enum value.
- **Entering a desi moves today's waiting orders into profit**
  (`PATCH /v1/organizations/{orgId}/stores/{storeId}/products/variants/{variantId}/dimensional-weight`,
  `PATCH .../products/variants/dimensional-weight`). Setting a desi (any value, 0 included) now
  re-checks the variant's orders of today that wait in the Live Performance buffer, in the same
  transaction: an order whose every line has a cost and a desi moves on into profit, like a cost
  attach already does. Only this store's variants that the write updated are checked; ids of
  another store or organization trigger nothing. Clearing the desi (`null`) checks nothing, and
  stored orders keep the desi captured at intake. Request and response shapes unchanged.
- **Restoring a cost profile moves today's waiting orders into profit**
  (`POST /v1/organizations/{orgId}/cost-profiles/{id}/restore`). A restore now re-checks, in the
  same transaction, the orders of today that wait in the Live Performance buffer for the
  profile's attached variants: an order whose only cost profile was archived moves on into profit
  once that profile is restored, provided every line has a cost and a desi, like a cost attach
  already does. Request and response shapes unchanged.
- **Buffer detail flags a line whose cost profiles are all archived**
  (`GET /v1/organizations/{orgId}/stores/{storeId}/live-performance/buffer/{bufferId}`,
  `lines[].isCostMissing`). `isCostMissing` is now also `true` for a line whose linked cost
  profiles are all archived (none in force at the end of the order's business day), not only for a
  line with no linked profile or no resolved variant. No response shape change.
- **Empty desi is missing, a seller's 0 is a real desi** (`GET /v1/organizations/{orgId}/stores/{storeId}/products`,
  `GET .../products/facets`, `PATCH .../products/variants/{variantId}/dimensional-weight`, the
  product pricing routes). A variant Trendyol sends no desi for, or a desi of 0 (Trendyol's value
  for a desi that was never entered), now has `syncedDimensionalWeight` `null` (and
  `dimensionalWeight` `null` when the seller entered none) instead of `"0"`; a seller-entered `"0"`
  is a real desi. `overrideMissing=desi`, `overrideCounts.missingDesi` and
  `isDimensionalWeightMissing` count only a non-digital variant with no desi at all (no seller
  desi, no Trendyol desi); a desi of 0 and a digital variant are not missing. The shipping estimate
  of a variant with no desi is `NO_DESI` with no amount (a desi of 0 is priced at the desi-0 row).
  Shapes unchanged.
- **Barem table 1 / table 2** (order profit, the products list shipping estimate, the single
  shipping estimate and the pricing scenario routes). From Trendyol's 10 Aug 2026 rule a shipment
  inside the Barem limits is priced at table 1 when it carries a fast-delivery promise and shipped
  by the agreed ship-by date, and at table 2 otherwise; a return of a table 1 shipment is priced at
  table 1 only when the tariff version enables it (no version does today: Trendyol bills those
  returns at the desi tariff). Catalog estimates and scenarios use table 1 for a
  variant with a fast-delivery duration within the carrier's window and table 2 otherwise. Tariff
  versions without table 2 rows keep the previous result. Response shapes are unchanged.
- **Carrier tariffs** (`GET /v1/organizations/{orgId}/shipping-carriers/{carrierId}/tariffs`).
  `baremTariffs` lists the Barem table 1 rows only. Shape unchanged.
- **Product and store edits no longer reprice stored orders**
  (`PATCH /v1/organizations/{orgId}/stores/{storeId}/shipping-config`, the variant desi
  override routes, and the catalog sync). A stored order now keeps the product and seller
  inputs captured when it was first computed (desi, digital flag, category, brand,
  commission rates, cost profile versions, recognised carrier, tariff source). Changing the
  shipping config, overriding a variant's desi or a catalog change of a synced rate or desi
  therefore no longer queues a profit recompute of stored orders; they affect new orders and
  the catalog estimates only. Profit settings (stopaj / negative net VAT) of stored orders that
  still followed the store setting are frozen to the store setting at their first recompute
  under engine version 10 (`PATCH .../profit-settings` then reaches only orders that were never
  computed). Request and response shapes are unchanged.
- **Shipping tariffs are read from the dated version in force**
  (`GET /v1/organizations/{orgId}/shipping-carriers`,
  `GET /v1/organizations/{orgId}/shipping-carriers/{carrierId}/tariffs`,
  `GET`/`PATCH /v1/organizations/{orgId}/stores/{storeId}/shipping-config`, and the per-variant
  shipping estimate on the products list). A carrier's desi prices, Barem bands and Barem
  attributes now live in dated tariff versions; each version applies from its start until the
  next one starts. These routes answer with the version in force at request time: a
  future-dated version stays invisible until it starts. `supportsBaremDestek` and `maxBaremDesi`
  come from that version, and are `false` and `0` when the carrier has no version in force; the
  tariffs route then returns empty `desiTariffs` and `baremTariffs`, and the products-list estimate
  reports `DESI_OVERFLOW`. The wire shape is unchanged. Order profit uses the version in force at
  the order date instead (no route change).
- **Workbook uploads: a full commission tariff file as exported now fits the upload gate**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/{discount-lists|marketplace-campaigns|flash-products|advantage-tariffs|plus-commission-tariffs|commission-tariffs}/import`).
  A commission tariff file with three periods used to answer `422 VALIDATION_ERROR` with
  `{ field: 'file', code: 'PAYLOAD_TOO_LARGE' }` (the gate's `dom-weight` rule; on the wire
  `meta: { limit: 'rows', maxRows: 5000 }`) well before 5,000 product rows: a file of the
  heaviest real rows from about 3,500 to 3,750 product rows on, depending on how full its rows
  were (with two periods from about 4,440). Such a file with 5,000 product rows as exported
  (DOM weight about 6.67 million; about 5.63 million with two periods) now passes the gate,
  also with up to two of each row's empty cells filled; one whose rows have all four filled
  (about 7.11 million) is still refused from about 4,920 product rows on. The gate's DOM weight
  budget is 7,000,000 (was 5,000,000); the parse worker's memory limit is unchanged. Uploads
  refused before may now pass; nothing accepted before is refused. No schema or response shape
  change; not breaking.
- **Workbook exports keep the look of a date-styled cell that gets a number**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/{advantage-tariffs|commission-tariffs|plus-commission-tariffs}/{tariffId}/export`,
  `POST /v1/organizations/{orgId}/stores/{storeId}/{discount-lists|flash-products}/{listId}/export`,
  `POST /v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}/export`).
  A number written into a cell whose style formats a date now keeps the cell's font, fill, border
  and alignment: the export adds a General copy of that style to the workbook's styles and points
  the cell at it, so the cell shows the number rather than a date. It used to lose its whole
  style. When the workbook's styles cannot be extended safely, the cell loses its style as before.
  A file without such a cell is exported byte for byte as before. No schema or response shape
  change; not breaking.
- **Workbook imports decode Excel's character escape in display text**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/{discount-lists|marketplace-campaigns|flash-products|advantage-tariffs|plus-commission-tariffs|commission-tariffs}/import`).
  Excel's `_xHHHH_` character escape (`_x000A_` for a line break, for one) is decoded in the
  display text of newly uploaded rows: the product title, brand, category, color, size and the
  model, stock and product codes. `_x005F_` stands for a literal underscore, so `_x005F_x0041_`
  reads `_x0041_`, and a character outside the Basic Multilingual Plane escaped as two halves
  (`_xD83D__xDE00_`) reads as that one character. An escape of a character XML cannot hold
  (`_x0000_`, or an unpaired half, for one) stays as written. Barcodes and every value compared
  with the stored file are read as before, and rows
  stored before are not rewritten. No schema or response shape change; not breaking.
- **Workbook uploads: Excel data that only reads like a CSS call is no longer refused**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/{discount-lists|marketplace-campaigns|flash-products|advantage-tariffs|plus-commission-tariffs|commission-tariffs}/import`).
  A file whose Excel data attributes hold a word ending in `url`, `src` or `image` glued to `(`
  (an autofilter value such as `Curl(25mm)`, a validation prompt such as `image(s)`, a pivot
  item, a picture description, a saved-folder path, a table column or sheet name) used to answer
  `422 VALIDATION_ERROR` with `{ field: 'file', code: 'UNSAFE_CONTENT' }`; it is now imported.
  SVG, XHTML and VML content and every `style` are checked as before, and an attribute outside
  the Excel data namespaces (a relationships `Target`, for one) keeps the old rule. No schema or
  response shape change; not breaking.
- **Validation field codes are always machine codes** (every route that answers
  `422 VALIDATION_ERROR` with field issues). Every `errors[].code` is now a SCREAMING_SNAKE_CASE
  code: a rule without its own code answers `INVALID_FIELD` where it used to answer the
  validation library's English sentence (`meta.zodCode` still names the rule). The six workbook
  import routes
  (`POST /v1/organizations/{orgId}/stores/{storeId}/{discount-lists|marketplace-campaigns|flash-products|advantage-tariffs|plus-commission-tariffs|commission-tariffs}/import`)
  answer `errors: [{ field: 'file', code: 'FILE_REQUIRED' }]` for a missing `file` part or one
  that is not a file. The discount and campaign import routes and their config routes
  (`PATCH /v1/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}`,
  `PATCH /v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}`) answer
  `INVALID_DISCOUNT_TYPE` on `discountType` for a missing or unknown value, and
  `INVALID_VALUE_KIND` on `valueKind` for an unknown value (the field stays optional). Breaking
  only for a client that matched the old sentences.
- **Flash selections: a choice the export could not write is refused**
  (`PATCH /v1/organizations/{orgId}/stores/{storeId}/flash-products/{listId}/selections`).
  New field issues on `422 VALIDATION_ERROR`: `OFFER_NOT_STORED` on `selections.<index>.offer`
  when the item stores no price for the chosen offer, `OFFER_NOT_STORED` on
  `selections.<index>.customPrice` when the item stores no offer at all (there is no ceiling to
  check against), and `CUSTOM_PRICE_ABOVE_MAX` on `selections.<index>.customPrice` when the
  custom price is above the item's lowest offer price (equal is allowed). The index is the one of
  the request array. All-or-nothing: one refused entry writes nothing. An item outside the list
  and store is still skipped silently and never reported. The web client shows the refusal in the
  same PR.
- **Advantage selections: a tier the item does not store is refused**
  (`PATCH /v1/organizations/{orgId}/stores/{storeId}/advantage-tariffs/{tariffId}/selections`).
  New field issue `TIER_NOT_STORED` on `selections.<index>.tier` (`422 VALIDATION_ERROR`) when
  the chosen tier is not among the item's stored tiers, even when a custom price is sent; a null
  tier is never checked. All-or-nothing, and an item outside the tariff and store is still skipped
  silently. The web client shows the refusal in the same PR.
- **Flash, Advantage and Campaign selections: a custom price has at most ten integer digits**
  (`PATCH /v1/organizations/{orgId}/stores/{storeId}/flash-products/{listId}/selections`,
  `PATCH /v1/organizations/{orgId}/stores/{storeId}/advantage-tariffs/{tariffId}/selections`,
  `PATCH /v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}/selections`).
  A `customPrice` with more than ten digits before the decimal point answers
  `422 VALIDATION_ERROR` with `INVALID_CUSTOM_PRICE` on `selections.<index>.customPrice`, instead
  of failing in the database with a `500`. The zero-price refusal of the Commission and Plus
  selections is not added to these three routes. The `pattern` of `customPrice` in the spec
  changes accordingly.
- **Workbook exports: a selection the stored file has no row for, a plan too large, a number in
  a date cell**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/{advantage-tariffs|commission-tariffs|plus-commission-tariffs}/{tariffId}/export`,
  `POST /v1/organizations/{orgId}/stores/{storeId}/{discount-lists|flash-products}/{listId}/export`,
  `POST /v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}/export`).
  An Advantage, Commission or Plus export whose selected product's barcode is on no row of the
  stored file answers `409 ROW_MISMATCH` where it used to leave that product out of the file
  without notice. An export whose plan holds more patch cells than one engine call writes answers
  `409 STORED_FILE_UNREADABLE` before the file is patched, where it used to fail with a `500`;
  the current limits cannot reach it. A number written into a cell whose style formats a date is
  written without that style, so the cell shows the number rather than a date. _(Superseded
  within this Unreleased: the cell now keeps its font, fill, border and alignment under a General
  copy of that style, and loses its style only when the styles cannot be extended safely; see
  "Workbook exports keep the look of a date-styled cell that gets a number".)_ No request or
  response shape changes.
- **Discount and campaign config updates write once**
  (`PATCH /v1/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}`,
  `PATCH /v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}`). The
  update is one store-scoped database write, where it used to read the record before and after
  it. Same request, response shape and status codes: a foreign or missing id is still
  `404 NOT_FOUND`. The response `id` is now the path id as sent; before, it was the stored id read
  back, which differs only in letter case when the path id holds upper-case letters. Not
  breaking.
- **Plus import reads `Evet` in the cancel column**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/import`). A row's
  `cancelled` flag is true when its `İptal` cell reads `Evet` in any letter case, where it used
  to be true only for a non-zero number; a non-zero number still cancels. No response field
  changes.
- **Campaign pages find each item's product by its barcode when they are read**
  (`GET /v1/organizations/{orgId}/stores/{storeId}/{commission-tariffs|plus-commission-tariffs|advantage-tariffs}/{tariffId}`,
  `GET /v1/organizations/{orgId}/stores/{storeId}/{flash-products|discount-lists}/{listId}`,
  `GET /v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}`,
  `POST /v1/organizations/{orgId}/stores/{storeId}/{commission-tariffs|plus-commission-tariffs|advantage-tariffs}/{tariffId}/items/{itemId}/estimate`,
  `POST /v1/organizations/{orgId}/stores/{storeId}/{flash-products|discount-lists}/{listId}/items/{itemId}/estimate`,
  `POST /v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}/items/{itemId}/estimate`,
  `POST /v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}/target-margin`).
  The detail, estimate and (marketplace campaigns) target-margin responses of the six campaign
  pages now resolve each item's product from its barcode in the store's catalog at request time,
  instead of the link stored at upload. An item uploaded before its product was synced, or whose
  catalog variant was recreated, gets its profit, image and product-based commission without a
  re-upload. `reason: NO_PRODUCT` now means the barcode has no product in the catalog right now.
  When several variants share a barcode, one still in the product feed is preferred, and among
  those the oldest is used. The other direction changes too: a variant whose barcode is changed
  in place (same variant, new barcode) no longer prices campaign rows that carry its old barcode,
  which the stored link used to do; those rows answer `NO_PRODUCT` until a file with the new
  barcode is uploaded. If the barcode lookup itself fails, the read still answers `200`: every
  item reads as not calculable with `reason: null` (the degraded profit read, logged as
  `[profit-read]`), never `NO_PRODUCT` and never a `5xx`. No request or response shape
  changes; the import response's `matched` / `unmatched` counts still describe the moment of
  upload.
- **Workbook imports refuse a file with no column to write selections into**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/import`,
  `POST /v1/organizations/{orgId}/stores/{storeId}/advantage-tariffs/import`,
  `POST /v1/organizations/{orgId}/stores/{storeId}/flash-products/import`). An upload whose sheet
  has no column the export could write the seller's selections into answers `422 VALIDATION_ERROR`
  with `errors: [{ field: 'file', code: 'NO_WRITEBACK_COLUMN' }]` where it used to answer `201` and
  fail only at the first export; nothing is stored. The export's `409 NO_WRITEBACK_COLUMN` stays
  for files stored earlier. On the commission, discount and marketplace campaign pages that column
  is already required to recognise the file, so those routes are unchanged. Breaking for a client
  that uploaded such files; the web client ships the matching sentence in the same PR.
- **Row, column and content limits carry their maximum**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/{discount-lists|marketplace-campaigns|flash-products|advantage-tariffs|plus-commission-tariffs|commission-tariffs}/import`).
  On all six workbook import routes the `file` issue `ROW_CAP_EXCEEDED` carries `meta.maxRows` and
  `COL_CAP_EXCEEDED` carries `meta.maxCols`: the most rows and columns a sheet may hold, a limit
  that applies to every sheet of the file. A `PAYLOAD_TOO_LARGE` raised by the row-content limit
  (a file with too many filled rows, which can be refused below the row cap) rather than by bytes
  carries `meta: { limit: 'rows', maxRows }`. Every other `PAYLOAD_TOO_LARGE` issue on `file`
  keeps its size meaning and carries no meta (the 413 of an oversized request body keeps its
  top-level `meta.maxBytes`), and no other engine detail reaches the response. Codes unchanged;
  additive.
- **Upload quota: which limit, and checked before the file is read**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/{discount-lists|marketplace-campaigns|flash-products|advantage-tariffs|plus-commission-tariffs|commission-tariffs}/import`).
  `409 UPLOAD_QUOTA_EXCEEDED` on the six import routes carries `meta.limit`: `lists` with
  `meta.maxLists` (the per-page list limit, the lists of this page in this store) or `bytes` with
  `meta.maxBytes` (the store-wide limit on stored source files, counted over all six workbook
  pages, the incoming file included). The quota is now checked before the file is parsed, and
  again inside the import transaction, so when the quota is already reached a file with other
  problems gets the `409` first instead of a `422`. Code unchanged; additive.
- **Advantage import: a commission tariff deleted during the import**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/advantage-tariffs/import`). When the chosen
  commission source tariff is deleted after the import checked it and before the list is stored,
  the route answers `422 VALIDATION_ERROR` with
  `errors: [{ field: 'commissionSourceTariffId', code: 'INVALID_COMMISSION_SOURCE' }]`, the same
  answer as for a source already gone when the upload arrived, instead of `422 INVALID_REFERENCE`.
  Nothing is stored. The web client shows the matching sentence under the commission source picker
  in the same PR.
- **Commission tariff detail: the current commission percent can be null**
  (`GET /v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}`).
  `TariffDetailItem.currentCommissionPct` is null when the file's current commission cell was
  blank or unreadable; a readable 0 stays 0. `currentNetProfit` is null also when the current
  commission is unknown; the bands are still priced, and their outcomes then decide `calculable`
  and `reason`. The band schema (`TariffBandResult.commissionPct`) is unchanged. Breaking
  for a client that assumed the field is a string; the web client ships the matching change in the
  same PR.
- **Plus tariff detail: the current commission and the Plus commission percent can be null**
  (`GET /v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/{tariffId}`).
  `PlusTariffDetailItem.currentCommissionPct` and `PlusScenario.commissionPct` (the item's
  `plus.commissionPct`) are null when the file's cell was blank or unreadable; a readable 0 stays
  0. A scenario with a null percent has no profit, and `currentNetProfit` is null also when the
  current commission is unknown. `plusIsBetter` is false when either percent is unknown; with the
  current commission unknown, `calculable` and `reason` follow the Plus offer, and with both
  unknown the item answers `calculable: false` with `reason: null`. Breaking
  for a client that assumed both fields are strings; the web client ships the matching change in
  the same PR.
- **Flash products detail: the current commission and an offer's commission percent can be null**
  (`GET /v1/organizations/{orgId}/stores/{storeId}/flash-products/{listId}`).
  `FlashProductDetailItem.currentCommissionPct` is null when the file's current commission cell was
  blank or unreadable; a readable 0 stays 0. `FlashOffer.commissionPct` (`offer24` and `offer3`)
  is null when no commission tariff band covers the offer and the current commission is unknown;
  such an offer has no profit. `currentNetProfit` is null also when the current commission is
  unknown; an offer a band covers is still priced at its band, and the item is then `calculable`
  when any offer is (else `calculable: false` with the first priced offer's `reason`, or `reason: null`
  when no offer could be priced). The band
  schema (`FlashCommissionBand.commissionPct`) is unchanged. Breaking for a client that assumed
  both fields are strings; the web client ships the matching change in the same PR.
- **Commission tariff estimate: new 422 field code `CURRENT_COMMISSION_UNKNOWN`**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}/items/{itemId}/estimate`).
  `scenario: "current"` for an item whose current commission percent is unknown (the file's cell
  was blank or unreadable) answers `422 VALIDATION_ERROR` with
  `errors: [{ field: "scenario", code: "CURRENT_COMMISSION_UNKNOWN" }]` instead of pricing a
  made-up 0%; the detail row of such an item has no current profit either. `CURRENT_PRICE_UNKNOWN`
  is checked first. The response schema is unchanged, and the band and custom-price modes are
  unaffected (they never read the current percent).
- **Plus tariff estimate: new 422 field codes `CURRENT_COMMISSION_UNKNOWN` and
  `PLUS_COMMISSION_UNKNOWN`**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/{tariffId}/items/{itemId}/estimate`).
  `scenario: "current"` for an item whose current commission percent is unknown answers
  `422 VALIDATION_ERROR` with `errors: [{ field: "scenario", code: "CURRENT_COMMISSION_UNKNOWN" }]`
  (`CURRENT_PRICE_UNKNOWN` is checked first). A `price` for an item whose Plus commission offer is
  unknown answers `422 VALIDATION_ERROR` with
  `errors: [{ field: "price", code: "PLUS_COMMISSION_UNKNOWN" }]`. A percent is unknown when the
  file's cell was blank or unreadable; it is never priced at a made-up 0%. Each mode checks only
  the percent it applies. The response schema is unchanged.
- **Flash products estimate: new 422 field code `CURRENT_COMMISSION_UNKNOWN`, and a not
  calculable answer for a price that needs an unknown commission**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/flash-products/{listId}/items/{itemId}/estimate`).
  `scenario: "current"` for an item whose current commission (Mevcut Komisyon) is unknown (the
  file's cell was blank or unreadable) answers `422 VALIDATION_ERROR` with
  `errors: [{ field: "scenario", code: "CURRENT_COMMISSION_UNKNOWN" }]`. A `price` is not refused:
  when it lands in a tariff band it is priced at that band's commission as before, and when it
  lands in no band and so falls back to the unknown current commission the answer is `200` with
  `calculable: false`, `reason: null`, `commissionPct: null`, `commissionSource: "current"` and
  `breakdown: null` (an unmatched item still answers `reason: "NO_PRODUCT"`). The response schema
  is unchanged (`commissionPct` was already nullable).
- **Plus tariff export: new 409 code `SELECTION_COMMISSION_UNKNOWN`**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/{tariffId}/export`).
  When a product that opted in to Plus has no known Plus commission offer in a period (the file's
  offer cell was blank or unreadable), the export answers `409` with code
  `SELECTION_COMMISSION_UNKNOWN` instead of writing a made-up `0` into the computed commission
  column. The refusal also applies when the product has a custom price (a price does not supply the
  commission), and it is checked before `SELECTION_PRICE_UNKNOWN`. No file is built and the tariff
  is not marked exported. The web client localizes the new code under
  `common.errors.SELECTION_COMMISSION_UNKNOWN` in the same PR.
- **Plus tariff selections: new 422 field code `PLUS_COMMISSION_UNKNOWN`**
  (`PATCH /v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/{tariffId}/selections`).
  A join (`selected: true`) on an item whose Plus commission offer is unknown (the file's offer
  cell was blank or unreadable) answers `422 VALIDATION_ERROR` with
  `{ field: "selections.<index>.selected", code: "PLUS_COMMISSION_UNKNOWN" }`: the export writes
  that offer into the computed commission column and would refuse the tariff with
  `409 SELECTION_COMMISSION_UNKNOWN`. Unlike `PLUS_PRICE_UNKNOWN`, the check also applies to an
  entry with a custom price (a price does not supply the commission), so the earlier entry's
  "an entry with a custom price is never checked" no longer holds for this code. Each refused
  entry gets one issue: an unknown commission is reported as `PLUS_COMMISSION_UNKNOWN` even when
  the ceiling is unknown too. The check stays all-or-nothing (every refused entry is reported, with
  the index of the request array, and nothing is written); a `selected: false` entry is never
  checked, so an existing join can still be cleared, and an item id outside the tariff and store
  is still silently skipped (never reported). The request and response schemas are unchanged; the
  route description and its 422 text name the new code.
- **Commission, Plus and Flash imports: an unknown commission percent is kept as null, and a new
  count `unknownCommissionRows`**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/import`,
  `POST /v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/import`,
  `POST /v1/organizations/{orgId}/stores/{storeId}/flash-products/import`). A blank or unreadable
  current commission percent, and on the Plus page a blank or unreadable Plus commission offer, is
  stored as null instead of 0; a readable 0 stays 0. `ImportTariffResponse`,
  `ImportPlusTariffResponse` and `ImportFlashProductsResponse` gain the required integer
  `unknownCommissionRows`: on the commission page, the product rows with an unknown current
  commission; on the Plus page, the product rows with an unknown current commission or an unknown
  Plus commission offer in a stored period (an offer of a period the upload does not store is not
  read); each such row counts once, whatever the number of periods. On the Flash page it counts the
  distinct products with an unknown current commission on at least one date row, like
  `productCount`. No backfill: a tariff or list uploaded before this change keeps its stored 0
  until it is uploaded again. On the commission and Plus pages an upload whose week overlaps a
  stored tariff is refused, so the old tariff is deleted first, and its saved selections go with
  it. Additive; the other workbook import responses are unchanged.
- **Commission and Plus tariff selections take every item of a tariff**
  (`PATCH /v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}/selections`,
  `PATCH /v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/{tariffId}/selections`).
  `selections` now holds up to 15000 entries instead of 5000. A tariff stores one item per file row
  in each period of its week, and a week holds at most three periods, so a split week of more than
  2500 products could not be saved. Not breaking: every request that passed before still passes.
- **Commission tariff detail: the current price and a band price can be null**
  (`GET /v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}`).
  `TariffDetailItem.currentPrice` is null when the file's current price (GÜNCEL TSF) was blank,
  unreadable or 0. `TariffBandResult.price` is null for a band with neither limit when the
  current price is unknown; such a band has no profit and cannot be selected. `currentNetProfit`
  is null when neither the commission base price nor the current price is known, and
  `calculable: false` with `reason: null` also covers a row with no known price. Breaking for a
  client that assumed both fields are strings; the web client ships the matching change in the
  same PR.
- **Plus tariff detail: the prices can be null**
  (`GET /v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/{tariffId}`).
  `PlusTariffDetailItem.currentPrice`, `PlusTariffDetailItem.commissionBasePrice` and
  `PlusTariffDetailItem.plusPriceUpperLimit` are null when the file's cell was blank, unreadable
  or 0. `PlusScenario.price` is null when the Plus price upper limit is unknown; the Plus scenario
  then has no profit. `currentNetProfit` is computed at the commission base price, else at the
  current price, and is null when neither is known; `calculable: false` with `reason: null` also
  covers a row with no known price. Breaking for a client that assumed the four fields are strings;
  the web client ships the matching change in the same PR.
- **Commission tariff export: new 409 code `SELECTION_PRICE_UNKNOWN`**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}/export`). When a
  selected product without a custom price has no known price to write (its selected band has
  neither limit, or the stored bands do not hold the selected band, while the product's current
  price is unknown), the export answers `409` with code `SELECTION_PRICE_UNKNOWN` instead of
  writing a made-up price. No file is built and the tariff is not marked exported. A selected
  product with a custom price, or with a band that has a limit, still exports as before. The web
  client localizes the new code under `common.errors.SELECTION_PRICE_UNKNOWN` in the same PR.
- **Plus tariff export: new 409 code `SELECTION_PRICE_UNKNOWN`**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/{tariffId}/export`).
  When a product that opted in to Plus without a custom price has no known Plus price upper limit
  (the file's cell was blank, unreadable or 0), the export answers `409` with code
  `SELECTION_PRICE_UNKNOWN` instead of writing a made-up `0.00`. No file is built and the tariff is
  not marked exported. A product with a custom price, or with a known upper limit, still exports as
  before. The code is the commission tariff export's, already localized under
  `common.errors.SELECTION_PRICE_UNKNOWN`.
- **Commission tariff estimate: new 422 field code `CURRENT_PRICE_UNKNOWN`**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}/items/{itemId}/estimate`).
  `scenario: "current"` for an item with neither a commission base price nor a current price
  answers `422 VALIDATION_ERROR` with `errors: [{ field: "scenario", code: "CURRENT_PRICE_UNKNOWN" }]`
  instead of pricing a made-up 0; the detail row of such an item has no current profit either.
  The response schema is unchanged, and the band and custom-price modes are unaffected.
- **Plus tariff estimate: new 422 field code `CURRENT_PRICE_UNKNOWN`**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/{tariffId}/items/{itemId}/estimate`).
  `scenario: "current"` is priced at the commission base price, else at the current price, as the
  detail row's `currentNetProfit` is. For an item with neither price known it answers
  `422 VALIDATION_ERROR` with `errors: [{ field: "scenario", code: "CURRENT_PRICE_UNKNOWN" }]`
  instead of pricing a made-up 0. The response schema is unchanged, and the custom-price mode is
  unaffected (it also works when the Plus price upper limit is unknown).
- **Commission tariff import: unknown prices are kept as null, and a new count
  `unknownCurrentPriceRows`**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/import`). A product row
  whose current price (GÜNCEL TSF) or commission base price (KOMİSYONA ESAS FİYAT) is blank,
  unreadable or 0 is kept and stored with that price null; a band with neither limit no longer
  refuses the file when the current price is unknown. `ImportTariffResponse` gains the required
  integer `unknownCurrentPriceRows`: the product rows with neither a current price nor a commission
  base price, whose current profit is unknown (each row counts once, whatever the number of
  periods). A row whose commission base price is known is not counted. Additive; the other workbook
  import responses are unchanged.
- **Plus tariff import: unknown prices are kept as null, and a new count `unknownPriceRows`**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/import`). A product row
  whose current price, commission base price, Plus price upper limit or Plus commission base price
  is blank, unreadable or 0 is kept and stored with that price null (the commission base price
  still falls back to the current price, and the Plus commission base price to the Plus price upper
  limit). `ImportPlusTariffResponse` gains the required integer `unknownPriceRows`: the product
  rows with neither a commission base price nor a current price, or with no Plus price upper limit
  (each row counts once, whatever the number of periods). Additive; the other workbook import
  responses are unchanged.
- **Commission tariff selections: new 422 field codes `BAND_NOT_STORED` and `BAND_PRICE_UNKNOWN`**
  (`PATCH /v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}/selections`).
  A selection whose band the item does not store answers `422 VALIDATION_ERROR` with
  `{ field: "selections.<index>.band", code: "BAND_NOT_STORED" }`, with or without a custom price.
  A selection of a band with no price (neither limit while the item's current price is unknown)
  sent without a custom price answers the same with code `BAND_PRICE_UNKNOWN`. The check is
  all-or-nothing: every refused entry is reported and nothing is written. A `band: null` entry is
  never checked, and an item id outside the tariff and store is still silently skipped (never
  reported). The request and response schemas are unchanged.
- **Commission tariff selections: a custom price of 0 is refused**
  (`PATCH /v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}/selections`).
  A `customPrice` that is zero at two decimals (`0`, `0.0`, `0.00`, `000`) answers
  `422 VALIDATION_ERROR` with `{ field: "selections.<index>.customPrice", code: "INVALID_CUSTOM_PRICE" }`,
  the code a malformed price already gets, and nothing is written. Zero is not a real price; it
  used to let a band with no price pass the `BAND_PRICE_UNKNOWN` check and export 0.00. The estimate
  endpoint is unchanged; the Plus selection route gets the same rule (below).
- **Plus tariff selections: new 422 field code `PLUS_PRICE_UNKNOWN`**
  (`PATCH /v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/{tariffId}/selections`).
  A join without a custom price (`selected: true`, `customPrice: null`) on an item whose Plus price
  upper limit is unknown (the file's cell was blank, unreadable or 0) answers `422 VALIDATION_ERROR`
  with `{ field: "selections.<index>.selected", code: "PLUS_PRICE_UNKNOWN" }`: the export would
  have no price to write for it. The check is all-or-nothing: every refused entry is reported, with
  the index of the request array, and nothing is written. A `selected: false` entry (an existing
  join can still be cleared) and an entry with a custom price are never checked, and an item id
  outside the tariff and store is still silently skipped (never reported). The request and response
  schemas are unchanged; the route description and its 422 text name the new code.
- **Plus tariff selections: a custom price of 0 is refused**
  (`PATCH /v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/{tariffId}/selections`).
  A `customPrice` that is zero at two decimals (`0`, `0.0`, `0.00`, `000`) answers
  `422 VALIDATION_ERROR` with `{ field: "selections.<index>.customPrice", code: "INVALID_CUSTOM_PRICE" }`,
  the code a malformed price already gets, and nothing is written. Zero is not a real price; it
  used to let a join on an unknown Plus price upper limit export 0.00. The Plus estimate's `price`
  rule is unchanged.
- **Commission and Plus tariff selections: a custom price has at most ten integer digits**
  (`PATCH .../commission-tariffs/{tariffId}/selections`,
  `PATCH .../plus-commission-tariffs/{tariffId}/selections`). A `customPrice` with more than ten
  digits before the decimal point answers `422 VALIDATION_ERROR` with `INVALID_CUSTOM_PRICE` on
  `selections.<index>.customPrice`, instead of overflowing the stored column (`numeric(12,2)`) with a
  `500`. The `pattern` of `customPrice` in the spec changes accordingly.
- **Commission tariff bands: a limit of 0 is no price** (detail, estimate, selections and export
  of `.../commission-tariffs`). A band's price is its upper limit, else its lower limit, else the
  item's current price; a limit of 0 is now skipped as if it were absent, so a band is never priced,
  profited, selected or exported at 0. A band whose limits are all 0 and whose item has no known
  current price answers `price: null`, like a band with neither limit. The stored limits and the
  band a price falls into are unchanged; a negative limit is still refused at upload.
- **Commission and Plus commission tariff weeks across New Year**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/{commission-tariffs|plus-commission-tariffs}/import`).
  The period labels of a Trendyol tariff file carry no year. Each label used to take the UTC year
  of the upload, so a week crossing New Year was stored with a wrong year (a 365-day week, or one
  a year ahead). Now the first label takes the year (previous, same or next) that puts it closest
  to the upload day in Istanbul, and every later label the year closest to that first label. The
  stored `weekStartsAt`, `weekEndsAt` and period bounds, and the `validity` derived from them,
  follow. A week up to about six months before or after the upload day is placed in its own year.
- **Commission and Plus commission tariff uploads refuse a week that does not fit one Trendyol
  week** (same routes): periods that repeat a day count or a date-range label, day counts that add
  up to more than 7, or parsed dates that span more than 7 days answer `422` with
  `{ field: 'file', code: 'MALFORMED_SHEET' }`. The server log's `workbook.upload-rejected` line
  names the rule (`tariff-periods`, or `tariff-week-span` for the dates); the response carries no
  reason. Such files were accepted before and failed at export.
- **Commission tariff import and delete no longer queue a profit recompute**
  (`POST .../commission-tariffs/import`, `DELETE .../commission-tariffs/{tariffId}`). An order's
  commission never reads a tariff's bands, so the recompute found nothing to change. No response
  changes.

- **Workbook imports run through the generic workbook import**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/{discount-lists|marketplace-campaigns|flash-products|advantage-tariffs|plus-commission-tariffs|commission-tariffs}/import`).
  Each change below applies to all six pages (discount lists, marketplace campaign lists, flash
  product lists, advantage tariffs, Plus commission tariffs and commission tariffs) unless it
  names one:
  - The import route can answer `409` with `code` `IMPORT_IN_PROGRESS` (another import of the
    same store and page is running) or `UPLOAD_QUOTA_EXCEEDED` (the store already holds 50 lists
    of the page, or its stored source files plus the upload would exceed 200 MiB). The `409`
    response is added to the route's OpenAPI entry.
  - A Hepsiburada store answers `422` with `{ field: 'file', code: 'UNSUPPORTED_PLATFORM_FORMAT' }`.
  - A refused file answers the file code under its own name on every page, in place of the
    page's old code (breaking; the web ships the matching change in the same release):
    `WRONG_FILE_FOR_PAGE` in place of the six invalid-format codes (`INVALID_DISCOUNT_FORMAT`,
    `INVALID_CAMPAIGN_FORMAT`, `INVALID_FLASH_FORMAT`, `INVALID_ADVANTAGE_TARIFF_FORMAT`,
    `INVALID_PLUS_TARIFF_FORMAT`, `INVALID_TARIFF_FORMAT`); `EMPTY_FILE` in place of
    `EMPTY_DISCOUNT_FILE`, `EMPTY_CAMPAIGN_FILE`, `EMPTY_FLASH_FILE` and `EMPTY_TARIFF_FILE`;
    `NO_PERIOD` in place of `NO_TARIFF_PERIOD`; `DUPLICATE_WEEK` in place of
    `DUPLICATE_TARIFF_WEEK`. A client that matched the old codes must match the new ones.
  - The named sheet is selected strictly, with no first-sheet fallback: a workbook without it
    answers `422` with `{ field: 'file', code: 'SHEET_NOT_FOUND' }`, or with
    `{ field: 'file', code: 'WRONG_FILE_FOR_PAGE' }` and `meta` (`detectedFormatId`,
    `detectedPlatform`, `detectedPage`) when its first sheet is another page's file. Marketplace
    campaign files are read by position (the sheet name follows the campaign), so their first
    sheet is always the one read.
  - A write-back column under a shared formula, an array formula or a merged range, or a barcode
    cell longer than 256 characters, answers `422` with `{ field: 'file', code: 'MALFORMED_SHEET' }`
    at upload instead of failing the first export; nothing is stored.
  - The stored source file name drops control and format characters and path separators and is
    cut to 120 characters; a name that does not end in `.xlsx` is not stored, and the list then
    takes the page's default name instead of the file name stem (a commission or Plus commission
    tariff first takes its first period's date range label, as it did when the file name had no
    stem).
  - A typed `name` is trimmed and then checked: over 120 characters answers `422` with
    `{ field: 'name', code: 'NAME_TOO_LONG' }`, a control or format character (`\p{Cc}`,
    `\p{Cf}`, a bidi override for instance) answers `422` with
    `{ field: 'name', code: 'NAME_INVALID_CHARACTERS' }`; nothing is stored. Before, it was only
    trimmed and stored at any length. A name empty after trimming still falls back to the file
    name stem, then to the page's default name. The `name` form field gains `maxLength: 120` and
    a `pattern` in the OpenAPI spec.
  - The wrong-file answer (`WRONG_FILE_FOR_PAGE`, on every page) now always carries
    `errors[0].meta` with `detectedFormatId`, `detectedPlatform` and `detectedPage`; each is
    `null` when the file matches no known page. Before, a file that matched no page carried no
    `meta`.
  - A marketplace campaign file whose maximum price on a kept row is negative or has more than 10
    integer digits answers `422` with `{ field: 'file', code: 'MALFORMED_SHEET' }`; nothing is
    stored. Before, the file was stored, and an export that chose the maximum price for that row
    wrote the negative value into the campaign price cell. The same holds for an advantage tariff
    file whose star tier upper limit on a kept row is negative or has more than 10 integer digits
    (the export writes the selected tier's upper limit), and for a Plus commission tariff file
    whose Plus price ceiling on a kept row is negative or has more than 10 integer digits, or whose
    period offer is negative (the export writes the ceiling as the Plus price and the offer as
    the computed commission). An offer is read as it is stored, rounded to four decimals, so an
    Excel float residue such as `15.400000000000002` is kept and exported as `15.4`. Before, a
    negative Plus value was stored and exported, and a ceiling with more than 10 integer digits
    failed the import with `500`.
  - A commission tariff file whose current price on a kept row is negative or has more than 10
    integer digits, or whose band price (the band's upper limit, else its lower limit, for every
    band that has a commission in any period) is negative or has more than 10 integer digits,
    answers `422` with
    `{ field: 'file', code: 'MALFORMED_SHEET' }`; nothing is stored. The export writes the
    selected band's price, or the current price, into the new price column. Before, a negative
    or over-wide band price was stored and written into that cell on export, and a current price
    with more than 10 integer digits failed the import with `500`. A band without a commission
    in any period is not stored, so its limits are not checked.
  - A number read from the file that does not fit its database column answers `422` with
    `{ field: 'file', code: 'MALFORMED_SHEET' }`; nothing is stored. Examples: a Plus period offer
    or a commission tariff's current commission of 100 or more, a price the export never writes
    back with more than 10 integer digits, a stock outside the integer range. Before, the import
    failed with `500`.
  - A file the database could not store answers the same `422` `MALFORMED_SHEET`, and nothing is
    stored: a text cell anywhere below the header holding the character U+0000 (an XML `&#0;`;
    before, `500`), a flash product window date that is not a valid date or falls outside the years
    1900 to 9999 (before, a year below 1 failed with `500` and any other year was stored), and any
    other value Postgres refuses as a data exception while the rows are written (before, `500`).
  - A commission or Plus commission tariff file whose header gives a period of 10 or more days,
    or whose periods add up to 10 or more days, answers `422` with
    `{ field: 'file', code: 'MALFORMED_SHEET' }`; nothing is stored. Before, the file was stored
    and its export wrote a tariff selection label wider than the column's own. This check runs
    before the tariff week check, so such a file whose week is already taken answers
    `MALFORMED_SHEET`, not `DUPLICATE_WEEK`. A period header of 0 days, or more than seven
    periods with data, answers the same `422`; before, such a file was stored and every zero-day
    period became its own export file.
  - A commission or Plus commission tariff import checks the tariff week again inside its write
    transaction.
    Two uploads of overlapping weeks that start on different days, sent at the same time, no
    longer both store: the later one answers the duplicate week error (`DUPLICATE_WEEK`).
  - On advantage tariffs the commission source (`commissionSourceTariffId`) is checked after the
    file's rows are read, with the same field error (`INVALID_COMMISSION_SOURCE`): an upload that
    is both a refused file and names another store's commission tariff answers the file error.
- **Discount list and marketplace campaign list names follow the import's name rule, and their
  window dates answer field codes**
  (`PATCH /v1/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}`,
  `PATCH /v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}`). A `name`
  is trimmed and stored trimmed; an empty or whitespace-only name answers `422` with
  `{ field: 'name', code: 'NAME_REQUIRED' }`; over 120 characters answers `422` `NAME_TOO_LONG`
  and a control or format character `422` `NAME_INVALID_CHARACTERS` on `field: 'name'`, and
  nothing changes. Before, any non-empty string was stored as sent, and an empty name answered a
  Zod sentence as its code. A list stored before this rule with such a character in its name
  answers the same `422` while its stored name is sent back unchanged. The body's `name` gains
  `maxLength: 120` and a `pattern` in the OpenAPI spec. The `name` and `source_filename` columns
  of the six campaign list tables become `varchar(120)`.
  The window dates `startsAt` and `endsAt` of the discount and campaign config, on these two
  routes and on the two imports
  (`POST /v1/organizations/{orgId}/stores/{storeId}/discount-lists/import`,
  `POST /v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/import`), answer `422`
  with `code: 'INVALID_DATE'` on their field for a value that is not an ISO date time with an
  offset, and `DATE_OUT_OF_RANGE` for one whose UTC year is outside 1900 to 9999; nothing is
  stored or changed. Before, a malformed date answered a Zod sentence as its code, a year below 1
  failed at the database write with `500`, and any other year was stored as sent.
- **Workbook exports run through the generic workbook export**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}/export`,
  `POST /v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}/export`,
  `POST /v1/organizations/{orgId}/stores/{storeId}/flash-products/{listId}/export`,
  `POST /v1/organizations/{orgId}/stores/{storeId}/advantage-tariffs/{tariffId}/export`,
  `POST /v1/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/{tariffId}/export`,
  `POST /v1/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}/export`).
  Each change below applies to all six pages unless it names one:
  - The export writes only into the page's own sheet. Before, the same rows and columns were
    patched on every worksheet of the stored workbook.
  - Store access is checked before the record id in the path is validated: a malformed id answers
    the store access error (`403` or `404`) to a caller without write access to the store, and
    `422` only to a caller with it. Before, the id was validated first.
  - Every export condition answers `409` with a `code` of its own, in place of `CONFLICT`
    (breaking; the web ships the matching change in the same release):
    `STORED_FILE_MISSING` (no stored source file), `STORED_FILE_UNREADABLE` (the stored file no
    longer passes the workbook gate or the patcher), `STORED_FILE_UNRECOGNIZED` (its format id is
    unknown, its named sheet is missing or its header no longer resolves), `NO_WRITEBACK_COLUMN`,
    `ROW_MISMATCH`, `ROW_ANCHOR_MISMATCH`, `ROW_NOT_FOUND` and `EXPORT_FILENAME_COLLISION`. A
    client that matched `CONFLICT` must match these codes.
  - A parse worker that hits its memory or time limit while reading or patching a stored file
    answers `409` `STORED_FILE_UNREADABLE`, no longer `503`. `503` `IMPORT_BUSY`
    now means only that the parse queue is full or the job waited too long in it; the `503`
    description of all six export routes says so.
  - The stored file's named sheet is read strictly, with no first-sheet fallback: a stored file
    without it answers `409` `STORED_FILE_UNRECOGNIZED`.
  - A list whose items no longer pair with the stored file's kept rows (a different count, or a
    different barcode at a position) is refused with `409` `ROW_MISMATCH`. Before, those rows were
    skipped and the rest exported.
  - A commission tariff whose file holds two periods with the same day count, and whose export
    writes a different price into each, answers `409` `EXPORT_FILENAME_COLLISION`. Before, both
    window files took the same name and the `.zip` kept only one of them. The names are checked
    before anything is patched.
  - A plan of more files than one engine call patches (`MAX_PATCH_OUTPUTS`) answers `409`
    `STORED_FILE_UNREADABLE` before anything is patched. Only a commission or Plus
    tariff stored before its periods were checked at upload can plan that many window files.
  - A list stored before the upload checked its values can hold one the export's write rule
    refuses (a negative marketplace campaign maximum price, a tariff window wider than nine
    days). Its export answers `409` `STORED_FILE_UNREADABLE` instead of `500`.
  - Advantage tariff items are read in a fixed order (sort order, then barcode, then id). When two
    items with one barcode both carry a price, the later one in that order is written; before,
    the database's unspecified row order decided.
  - Downloads carry `Content-Disposition` with both an ASCII `filename` and an RFC 8187
    `filename*`, built from the stored upload name once control and format characters and path
    separators are dropped (a stored name that does not end in `.xlsx` falls back to the page's
    file name, `indirimler.xlsx` for discount lists and `kampanya.xlsx` for marketplace campaign
    lists, or to the list name for advantage tariffs, which before served the raw stored name),
    plus `Content-Length`,
    `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. Flash product lists keep their
    fixed `flas-urunler.xlsx`, Plus commission tariffs their fixed
    `plus-komisyon-tarifesi-<N>-gunluk.xlsx` or `plus-komisyon-tarifesi.zip`, and commission
    tariffs their fixed `urun-komisyon-tarifesi-<N>-gunluk.xlsx` or `urun-komisyon-tarifesi.zip`;
    their header gains the ASCII `filename` beside the `filename*` it already sent. A commission
    or Plus `.zip` of window files now stores its entries without compression; the entry names
    are unchanged. The ASCII `filename` keeps
    only letters, digits, spaces and `. _ ( ) -`; every other character becomes `_`, so header
    parameter syntax in an upload name (`;`, `=`, `*`, `'`, `%`) never reaches it.
- **The campaign workbook upload gate checks the zip layout, the root relationships and active
  parts** (`POST /v1/organizations/{orgId}/stores/{storeId}/{commission-tariffs|plus-commission-tariffs|advantage-tariffs|flash-products|discount-lists|marketplace-campaigns}/import`).
  An upload whose zip archive is not laid out the way the export reads it (a gap, an overlap or a
  hidden entry, a local header that disagrees with its directory record, an archive comment, zip64
  structures), or whose root relationships part (`_rels/.rels`) does not name `xl/workbook.xml` as
  its office document, answers `422` with `{ field: 'file', code: 'CORRUPT_FILE' }`. So does a
  workbook whose content types or relationships parts cannot be read whole: bytes that are not
  UTF-8, a declaration of another encoding, no root element, an element nested below a direct
  child of the root, or a `Relationship` or `Relationships` element (the root included) whose name
  matches only when letter case is ignored (`relationship`, `RELATIONSHIPS`). So does a
  relationship whose `TargetMode` is anything but exactly `Internal` or `External` (`external`,
  `EXTERNAL`, `External ` with a trailing space), and a relationship `Id` in the relationships part
  of a worksheet that holds a character reference, a tab or a line break; the root
  relationships part also follows the UTF-8 text rule of every scanned part (a U+0000 character
  anywhere, inside a comment included, is refused). So does an entry whose zip name is not a
  canonical part name, checked on the names alone before anything is decompressed: every name
  must be `[Content_Types].xml` or `/`-separated segments of the letters `A-Z` and `a-z`, the
  digits and `.`, `_`, `~`, `-`, with no empty segment (no leading `/`, no `//`), no `.` or `..`
  segment, no byte order mark in front of it, and a trailing `/` only on an empty folder entry. A
  backslash, a percent escape, a space, a letter outside ASCII (a long s that folds to `s`) and
  the interleaved pieces of ECMA-376 Part 2 (`name/[0].piece`, `name/[1].last.piece`, which a
  packaging reader joins into one part) are all refused this way. So is a workbook in which any
  XML part the gate keeps (not only the parts the reader opens), the root relationships part
  included, does not decompress to the same bytes from the central directory with a second
  decompressor as it did from the local headers (such as a stored deflate block whose two length
  fields disagree). A workbook that declares a macro, an Excel 4.0 macro or international macro
  sheet, a dialog sheet, an embedded object, an ActiveX control, an external link, a data
  connection or a query table, found by its content type, its relationship type (in every
  relationships part, also those of parts not named `.xml`) or its part name, or that holds a
  relationship whose `TargetMode` points outside the package (a linked picture, an OLE link),
  except a worksheet's hyperlink to an `http`, `https` or `mailto` address, answers `422` with
  `{ field: 'file', code: 'UNSAFE_CONTENT' }`. The six
  export routes read the stored file through the same gate: a stored file with any of these
  conditions answers `409 CONFLICT`. _(Superseded within this Unreleased: such a stored file now
  answers `409` `STORED_FILE_UNREADABLE`; see "Workbook exports run through the generic workbook
  export".)_ Valid Trendyol files are unaffected.
- **The campaign workbook upload gate checks cell styles, the sheet data, every formula field
  against an allow list, the parts it scans by their content, and relationship targets**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/{commission-tariffs|plus-commission-tariffs|advantage-tariffs|flash-products|discount-lists|marketplace-campaigns}/import`).
  An upload whose read sheet has a cell, an empty one included, whose style index names no
  `cellXfs` entry, or an `AlternateContent` element anywhere inside its sheet data (in a row, in a
  cell or deeper), answers `422` with `{ field: 'file', code: 'CORRUPT_FILE' }`. The gate now scans every zip
  entry whose content is XML, whatever its name (a worksheet stored as `.bin`, a VML drawing, a
  theme stored as `.dat`), not only the parts the reader opens. An entry that is not UTF-8 XML
  text (invalid UTF-8, a U+0000 character, a UTF-16 or UTF-32 byte order mark or layout, an
  EBCDIC XML declaration, an XML declaration of another encoding such as UTF-7), or an entry named `.xml`, `.rels` or `.vml` that
  does not hold XML, answers `422` with `{ field: 'file', code: 'CORRUPT_FILE' }`. Every formula
  field of every scanned part is checked, read with its character references decoded: cell
  formulas, defined names, data validation and conditional format formulas, table column formulas,
  chart series formulas, pivot cache formulas, the formula attributes and elements of shapes,
  form controls and VML drawings, the values of conditional format value objects (color scales,
  data bars, icon sets), hyperlink locations, camera tool ranges and the old
  formulas (`oldFormula`) of a shared workbook's revision log. A hyperlink's location is read as
  the `#fragment` of a web address, not as a formula, only when the hyperlink's relationship id
  names a relationship of its own worksheet's relationships part whose type is `hyperlink` and
  whose `TargetMode` is `External`; a missing id, an id the part lacks, an internal hyperlink or a
  relationship of another type leaves the location checked as a formula. Any other element of the
  worksheet whose relationship id (an `id` attribute of any prefix) names such an external
  hyperlink, such as a sheet background `<picture r:id>`, answers `422` with
  `{ field: 'file', code: 'UNSAFE_CONTENT' }`. Both rules read the element's relationship id the
  way an XML reader does: a tab, line feed or carriage return written in it counts for one space,
  and so does a carriage return followed by a line feed. A formula
  may call only functions of a fixed allow list of pure math, text, logical, lookup and date
  functions (`IF`, `SUM`, `VLOOKUP`, `XLOOKUP`, `OFFSET`,
  `SEARCH` and similar); a call to any other function (`WEBSERVICE`, `HYPERLINK`, `IMAGE`, `RTD`,
  `INDIRECT`, `LAMBDA`, every `IMPORT*` name and every unknown name included), in any Unicode case
  or compatibility form, answers `422` with `{ field: 'file', code: 'UNSAFE_CONTENT' }`. So does a
  formula that holds a name behind an internal Excel prefix other than `_xlfn.` and `_xlws.`
  (`_xludf.`, `_xleta.`, `_xlpm.`, `_xlnm.`), an `_xHHHH_` escape, a Unicode format character
  outside a string literal, a DDE link (`|`), a reference into another workbook (`[1]Sheet1!A1`,
  a `[` right after a name that does not start with a letter or `_` such as `1[1]Sheet1!A1`, a
  name right after the `]` that closes a structured reference such as `Table1[x]Sheet1!A1`, or a
  path, URL or `[` inside a quoted sheet name), a backslash outside a string literal (an unquoted
  path such as `\\host\share\Book2.xlsx!Name` or `C:\temp\[Book1.xlsx]Sheet1!A1`), a call of the
  result of an expression (a `(` right after `)`, `]` or `}`, as in
  `CHOOSE(1,WEBSERVICE)("http://evil.example/")`), a string literal, quoted sheet name or structured
  reference that never closes, more than 32 768 characters, stored or in its NFKC compatibility
  form (one character such as U+FDFA expands to eighteen), or anything but text (a comment,
  CDATA, a processing instruction or an element; the one child element Excel 2010+ writes in a
  cross-sheet data validation or conditional format, `<xm:f>`, is read as the formula). The
  formula fields of all scanned parts of one upload together may hold at most 12 000 000 UTF-16
  code units, each field counting its stored text, plus its NFKC form only when that form differs
  from the text (a real Trendyol export holds at most about 35 000, and none of its formula fields
  changes under NFKC); beyond that the upload answers `422` with
  `{ field: 'file', code: 'PAYLOAD_TOO_LARGE' }`. _(Changed within this Unreleased: the limit was
  24 000 000 code units with both forms of every field counted. For formula text that NFKC
  changes the limit is now in effect half as large, so such a file between the two limits,
  accepted before, is now refused: an upload with `422` `PAYLOAD_TOO_LARGE`, a stored file on
  export with `409` `STORED_FILE_UNREADABLE`.)_ A macro
  assignment (a non-empty `macro` or `fmlaMacro` attribute, a non-empty `FmlaMacro` element), a
  VML control script (a `ScriptText` element holding anything but white space), an SVG or HTML
  `script`, `foreignObject`, `iframe`, `object` or `embed` element, an XML Events `handler` or
  `listener` element, an event handler attribute (a name that starts with `on`, in any case), an
  SVG animation element (`set`, `animate`, `animateMotion`, `animateTransform` or `animateColor`,
  in any case: an animation can point a link at any address) or an attribute that names a web
  resource (`data`, `srcset`, `poster`, `background`, `action`, `formaction`, `codebase`,
  `archive`, `longdesc`, `usemap`, `cite`, `profile`, `manifest` or `ping`, in any case and
  whatever its value) on an SVG, XHTML or XML Events element, on any element of a part whose root
  element is `svg`, or on any element once the scan cannot follow the element nesting (elsewhere a
  spreadsheet `set` element, such as a pivot cache's OLAP set, and a VML `data` attribute pass),
  an `src` attribute or an attribute whose name ends in `href` (`href`,
  `althref`, `xlink:href` and the like), of any prefix (a VML picture, fill or shape link, an SVG
  image link), or an `xml:base` whose value is not relative (a URI scheme, a drive letter written `C:`
  or `C|`, a leading `//` or any backslash, read past the tabs and line breaks a URL parser
  removes; an `src` or `href` attribute of an `image` or `imagedata` element may hold a `data:`
  URI of a PNG, JPEG, GIF or BMP image (`image/png`, `image/jpeg`, `image/jpg`, `image/gif`,
  `image/bmp`), any other `data:` URI, an SVG image `image/svg+xml` included, is refused), a
  style attribute or style element whose CSS holds `@import`, a backslash or a quoted string that
  starts with an absolute URL, any CSS (a style, or any other attribute value such as an SVG
  `fill`, `filter`, `clip-path`, `mask`, `cursor` or `marker-*` attribute) whose `url()` target is
  anything but a `#fragment` of the document (a relative, absolute, `data:` or empty target;
  `url(#id)` passes) or that calls `image-set()`, `-webkit-image-set()`, `image()`, `src()` or
  `cross-fade()` (in every attribute value, so a data validation prompt such as `image(s)` is
  refused too; _superseded within this Unreleased: an Excel data attribute is now exempt, see
  "Workbook uploads: Excel data that only reads like a CSS call is no longer refused"_), each function name read the way a CSS tokenizer reads it: CSS escapes are decoded
  (`\75rl(`, `u\72l(` and `image\2dset(` spell `url(` and `image-set(`), a name that only ends
  with one of these (`xurl(`, `-webkit-image-set(`) counts too, and a backslash that spells no
  such call passes (a VML title `C:\logo`, the folder path Excel writes into a workbook such as
  `C:\Users\u\Desktop\Yeni klasor (2)\`, a picture description such as `C:\x\Trendyol(1).png`),
  any other attribute value with a backslash after its first `url(`, an `xml-stylesheet`
  processing instruction, an embedded object, a form or ActiveX control, a web publishing item, an Office web add-in, a
  custom ribbon, attached toolbars or XML maps (which bind data from a remote file), more than 256
  namespace declarations in scope at once in one scanned part (declarations that go out of scope
  when their element closes, such as the three Excel writes per picture of a drawing, no longer
  add up; the parts the reader opens keep their limit of 256 declarations in all),
  and a DOCTYPE, an ENTITY declaration or an unknown entity reference in any scanned part answer
  `422` `UNSAFE_CONTENT` too. Past markup the scan's strict XML reader cannot read, the rest of the
  part fails closed: it answers `422` `UNSAFE_CONTENT` when it holds anything that could be one of
  these, among them any name that starts with `on` (in any case, even in text), any SVG animation
  or web resource name, any of these CSS calls (escapes decoded) and any character reference.
  A relationship that points outside the package now passes only when it is
  a hyperlink to an `http`, `https` or `mailto` address in the relationships part of a worksheet,
  decided by the part's content (the part the relationships belong to has a `worksheet` root
  element in the SpreadsheetML main namespace, transitional or strict, declared on that root), not
  by its path; any other external relationship (a drawing or rich-data hyperlink, a
  web image, a file share, a rich-data part moved beside the worksheets), and an internal one whose
  target is a URI with a scheme, a drive letter (`C:` or `C|`), a network path or holds a
  backslash, read past the tabs and line breaks a URL parser removes (the rule the URL attributes
  follow), answers `422` `UNSAFE_CONTENT`. A relationships part is recognised by its content as
  well as by its name: every scanned entry whose root element's local name is `Relationships`,
  whatever its namespace (one written with a character reference included), is checked by these
  rules whatever it is named (`xl/media/image9.png`, say), and a root element named
  `Relationships` only when letter case is ignored makes the part one too; names such as
  `sheet1.xml.rel` with a long s or `sheet1.xml%2Erels` are refused earlier by the entry name rule
  above. A digital signature relationship (a signature origin, signature or
  certificate) answers `422` `UNSAFE_CONTENT` too: verifying a signature can fetch the
  certificate's revocation and issuer addresses. The six export routes read the stored file through
  the same gate: a stored file with any of these conditions answers `409 CONFLICT`. _(Superseded
  within this Unreleased: such a stored file now answers `409` `STORED_FILE_UNREADABLE`; see
  "Workbook exports run through the generic workbook export".)_ Valid Trendyol files are
  unaffected.
- **Campaign workbook import routes are guarded before the body is read**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/{commission-tariffs|plus-commission-tariffs|advantage-tariffs|flash-products|discount-lists|marketplace-campaigns}/import`).
  Store access and the `DATA_WRITE` capability are now checked in route middleware, so a caller who
  may not write to the store gets 403/404 without the multipart body being buffered. New responses:
  `413 PAYLOAD_TOO_LARGE` (`meta.maxBytes`, body above the 10 MiB file limit plus the multipart
  envelope), `415 UNSUPPORTED_MEDIA_TYPE` (body is not `multipart/form-data`), `503 IMPORT_BUSY`
  with `Retry-After` (the import transaction timed out or the connection pool was exhausted), and
  `429` after 10 imports per minute per user. The upload validator may now reject a file with
  `{ field: 'file', code: 'UNSAFE_CONTENT' }` (DTD or entity declarations, unknown entity
  references, over-long element names, excessive namespace declarations) and stricter
  `CORRUPT_FILE` / `PAYLOAD_TOO_LARGE` / `ROW_CAP_EXCEEDED` / `COL_CAP_EXCEEDED` outcomes for crafted
  archives. Valid Trendyol files are unaffected. A concurrent duplicate commission or Plus tariff
  week now answers `422 DUPLICATE_TARIFF_WEEK` instead of a 409 naming database columns.
  _(Superseded within this Unreleased: that code is now `DUPLICATE_WEEK`; see "Workbook imports
  run through the generic workbook import".)_ A
  malformed `commissionSourceTariffId` on the advantage import answers `422` with
  `INVALID_COMMISSION_SOURCE` instead of a 500. Non-breaking for well-behaved clients.
- **Campaign workbook export routes are rate limited** (`POST .../{tariffId|listId|campaignId}/export`
  on the same six resources): `429` after 20 exports per minute per user. Commission and Plus
  tariff exports of an unreadable stored file now answer `409 CONFLICT` instead of a 500. A stored
  file whose rows no longer match the export plan answers `409 CONFLICT` with a fixed `detail`
  (row numbers are logged server-side, not returned). _(Superseded within this Unreleased: an
  unreadable stored file now answers `409` `STORED_FILE_UNREADABLE`, and rows that no longer
  match answer `409` `ROW_MISMATCH`, `ROW_ANCHOR_MISMATCH` or `ROW_NOT_FOUND`; see "Workbook
  exports run through the generic workbook export".)_
- **Workbook reads are serialised per API process.** Imports and exports wait for one another; when
  too many are already waiting, the request answers `503 IMPORT_BUSY` with `Retry-After` instead of
  queuing indefinitely.
- **Workbook parses run in an isolated, limited worker.** The six campaign workbook import and export
  routes are affected; valid files are unaffected. The responses are:
  - an uploaded workbook that exhausts the parse worker's memory or time limit answers `422`
    with `{ field: 'file', code: 'PAYLOAD_TOO_LARGE' }`;
  - a parse that waits more than 20 s in the parse queue answers `503 IMPORT_BUSY` with
    `Retry-After`;
  - an export whose stored file hits a worker limit answers `503 IMPORT_BUSY` instead of `409`
    (superseded: it now answers `409` `STORED_FILE_UNREADABLE`, see "Workbook
    exports run through the generic workbook export").

  Before, such a file could crash or stall the API process. Non-breaking for well-behaved clients.
- **Generic HTTP errors no longer echo library messages.** `400 MALFORMED_REQUEST` and other
  pass-through HTTP errors carry fixed `detail` texts.

- **Description-only updates (no wire change).** The order detail `unitCostSnapshotGross` and
  `unitCostSnapshotVatRate` descriptions, the order GET summary and the claim list and summary
  descriptions now say the values come from the profit lines (`profit_lines`), not from the
  dropped legacy columns or the `order_fees` table.
- **Marketplace-neutral field names on orders and claims.** Three wire fields are renamed; types
  and values are unchanged:
  - `micro` becomes `isExportSale` on the order list rows and the order detail
    (`GET /v1/organizations/{orgId}/stores/{storeId}/orders`, `.../orders/{orderId}`).
  - `claims[].trendyolClaimId` becomes `claims[].marketplaceClaimId` on the order detail.
  - `trendyolClaimId` becomes `marketplaceClaimId` on the claim list rows
    (`GET /v1/organizations/{orgId}/stores/{storeId}/claims`); the `q` search covers the renamed
    field.

  The backing columns were renamed with the same meaning (`orders.is_export_sale`,
  `order_claims.marketplace_claim_id`, `order_claim_items.marketplace_claim_item_id`). Breaking;
  the web client ships the matching change in the same PR.
- **Order detail item commission rates and amounts are nullable and read from the profit lines
  only** (`GET /v1/organizations/{orgId}/stores/{storeId}/orders/{orderId}`).
  `items[].commissionRate` and `items[].commissionVatRate` are now `string | null`: both come from
  the order's estimate commission profit line (the VAT rate from the same line as the rate) and are
  null when no line supplies them. `items[].commissionGross` and `items[].refundedCommissionGross`
  are now `string | null` too: `'0.00'` when the profit lines carry none (e.g. a cancelled order,
  an item that was not returned), null when the profit part is empty (a platform the engine cannot
  compute, a corrupt stored line, or a failed in-request computation). Both are also null while a
  blocking `MISSING_COMMISSION_RATE` issue covers the item (naming it, or parcel-wide) and no
  commission line supplies the amount, so an item the engine could not price no longer shows a
  `'0.00'` commission next to a blank rate; once a settlement commission line lands, its amount is
  shown. `estimatedCommissionGross` and `settledCommissionGross` keep their null-when-no-line
  behaviour. The fallback to the item's
  legacy columns is gone, so an empty profit part no longer reads the stored item values or a
  fabricated `'0.00'` commission. Profit amounts are unchanged. Breaking for clients that treat the
  two amounts as always present; the web client shows an em dash for a null amount in the same PR.
- **Store disconnect description** (`DELETE /v1/organizations/{orgId}/stores/{storeId}`). The
  description now names the real cascades (orders with their items, profit lines and statements,
  among others) instead of the dropped settlements table. Description only; no wire change.
- **Scenario screens are priced by the profit engine.** Product pricing (list and quote), commission
  tariffs and Plus commission tariffs (detail and estimate), advantage product labels and flash
  products (detail and estimate), discount lists (detail and estimate) and marketplace campaigns
  (detail, estimate and target-margin suggestion). No wire-shape change: field names, types,
  nullability and enum values stay the same; values and some meanings change.
  - One engine: every profit, margin and breakdown comes from the scenario engine that also prices
    orders (a one-parcel hypothetical sale) instead of the old unit-pricing assembly. The store's
    profit settings apply: stopaj shows `0.00` when the store excludes it, and a negative net VAT
    is clamped to zero unless the store includes it.
  - Cost: the cost version effective at the scenario instant (now) is used, with that version's own
    VAT rate. A cost profile without a version, or whose chosen version is archived, counts as
    missing cost. Product pricing `cost` is the gross total of the cost versions effective now.
  - Shipping: the Barem / carrier tariff band is chosen at the priced price (each band, tier, offer
    or scenario price), not at the product's current sale price. Digital products carry no shipping
    and no platform service fee, and are calculable.
  - Commission: each screen keeps choosing its own rate (tariff band, Plus rate, advantage band or
    category rate, flash window band or the flat current rate, the discount / campaign three-tier
    chain) and the engine applies it verbatim; an explicit 0% band prices at zero commission.
    Product pricing resolves the rate through the engine's chain: the commission tariff band that
    covers the price in the current tariff period, else the synced product rate, else the category
    / category+brand rule (before, it looked at the category rule only). On discounts and campaigns
    a synced product rate of `0` counts as not sent and falls through to the category rate
    (`commissionSource: 'category'`).
  - Prices: the discount and campaign taxed base is rounded half up to the kurus before pricing. A
    zero price is a valid scenario: margins are `null` and the net profit is the loss.
  - Baskets: discount and campaign order scenarios price one parcel of `n` units -- `n` x cost, one
    shipping and one platform service fee, and `n` x desi; an order whose desi exceeds the carrier
    tariff has a `null` order profit.
  - Margins are rounded through the stored percent scale before two decimals, as on the orders list
    (a value can differ by one in the last digit).
  - Product pricing quote: `price` is the lowest kurus that meets the target, solved in closed form
    per price band. `NO_COST` is returned whenever the scenario has no usable cost line, including a
    profile without a version (which used to return `NOT_CALCULABLE`).
  - Campaign target margin: the settlement price that meets the target margin is solved by the same
    engine solver, capped at the item's max price; `NOT_CALCULABLE` when no price is computable,
    `UNREACHABLE` otherwise.
  - Failures: an item whose profit cannot be computed is still returned, with `calculable: false`,
    `reason: null` and empty profit fields, and the failure is logged server-side once per request;
    a store-wide failure (for example a missing fee definition) empties every item's profit the same
    way. The lists, details and estimates of these screens no longer answer 500 for a profit
    computation failure (the product pricing quote still reports an unexpected engine failure as
    an error).
  - The product pricing list and quote run as plain reads (no interactive transaction), so a large
    catalog no longer hits the 5-second transaction ceiling.
- **Tariff periods are compared at their real instant.** Period bounds are stored as Istanbul
  wall-clock; they are now converted to the real instant before comparing, and periods are
  half-open (`[start, end)`). The commission tariff and Plus validity badges, the advantage
  period choice and the commission tariff band of an order's profit no longer shift by three hours
  around a boundary. Order profits are re-written with engine version 5.
- **Orders list, tabs, summary and detail read the profit engine's statements.** No wire-shape
  change: field names, types and nullability stay the same; values and meanings change.
  - `reconciliationStatus` comes from the order's best-known profit statement. The engine derives
    it from which settlement-required lines have landed as marketplace-record or cargo-invoice
    actuals; a slot the engine could not estimate (missing shipping estimate or commission rate)
    keeps it at `PARTIALLY_SETTLED`. An order without a statement reports `NOT_SETTLED`. The
    `reconciliationStatus` filter uses the same rule.
  - `settledNetProfit` is the best-known net profit as soon as reconciliation has started
    (`PARTIALLY_SETTLED` or `FULLY_SETTLED`); before this change it appeared only at full
    settlement. `estimatedNetProfit` is the estimate statement's net profit. Both are `null` when
    the profit cannot be computed or the order is excluded from profit.
  - `saleMarginPct` / `costMarkupPct` come from the best-known statement; `sort=marginPct` /
    `-marginPct` sorts by that margin, orders without a statement last.
  - `saleGross` (list rows, summary revenue, detail top level) is the best-known statement's sale
    (sale minus sale return); the order's own sale when no statement exists yet; `0` for a
    cancelled order without a statement. Cancelled orders no longer add to revenue.
  - Tabs and counts: `costStatus=calculated` lists the orders not excluded from profit, including
    cancelled and not-yet-computable ones (shown without profit); `excluded` lists the orders
    stamped as excluded. `lossOnly` = best-known net profit below zero.
  - Summary: revenue, net profit, average margin (now rounded to 4 decimals) and the loss rate
    come from the best-known statements; excluded orders count in revenue, never in profit.
  - Detail `profitBreakdown` is built from the best-known statement and its selected lines (same
    fields; cost + marketplace fees + taxes + net profit = sale). It is `null` when the order has no
    net profit. When no statement is stored yet, the profit is computed for the request without
    writing anything; if that is impossible (an unsupported marketplace) or fails, the profit part
    is empty and the request still succeeds (a failure is logged server-side).
  - Detail items: `unitCostSnapshotGross`, `unitCostSnapshotVatRate`, `commissionGross`,
    `commissionRate`, `estimatedCommissionGross` and `settledCommissionGross` come from the order's
    profit lines (the rate falls back to the item column).
  - Deprecated, still on the wire: detail `fees` is always `[]`; `paymentOrderId`, `paymentDate`
    and item `commissionInvoiceSerialNumber` are always `null`.
- **Orders: cancelled profit, sale VAT, loss rate, item commission refunds and profit issues read
  the profit statements** (`GET .../orders`, `GET .../orders/summary`, `GET .../orders/{orderId}`).
  - Cancelled profit: a view whose statement is `CANCELLED` with a zero net profit (a cancellation
    without a penalty) reports `estimatedNetProfit` / `settledNetProfit` as `null` on the list
    and the detail. A cancellation penalty (non-zero net profit) stays visible: the engine writes
    no estimate line for a cancellation, so the penalty shows on `settledNetProfit`.
  - `saleVat` (list rows and detail top level) comes from the same source as `saleGross`: the
    best-known statement's output VAT; the order's own sale VAT when no statement exists yet; `0`
    for a cancelled order without a statement. Before, it was always the order column, so a
    cancelled or returned order showed its pre-cancel / pre-return VAT.
  - Summary `lossOrderRate.totalCount` counts the in-scope orders whose best-known statement has a
    net profit and is not `CANCELLED`. Cancelled orders and orders without a profit (excluded, not
    computable, no statement yet) no longer inflate the denominator. `lossCount` uses the same
    filter plus a negative net profit (the two counts are separate queries, so a write landing
    between them can skew one refresh): a penalized cancellation shows in the `lossOnly` list but
    enters neither count.
  - Detail items: `refundedCommissionGross` comes from the best-known `COMMISSION_REFUND` lines
    (`'0.00'` when none) instead of the item column. `commissionGross` no longer falls back to the
    item column when the order has profit lines and none supplies it: it reads `'0.00'` (e.g. a
    cancelled order). The item columns are kept only when the profit part is empty (a platform
    the engine cannot compute, or a profit read that failed).
  - Detail `profitBreakdown.listGross` and `sellerDiscountGross` now derive from the selected
    `SALE` and `SALE_RETURN` profit lines instead of the order columns; a returned or cancelled item
    drops out of both, so `listGross - sellerDiscountGross` equals `saleGross`.
  - Added detail `profitIssues` (new `ProfitIssue` schema: `code`, `orderItemId`, `detail`): the
    best-known statement's issues that still apply to its selected lines. A warning a later
    actual made moot is left out (`CARRIER_NOT_RECOGNIZED` once an actual shipping line is
    selected; `SELLER_CARGO_AGREEMENT_ESTIMATE` once a cargo invoice replaced every shipping
    estimate, while it stays when the statement has no shipping line). `CARRIER_NOT_RECOGNIZED`
    is also left out while a `SELLER_CARGO_AGREEMENT_ESTIMATE` notice is shown: no cargo invoice
    is coming on such an order, so the two notices would contradict each other.
    For `CARRIER_NOT_RECOGNIZED`, `detail` is the carrier name as Trendyol reported it, or null
    when blank. Always an array; empty when the profit part is empty.
- **Live performance reads the estimate statement.** Net profit, margin and profit/cost ratio cover
  the orders whose estimate is computed (the ratio's denominator is their cost from the statement);
  per-order profit and margin are `null` unless computed; today's products `unitCost` comes from the
  order's cost lines; the new-order notification computes the profit for the request when the
  statement is not written yet (empty, never an error, when that fails). Also fixed: an order that a
  re-delivery made computable while it waited in the live-performance buffer was counted twice and
  its stock was decremented twice.
- **Live performance computes today's profit in the request and divides margins by the estimate's
  sale** (`GET .../live-performance/kpis`, `.../chart`, `.../orders`). Breaking for the KPI
  schema: `netProfitYesterday`, `marginToday`, `marginYesterday`, `profitCostRatioToday` and
  `profitCostRatioYesterday` become nullable; the web client ships the matching change in the
  same PR.
  - A today order whose estimate statement is not written yet is computed read-only in the
    request, so its profit reaches the KPIs, the chart and the feed at once. At most a fixed
    number of such orders are computed per request; the rest count as pending and the overflow is
    logged once. Yesterday reads stored statements only.
  - Margin divides the costed net profit by the estimate's own sale (after any return), not the
    order's sale; revenue and `pendingRevenueToday` keep the order's own sale.
  - The four ratios are `null` when their denominator is zero, and `netProfitYesterday` is `null`
    when yesterday has no costed order (was `0.00`).
  - Feed tabs: an order without a computed estimate is listed under `pending` (with buffer rows),
    not `calculated`; `counts.calculated` / `counts.pending` match the KPIs' costed subset.
- **Product pricing list leaves zero-priced variants unscored** (`GET .../product-pricing`). No
  wire-shape change: a variant whose sale price is 0 is returned with `calculable: false`, empty
  profit / margin fields, `cost: null` and OK statuses, so it is dropped by `calculableOnly` and by
  `profitStatus=profitable|breakeven|loss`, and sorts with the null-profit rows. The quote is
  unchanged.
- **Returns summary money KPIs** (`refundDeductionGross`, `commissionRefundGross`,
  `costReturnGross`, `netImpactGross`) come from the profit lines, dated by the transaction date of
  each return line's earliest settlement record; an item's cost return counts with its return.
  Count KPIs are unchanged.
- **Lira-only: cost profiles, cost status and the organization lose their currency / FX fields.**
  Breaking; the web client ships the matching change in the same PR. The platform works in Turkish
  lira only — every amount is implicitly TL.
  - `CostProfile`, `CreateCostProfileInput`, `UpdateCostProfileInput` and `CostProfileVersion`
    drop `currency`, `fxRateMode` and `manualFxRate`. Amounts are plain TL decimal strings.
  - `VariantSummary.costStatus` (products list) and `ProductPricingItem.costStatus` (product
    pricing list) narrow from `OK | NO_PROFILES | FX_STALE | FX_MISSING` to `OK | NO_PROFILES`. A
    variant with at least one active cost profile is `OK`; `currentCostTry` is the plain TL sum of
    those profiles and keeps its name.
  - `Organization` drops `currency` (both the create response and the list rows); `timezone`
    stays.
- **Shipping estimate status: `NO_DESI` description** (`shippingEstimateStatus` on the products
  list and the product pricing list). Description only, no wire change. `NO_DESI` is now
  described as what it is: a defensive fallback for a variant with no estimate row. The
  estimate never returns it, because desi has a 0 floor: a variant Trendyol sent no desi for is
  priced at desi 0, and the products list flags it with `isDimensionalWeightMissing`.

- **Products list: missing-desi tab, counter and per-variant flag**
  (`GET /v1/organizations/{orgId}/stores/{storeId}/products`, `GET .../products/facets`,
  `PATCH .../products/variants/{variantId}/dimensional-weight`,
  `PATCH .../products/variants/dimensional-weight`). Additive on the wire; the generated types
  make the new response fields required, and the web client ships the matching change in the
  same PR. `overrideMissing` accepts `desi`: variants with no seller desi override and a synced
  (Trendyol) desi of 0; an explicit override of 0 is not missing. It composes via AND with
  `status`, or with the default listing scope when `status` is omitted, exactly like `cost`.
  `overrideCounts` gains `missingDesi`, the number of products with at least one in-scope
  desi-missing variant, equal to `pagination.total` of the `overrideMissing=desi` list.
  `VariantSummary` gains `isDimensionalWeightMissing: boolean` (the same rule per variant), and
  `VariantDimensionalWeightResponse` returns it too, so a client can update its row after a
  save. The PATCH desi endpoints keep their request body (`dimensionalWeight`) and every other
  response field; only their descriptions now name the renamed seller-override column
  `dimensional_weight_override` (formerly `dimensional_weight`, an internal rename). The
  `VariantSummary.dimensionalWeight` and `syncedDimensionalWeight` descriptions now say the
  value is never null in practice (`"0"` when Trendyol sent no desi). Shipping estimates are
  unchanged: a desi-missing variant is still priced at desi 0.
- **Products list: `ProductWithVariants.images` becomes `imageUrls`**
  (`GET /v1/organizations/{orgId}/stores/{storeId}/products`). Breaking; the web client ships
  the matching change in the same PR. Product images now live on the product row as an ordered
  url list, so the list response carries `imageUrls: string[]` (uri strings in the order Trendyol
  sends them; the first entry is the primary image, empty when the product has no images)
  instead of `images: ProductImage[]`. The `ProductImage` component schema (`{ id, url, position }`)
  is removed. Every other image field keeps its name, type and value: `ProductPricingRow.imageUrl`,
  `OrderItemVariant.productImageUrl`, `AttachedVariant.productImageUrl`, the live-performance
  `thumbUrl` fields and the campaign/tariff detail `imageUrl` fields still return the primary
  image; only the descriptions of `ProductPricingRow.imageUrl` and
  `AttachedVariant.productImageUrl` are reworded.
- **Products list: a default listing scope, the variant status enum, and counters that match
  the list** (`GET /v1/organizations/{orgId}/stores/{storeId}/products`,
  `GET .../products/facets`, `GET /v1/organizations/{orgId}/products/missing-cost-stats`).
  Breaking for the list and facets endpoints; the web client ships the matching change in the
  same PR.
  - **Default scope.** Without `status`, the list returns every variant that is still in
    Trendyol's feed (`delistedAt` null) and not `ARCHIVED`: on-sale, out-of-stock or
    closed-for-sale, locked and blacklisted variants alike. A product is listed when at least
    one of its variants is in scope, and its `variants[]` / `variantCount` cover only those
    variants. Previously there was no default and the web page always sent `status=onSale`.
  - **`status` values.** The filter takes the `ProductVariantStatus` values `ON_SALE`,
    `NOT_ON_SALE`, `LOCKED`, `BLACKLISTED`, `ARCHIVED`, plus the API-only `DELISTED`. Every
    value except `DELISTED` means "in that status and not delisted"; `DELISTED` returns every
    delisted variant whatever its last status, so the six values partition the catalog. The
    old values `onSale`, `archived`, `locked` and `blacklisted` are removed and now return
    `422 VALIDATION_ERROR`.
  - **Search (`q`).** A barcode or stock code hit now counts only on a variant that passes the
    variant-level filters (`status` or the default scope, `overrideMissing`, `vatRateIn`).
    Searching the barcode of an archived variant without `status=ARCHIVED` no longer returns
    its parent with only the unrelated in-scope siblings. Title and `productMainId` hits are
    unchanged.
  - **`overrideMissing`.** Only `cost` remains, and it now means "no active (non-archived) cost
    profile attached" instead of reading the unused `costPrice` column, so the tab matches the
    missing-cost banner. Without `status` it also applies the default scope. `vat` is removed
    (Trendyol sends a VAT rate on every variant and the page has no VAT input) and returns
    `422 VALIDATION_ERROR`. `vatRateIn` is unchanged.
  - **`VariantSummary`.** `status` is now the `ProductVariantStatus` enum (it was the computed
    `onSale | archived | locked | blacklisted | inactive`). New nullable `statusReason`:
    Trendyol's `lockReason` for a `LOCKED` variant and `blacklistReason` for a `BLACKLISTED`
    one, null otherwise. Removed: `costPrice` (cost lives in cost profiles), `isRushDelivery`,
    `fastDeliveryOptions` and `locationBasedDelivery` (Trendyol dropped the rush-delivery
    fields in August 2026; `deliveryDuration` is the only delivery signal).
  - **`ProductWithVariants`.** `description` is removed from the list response (it stays in
    the database).
  - **Facets.** `ProductFacetsResponse.overrideCounts` is now `{ missingCost, total }`
    (`missingVat` removed), both over the default scope: `total` equals the unfiltered list's
    `pagination.total` and `missingCost` equals the `overrideMissing=cost` list's total. Brand
    and category facets count only products with an in-scope variant. The product-pricing
    toolbar reads its brand/category options from this endpoint while the pricing list still
    returns archived and delisted variants, so a brand or category whose products are all
    archived or delisted keeps its pricing rows but has no filter option there (accepted for
    now).
  - **Missing-cost stats.** `count` and `totalVariants` keep their names but count only
    in-scope variants (archived and delisted variants no longer inflate them). New
    `missingProductCount` (products with at least one cost-missing in-scope variant, each
    counted once) at the top level and in every `byStore` row; `byStore` lists stores with at
    least one in-scope variant, ordered by `storeId`. Additive for clients that ignore unknown
    fields.
  - **Product aggregates.** `Product.totalStock`, `minSalePrice` and `maxSalePrice`, which back
    `stockMin` / `stockMax`, `salePriceMin` / `salePriceMax` and the `salePrice` / `totalStock`
    sorts, now cover only in-scope variants: an archived or delisted variant no longer moves a
    product's stock or price range. The parameter descriptions say so; no shape change.

- **Barem eligibility in shipping estimates reads `deliveryDuration` alone, and commission-rate
  product counts follow the variant status.** No request or response shape changes:
  - Every per-variant shipping estimate (the `GET .../products` variant fields
    `estimatedShippingNet` and `shippingTariffApplied`, the shipping fee in
    `GET .../product-pricing`, and the commission tariff, Plus tariff, advantage label, flash
    product, discount and campaign estimates built on that fee) treats a variant as
    Barem-eligible only when its `deliveryDuration` is set and within the default carrier's
    `maxBaremEligibleDeliveryDuration` (0 = ships today, 1 = ships by tomorrow). The
    `isRushDelivery` and `fastDeliveryOptions` signals, which Trendyol stopped sending in August
    2026, no longer qualify a variant; a variant without a `deliveryDuration` gets the desi-based
    tariff.
  - `GET .../commission-rates`: `productCount` and `productScope=active` count a product when at
    least one of its variants has a status other than `ARCHIVED` (a variant removed from the
    Trendyol feed still counts). The product-level `approved` flag, always true for the synced
    catalog, is no longer part of the rule; `GET .../product-pricing` stops filtering its
    candidate set on it too, which leaves that set unchanged.

- **Each campaign price option now carries its own basket block, the campaign estimate returns
  that block, and the `current` estimate is per-unit again.** Three changes to the
  `MarketplaceCampaigns` surface, all inside this Unreleased (the vertical has not shipped):
  - `MarketplaceCampaignDetailItem.scenario` is replaced by two required-but-nullable
    `CampaignBasketScenario` blocks: `maxBasket` (the assumed basket at Trendyol's maximum price)
    and `customBasket` (the same at the saved custom price; null when none is saved). Each is
    framed on its OWN price whichever option `selection` names, because on an ORDER-presentation
    row both price cards now headline their own order. The saved `selection` no longer enters
    the compute.
  - `EstimateCampaignItemResult` gains a required-but-nullable `basket`
    (`CampaignBasketScenario`): for an order-scoped breakdown it is the block behind it —
    identical to the row's `maxBasket` / `customBasket` for that price — so the breakdown modal
    can show quantity, basket total, discount, Trendyol's funded share and what the customer pays
    for ANY price, saved or merely typed. Null whenever `breakdownScope` is `unit`.
  - `breakdownScope` is `order` only for the campaign scenarios (`max`, `custom`) of an
    ORDER-presentation campaign, framed on the scenario's own price; `current` is `unit` on every
    campaign (the row's current cell shows the per-unit figure, and not participating is a
    single-unit sale). This supersedes the order-scoped `current` sub-bullet below, and with it
    the saved-selection basket anchor.

- **Campaign selections refuse a `CUSTOM` choice with no price, and the campaign estimate
  exposes the Trendyol-funded split per unit plus an order-scoped `current` scenario.**
  Three changes to the `MarketplaceCampaigns` surface:
  - `PATCH .../marketplace-campaigns/{campaignId}/selections` now rejects any entry whose
    `selection` is `CUSTOM` while `customPrice` is `null` — **422** `VALIDATION_ERROR`, field
    `selections`, code `CUSTOM_PRICE_REQUIRED`, with `meta.itemId` naming the offending row
    exactly as the existing `CUSTOM_PRICE_ABOVE_MAX` ceiling guard does. It was previously
    persistable and failed silently: the row saved as "participating", the exported sheet's
    price cell came out blank, and Trendyol skipped the product with no error the seller could
    see. Nothing is written when the guard fires. (Zod-side cross-field refinements can now
    carry `meta` in general — `params` on a custom issue is merged into `errors[].meta`.)
  - `EstimateCampaignItemResult` gains two required-but-nullable fields:
    `customerPaidUnitPrice` (what the customer pays for ONE unit under the campaign) and
    `trendyolFundedUnitAmount` (what Trendyol contributes for one unit, written as the
    difference so paid + funded closes on the unit settlement `price` to the kuruş). The funded
    amount is `"0.00"` when the campaign's funding rate is zero. Both are `null` for the
    `current` scenario (no campaign to split) and whenever `breakdownScope` is `order`: at
    ORDER presentation the per-unit effective price is a synthetic average describing no real
    unit (in a 2-al-1-öde the customer pays full price for one unit and nothing for the other),
    and ORDER rows already carry the split as basket totals on `CampaignBasketScenario`. The
    fields exist for `NET` and the conditional PERCENT variants — the majority of live
    campaigns — where that block is null and the funding was otherwise invisible.
    `CampaignBasketScenario` itself is unchanged.
  - `EstimateCampaignItemResult.breakdownScope` now follows the CAMPAIGN's presentation rather
    than the scenario: an ORDER-presentation campaign (`BUY_X_PAY_Y` / `NTH_PRODUCT` / a
    conditional-`AMOUNT` discount) returns `order` for EVERY scenario, `current` included,
    where the order is the same assumed basket priced campaign-free (n × current price). The
    `current` scenario previously returned a per-unit breakdown there, so a seller clicking the
    row's order-level campaign-free profit got a modal that did not add up to it. The assumed
    quantity for the `current` scenario is derived from the item's SAVED price choice — the
    basket the row totalled — not from the current price, which matters for
    `CONDITIONAL_BASKET`/`AMOUNT` where n = ceil(minBasket / price). **The `discount-lists`
    estimate still returns a unit breakdown for its `current` scenario — the two verticals
    deliberately differ until that back-port lands.** _(Superseded within this Unreleased by the
    per-option basket entry above: `current` is unit scope again, so the verticals agree.)_

- **Discount detail items now carry a per-product settlement scenario, and the list exposes its row-layout presentation** (`GET /v1/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}`). `DiscountListDetailItem` gains a nullable `scenario` block backed by a new `DiscountBasketScenario` schema (`{ assumedQuantity, basketTotal, basketPaidTotal, basketDiscountTotal, orderNetProfit, orderMarginPct, currentOrderNetProfit }`; money as 2-decimal strings). It reframes the basket-scoped discount types (`CONDITIONAL_BASKET`, `CONDITIONAL_QUANTITY`, `CODE`, `BUY_X_PAY_Y`, `NTH_PRODUCT`) around the "single-product basket at the minimum qualifying quantity" assumption: `assumedQuantity` (n) is that minimum quantity (`ceil(minBasket/price)` for basket/code, `minQuantity` for quantity, `buyQuantity` for X-al-Y, `nthIndex` for Nth-product), `basketTotal` is n × current price, `basketPaidTotal` is n × the 2dp effective unit (so it never disagrees with the row's displayed unit price), and `basketDiscountTotal` is the difference. The three order-profit fields run the REAL profit engine over the whole n-unit order (design §11, profit-formula.md §2.4): the order model is n× product cost with 1× shipping and 1× PSF (the platform service and shipping are per-parcel, and a basket of n identical units ships as a single parcel), so `orderNetProfit` is the engine's net profit for the discounted basket priced at `basketPaidTotal`, `orderMarginPct` = `orderNetProfit / basketPaidTotal × 100`, and `currentOrderNetProfit` is the same engine run for the same n units at the campaign-free `basketTotal` as an apples-to-apples baseline. Commission, stoppage and net VAT follow the engine formula (the net-VAT clamp is handled naturally by the engine), and the platform service is counted ONCE per order rather than once per unit (the earlier add-back model over-counted it). Each is null when its scenario is not calculable (and `orderMarginPct` also when the paid basket is zero). `scenario` is null for `NET` (its showcase price genuinely changes, so the existing discounted-price presentation stays) or a non-positive current price. `DiscountListDetail` also gains a top-level `scenarioPresentation` enum (`UNIT` | `ORDER`, new `DiscountScenarioPresentation` schema) telling the UI which row layout the config calls for: `UNIT` for `NET` and the conditional trio's `PERCENT` variants (the unit price genuinely drops), `ORDER` for `BUY_X_PAY_Y`, `NTH_PRODUCT`, and the conditional trio's `AMOUNT` variants (the effective unit is a synthetic average). Everything is computed on the backend with decimal.js. The estimate endpoint (`POST .../discount-lists/{listId}/items/{itemId}/estimate`) gains a `breakdownScope` enum (`unit` | `order`) on `EstimateDiscountItemResult`: for the discounted scenario of an ORDER-presentation list it now returns the ORDER-level breakdown — the same one the detail row's settlement scenario is built from (both go through the shared order-breakdown compute) — with `price` set to the order revenue (`basketPaidTotal`) and the breakdown carrying n× cost, 1× shipping, 1× PSF; every other case keeps the per-unit breakdown and `breakdownScope: "unit"`.
- **Discount detail drops the monetary summary; selection now persists only on save** (`GET /v1/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}`). The `summary` object is removed from `DiscountListDetail` entirely — with it the `DiscountListSummary` schema and its `perOrderCost` / `avgProfitDelta` / `itemCount` / `selectedCount` fields. The frontend now treats product selection as ephemeral client state: the total count is derived from `items.length` and the included count from local UI state, so the server no longer aggregates a card. Each item still carries `included` (its last SAVED choice), and the `PATCH .../selections` + `POST .../export` round-trip is unchanged — the export button first flushes the full selection, then downloads. The list screen's `DiscountListListItem.selectedCount`/`exported` are untouched.
- **Discount order-limit dropped and both campaign dates are now required** (`POST /v1/organizations/{orgId}/stores/{storeId}/discount-lists/import`, `PATCH .../discount-lists/{listId}`, `GET .../discount-lists`, `GET .../discount-lists/{listId}`). The `orderLimit` config field is removed from the import form and config PATCH bodies, from `DiscountListListItem`/`DiscountListDetail`, and the derived `summary.maxTotalCost` is gone (it fed only that weak ceiling metric). Both `startsAt` and `endsAt` are now required on every config write — a missing start returns `422` with field code `START_REQUIRED`, a missing end with `END_REQUIRED` (the existing `END_BEFORE_START` check is unchanged). The DB columns stay nullable, so rows written before this rule remain readable; the requirement is enforced at the input-validation layer only.
- **Discount detail items now expose their commission-band ladder** (`GET /v1/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}`). `DiscountListDetailItem` gains a nullable `commissionBands` field — an array of `DiscountCommissionBand` (`{ lowerLimit, upperLimit, commissionPct }`, mirroring `AdvantageCommissionBand` / `FlashCommissionBand` on the wire; money at 2 decimals, percent at 4). Populated from the campaign-anchored tariff week already resolved for the per-item compute (no extra query); null when no covering week resolved bands for the barcode (the rate fell to the synced product rate or category rate). Lets the UI show which band the current and discounted prices land in via the shared commission-bands popover.
- **Discount commission bands are authoritative ONLY from a tariff week that covers the anchor; no covering week means no bands** (`GET /v1/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}` and `POST .../discount-lists/{listId}/items/{itemId}/estimate`). The covering-week lookup runs for EVERY anchor — the anlık `now` path and a future campaign start alike — and an expired tariff week is never used (an expired week's tariff no longer exists for the seller on Trendyol's side). When no week covers the anchor there are no bands at all: the per-item commission chain falls through to the product's synced rate, then the category rate, then NO_COMMISSION. The previous best-available fallback (the latest-uploaded tariff's last-available period) is removed, so both the anlık path with an un-uploaded current week AND a future start whose week is not uploaded now yield no bands. `DiscountListDetail`'s boolean flag is renamed from `commissionPeriodExpired` to `commissionTariffOutdated` — true only when the store has ≥1 commission tariff yet none covers the anchor (uploads are stale or don't reach the campaign start), false when a covering week resolved OR the store has no tariffs at all.
- **Discount commission bands anchor to a future campaign start, and the resolving tariff period is now exposed** (`GET /v1/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}` and `POST .../discount-lists/{listId}/items/{itemId}/estimate`). When a list's `startsAt` is in the future, the commission tariff bands are resolved from the tariff week that COVERS that start instant (across all of the store's tariffs), not just the latest-created tariff; lists with a past/absent `startsAt` are unchanged. Both `DiscountListDetail` and `EstimateDiscountItemResult` gain two nullable fields — `commissionTariffName` and `commissionPeriodLabel` — describing which tariff and period actually fed the band tier (null when no tariff resolved).
- **`buyboxStatus` removed from the discount detail item** (`GET /v1/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}`). The `items[].buyboxStatus` field is gone from `DiscountListDetailItem`; the discount vertical no longer surfaces Buybox ownership. The Excel column is still tolerated on import and simply ignored.
- **Trendyol order webhook becomes a durable queue with a deferred ingest mode**
  (`POST /v1/webhooks/orders/{storeId}`, Paket D). The response semantics and the
  processing model changed; no request/response body shape change:
  - Transient processing faults now return **200** (not 5xx). The event row is
    persisted and left unprocessed with an exponential backoff
    (`[1, 5, 15, 60]` minutes, up to 5 attempts, then a terminal close); the
    sync-worker consumer tick replays it. Trendyol's retry is no longer the
    replay engine, so a permanently-failing store is never driven to PASSIVE by a
    transient fault.
  - A re-delivery of a still-unprocessed event returns **200** and is never
    reprocessed in-request, at any age. A per-row lease (an in-request claim or
    the consumer tick) is the sole processor, which makes concurrent
    double-processing structurally impossible.
  - In-request catalog repair is removed: the receiver makes **zero** marketplace
    vendor calls in the request path (uncatalogued barcodes are resolved by the
    60s variant-resolution tick), so intake is DB-only and never blocks on
    Trendyol. The order is still always written.
  - Deferred intake is now the **default** processing model (permanent cutover,
    issue #460): the route validates + persists + returns 200 only, and the
    sync-worker consumer tick does all processing (order processing latency ≤5s;
    ~1s measured live). In-request processing is now an **emergency escape hatch**
    behind `WEBHOOK_INTAKE_INLINE=true` (literal `true`, fail-safe default off) —
    used only when the sync-worker is down for a long stretch. The earlier
    `WEBHOOK_INTAKE_DEFERRED` flag is removed. Processing webhook orders therefore
    requires the sync-worker to be running (the durable queue holds events until
    it is; nothing is lost while it is down).
- **Parseable deterministic drops now leave an audit trail**
  (`POST /v1/webhooks/orders/{storeId}`). No request/response body change; still
  200. The two drops whose payload clears Zod — a SANDBOX store's delivery in
  production and a supplier-mismatch body — now persist a CLOSED `webhook_events`
  row (`processedAt` stamped + `processingError` carrying a machine-scannable
  `dropped:` prefix) before answering 200, instead of returning 200 with no
  trace. A re-delivery of the same drop stays 200 and writes no second row. The
  oversize drop (rejected before parsing) and the Zod-invalid drop
  (missing/untrustworthy key fields) still write no row — they hold no reliable
  idempotency tuple to key one against.

### Added

- **Why an order's profit is not computable** (`GET /v1/organizations/{orgId}/stores/{storeId}/orders`,
  `GET .../orders/{orderId}`). Each orders list row and the order detail gain `profitBlockers`, an
  array of the new `ProfitBlocker` component schema (`code`, a `ProfitIssueCode`; `detail`, the
  same optional English context as `ProfitIssue.detail`, e.g. the carrier name for
  `CARRIER_NOT_RECOGNIZED`). Both the list row and the detail read the best-known profit
  statement, so a list row carries a blocker only while the order's profit is really not
  computable: after a cargo invoice makes the best-known view computable, the row's
  `profitBlockers` is empty even while its `estimatedNetProfit` (the order-time estimate) stays
  null. It is filled only while the best-known statement's status is `NOT_COMPUTABLE`: its
  blocking issues, one entry per distinct code + detail, ordered by the code in the
  `ProfitIssueCode` enum order (not alphabetical), then by detail (null first). It is empty for a
  computed, excluded, cancelled or statement-less order; the detail computes the statement in the
  request when none is stored, as for its other profit fields. Which codes block is decided here,
  not by the client. A stored issues value the reader rejects leaves that list row's
  `profitBlockers` empty and is logged (`[profit-read]`, surface `order-list`) instead of failing
  the page. `profitIssues` on the detail is unchanged. Additive.
- **Desi on live performance rows, and each waiting line's cost gap**
  (`GET /v1/organizations/{orgId}/stores/{storeId}/live-performance/today-products`,
  `GET .../live-performance/buffer/{bufferId}`). Each today products row and each buffer detail
  line gains `dimensionalWeight`, `syncedDimensionalWeight`, `isDimensionalWeightOverridden` and
  `isDimensionalWeightMissing`, with the same values and rule as the products list
  (`VariantSummary`): a desi of 0 is a real desi and a digital variant never misses one. A row or
  line whose barcode resolves to no variant carries `null`, `null`, `false`, `false`. Each buffer
  detail line also gains `isCostMissing`: the line's gap in the calculability gate that holds the
  order in the buffer (no cost profile linked, or the barcode resolves to no variant, which is
  `true`). The `LivePerformanceTodayProducts` and `BufferDetail` component schemas gain the
  properties. Additive. When two variants of a store share a barcode, a buffer line (and a today
  products row that comes only from the buffer) now describes the first match by variant id, on
  both surfaces and in the gate, so its name, desi and cost gap name one variant.
- **Two desi profit exclusion reasons** (`GET /v1/organizations/{orgId}/stores/{storeId}/orders`,
  `GET .../orders/{orderId}`). `profitExclusionReason` gains `DESI_DEADLINE_MISSED` (the order
  waited in the live-performance buffer and a product still had no desi when its day ended) and
  `LATE_DESILESS_ARRIVAL` (the order arrived from a past day while a product had no desi). An
  order now enters profit only when every non-digital item has both a cost and a product desi (a
  desi of 0 counts), so an order can now also be permanently excluded for a missing desi. When
  both the cost and the desi are missing, the cost reason is written. Like the cost reasons, the
  new ones are permanent. The `costStatus=excluded` filter includes them. Additive (a client
  that switches over the enum needs the two new values).
- **The six workbook import responses carry `prefilledRows`**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/{discount-lists|marketplace-campaigns|flash-products|advantage-tariffs|plus-commission-tariffs|commission-tariffs}/import`).
  `prefilledRows` (integer, required) is the number of kept rows that already held a choice in
  a column the export writes and the import does not read as a choice. Those values stay in the
  exported file unless a choice is made for the row. The `ImportTariffResponse`,
  `ImportPlusTariffResponse`, `ImportAdvantageTariffResponse`, `ImportFlashProductsResponse`,
  `ImportDiscountListResponse` and `ImportMarketplaceCampaignResponse` component schemas gain
  the property. Additive.
- **`SyncLogResponse.syncType` and `SyncFreshness.syncType` gained `PRODUCTS_CHANGES`**
  (both sync-log list endpoints, `GET /v1/organizations/{orgId}/sync-logs` and
  `GET /v1/organizations/{orgId}/stores/{storeId}/sync-logs`, plus the single sync-log
  read `GET .../sync-logs/{syncLogId}`). `PRODUCTS_CHANGES` is the hourly, cron-only catalog-changes sync: a date-window
  walk of the approved product list that picks up new products and changed products
  (status, lock/archive and metadata changes) between nightly full scans. It never
  delists. Additive enum widening; every existing value is unchanged. The manual trigger
  `POST /v1/organizations/{orgId}/stores/{storeId}/syncs` rejects it with **422**
  `VALIDATION_ERROR` (`errors[].code = INVALID_SYNC_TYPE`), exactly like
  `PRODUCTS_DELTA`. The `TriggerSyncBody.syncType` enum is unchanged (still `ORDERS` /
  `PRODUCTS` / `SETTLEMENTS` / `CLAIMS`); only its description and the route description
  now name both cron-internal types. The spec snapshot was regenerated to pick it up.
- **Marketplace campaign (Kampanyalar) endpoints — import, list, detail, config, selections, delete**
  (`/v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns…`, OpenAPI tag
  `MarketplaceCampaigns`). Sixth campaign vertical, for the campaigns TRENDYOL designs and
  the seller opts into (as opposed to `discount-lists`, which the seller designs). Six routes:
  - `POST .../marketplace-campaigns/import` — multipart upload of Trendyol's campaign
    product-selection `.xlsx` (`file`, optional display `name`) plus the campaign
    configuration as string form fields. The configuration reuses the discount vocabulary
    minus `CODE` (`discountType` = `NET` / `CONDITIONAL_BASKET` / `CONDITIONAL_QUANTITY` /
    `BUY_X_PAY_Y` / `NTH_PRODUCT`, plus `valueKind` / `value` / `minBasketAmount` /
    `minQuantity` / `buyQuantity` / `payQuantity` / `nthIndex` and the required `startsAt` /
    `endsAt`) and adds `trendyolFundingPct` — the share of the campaign discount Trendyol
    absorbs, percent, default `"0"`, rejected above 100 with field code
    `FUNDING_PCT_OVER_100`. The sheet's FIRST sheet is read by position (its name changes per
    campaign) and every column is resolved by header name; each row stores both the current
    price and Trendyol's "Maksimum Girebileceğin Fiyat" ceiling. Rows missing a barcode, a
    current price or a maximum price are skipped. **201** →
    `ImportMarketplaceCampaignResponse` `{ campaignId, name, itemCount, matched, unmatched,
    skippedRows }`. A file whose header layout is not the campaign export is **422**
    `VALIDATION_ERROR` (`file` / `INVALID_CAMPAIGN_FORMAT`). _(Superseded within this Unreleased:
    the code is now `WRONG_FILE_FOR_PAGE`; see "Workbook imports run through the generic workbook
    import".)_
  - `GET .../marketplace-campaigns` — `MarketplaceCampaignListResponse` `{ data:
    MarketplaceCampaignListItem[] }`, newest first: the full configuration (including
    `trendyolFundingPct`), `itemCount`, `selectedCount` (items whose price choice is not
    `NONE`), `exported`, `updatedAt`.
  - `GET .../marketplace-campaigns/{campaignId}` — `MarketplaceCampaignDetail`: the
    configuration, the resolving commission tariff (`commissionTariffName` /
    `commissionPeriodLabel` / `commissionTariffOutdated`, same covering-week anchor rule as
    the discount vertical), `scenarioPresentation` (`UNIT` | `ORDER`), and every item as a
    `MarketplaceCampaignDetailItem`. Each item carries THREE priced scenarios instead of the
    discount vertical's two — `current` (not participating), `maxScenario` (Trendyol's price
    ceiling) and `customScenario` (the seller's own price, null when none is saved) — plus its
    saved `selection` (`NONE` | `MAX` | `CUSTOM`), `customPrice`, `commissionBands` ladder and
    a nullable `scenario` settlement block (`CampaignBasketScenario`). The campaign scenarios
    are priced at the SELLER's settlement amount: Trendyol funds `trendyolFundingPct` of the
    discount, and commission, stoppage, VAT and margin all run off the seller amount, not off
    what the customer paid. `CampaignBasketScenario` mirrors `DiscountBasketScenario` and adds
    `trendyolFundedTotal` (the funded share of the basket discount); it is framed on the
    item's SAVED `selection`, so an item left on `MAX` shows the max-price order even when a
    custom price is stored. Profit is computed on read and never stored. _(The single
    `scenario` block is replaced within this Unreleased by per-option `maxBasket` /
    `customBasket` — see the Changed entry above.)_
  - `PATCH .../marketplace-campaigns/{campaignId}` — `UpdateMarketplaceCampaignBody` →
    `{ id }`. **FULL REPLACE**: every configuration column is written on every call, so an
    omitted field is reset rather than preserved. In particular `trendyolFundingPct` defaults
    to `"0"`, so omitting it zeroes the seller's funding rate — clients must submit the whole
    configuration. Same validator as the import form, so an invalid combination is **422**
    `VALIDATION_ERROR`. Items are untouched; scenarios recompute on the next detail read.
  - `PATCH .../marketplace-campaigns/{campaignId}/selections` — `UpdateCampaignSelectionsBody`
    → `{ updated }`. `mode: "set"` writes the given `{ itemId, selection, customPrice }` rows;
    `mode: "all"` applies the `MAX` option and `mode: "none"` clears participation across the
    whole campaign in one statement. `customPrice` is stored independently of `selection`
    (`all` / `none` never discard it). A `customPrice` above the item's maximum is **422**
    `VALIDATION_ERROR` with field `selections` and code `CUSTOM_PRICE_ABOVE_MAX` (Trendyol
    refuses such a price on re-upload, and nothing downstream re-checks it). Items outside the
    campaign are ignored.
  - `DELETE .../marketplace-campaigns/{campaignId}` — **204**, items cascade.

  All six require `data:read` (list / detail) or `data:write` (the rest) and are store-scoped:
  a campaign id from another store or organization is **404**, indistinguishable from a
  missing one. Money is GROSS 2-decimal strings, commission percents 4-decimal, dates ISO
  8601 UTC. The per-item estimate, target-margin and export routes land separately (see the
  bullets below).

- **Marketplace campaign estimate + target-margin endpoints** (OpenAPI tag
  `MarketplaceCampaigns`). Two read-only compute routes; both require `data:read` and are
  store-scoped, so a campaign or item id from another store or organization is **404**.
  - `POST .../marketplace-campaigns/{campaignId}/items/{itemId}/estimate` —
    `EstimateCampaignItemBody` `{ scenario, customPrice? }` → `EstimateCampaignItemResult`.
    The full profit breakdown (income plus commission, shipping, platform service, stoppage
    and VAT) for ONE item under one of the three scenarios the detail row shows: `current`
    prices it campaign-free at its current price, `max` at Trendyol's ceiling, `custom` at the
    seller's own price — taken from the request body when given (the screen buffers a typed
    price before saving) and from the stored `customPrice` otherwise. It reuses the same
    engine, commission chain and resolvers the detail view uses, so the modal cannot disagree
    with the row. A custom price above the item's maximum is **422** `VALIDATION_ERROR` with
    field `customPrice` and code `CUSTOM_PRICE_ABOVE_MAX` (meta carries `maxPrice`); a custom
    scenario with no price anywhere is **422** with code `CUSTOM_PRICE_REQUIRED`. `price` is
    what the SELLER earns. No state changes (POST only because it carries a body).
  - `POST .../marketplace-campaigns/{campaignId}/target-margin` — `TargetMarginBody`
    `{ targetMarginPct }` → `TargetMarginResult` `{ suggestions: [{ itemId, price, reason }] }`,
    in the campaign's own row order. Per item, the SMALLEST campaign price whose net margin
    reaches the target, capped at that item's maximum; `reason` is `UNREACHABLE` when no price
    up to the maximum reaches it and `NOT_CALCULABLE` when cost, shipping or commission inputs
    are missing. The commission is anchored on the maximum price's band, so a suggestion
    landing in a cheaper band is optimistic and the row's own scenario shows the real figure.
    **This endpoint COMPUTES AND RETURNS — it persists nothing**: the client holds the
    suggested prices in its local buffer and they become durable only through the selections
    endpoint, so the seller's choices keep a single source of truth.

- **Marketplace campaign export endpoint**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}/export`).
  The ninth and last Kampanyalar route (list, import, selections, update, estimate,
  target-margin, detail, delete, export), byte-preserving sibling of the discount-lists export
  below: returns Trendyol's ORIGINAL uploaded file (`XLSX`, `attachment; filename*=UTF-8''…`)
  with each row's chosen price written into the "Kampanyalı Satış Fiyatı" column — `MAX` writes
  the maximum allowed price, `CUSTOM` writes the seller's own price, `NONE` leaves the cell
  untouched (the source cell is always already empty, so unlike İndirimler's "Evet"/"Hayır"
  toggle there is no deviation comparison — only rows with a resolved price are patched). Row
  alignment zips the campaign's `sortOrder`-ordered items against the file's imported
  (non-skipped) data rows with a barcode defensive guard. Marks the campaign exported. **409**
  `CONFLICT` when the campaign kept no stored source file (or it is unreadable / not a
  recognizable Kampanyalar export). `DATA_WRITE` capability. _(Superseded within this
  Unreleased: these now answer `409` `STORED_FILE_MISSING`, `STORED_FILE_UNREADABLE` or
  `STORED_FILE_UNRECOGNIZED`; see "Workbook exports run through the generic workbook export".)_

- **Discount list import endpoint**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/discount-lists/import`) — Fifth
  campaign vertical, for Trendyol's "İndirimler" (Promosyon & Fiyat) product-selection
  Excel. Multipart: the `.xlsx` `file` + an optional display `name` + the discount
  configuration as string form fields (`discountType` = `NET` / `CONDITIONAL_BASKET` /
  `CONDITIONAL_QUANTITY` / `BUY_X_PAY_Y` / `NTH_PRODUCT` / `CODE`, plus the per-type
  parameters `valueKind` / `value` / `minBasketAmount` / `minQuantity` / `buyQuantity` /
  `payQuantity` / `nthIndex` and the optional `orderLimit` / `startsAt` / `endsAt`).
  Per-type requirements are enforced field-level — **422** `VALIDATION_ERROR` with codes
  such as `VALUE_REQUIRED`, `MIN_BASKET_REQUIRED`, `NTH_INDEX_OUT_OF_RANGE` (2–4),
  `PAY_MUST_BE_LESS_THAN_BUY`, `FIXED_PRICE_ONLY_FOR_NTH`, `PERCENT_OVER_100`,
  `END_BEFORE_START`; file rejections use `field:"file"` codes (`EMPTY_DISCOUNT_FILE`,
  `INVALID_DISCOUNT_FORMAT`, plus the shared upload guards). _(Superseded within this Unreleased:
  these are now `EMPTY_FILE` and `WRONG_FILE_FOR_PAGE`; see "Workbook imports run through the
  generic workbook import".)_ Columns are resolved by
  header NAME (Trendyol's own "Kampayaya" typo matched verbatim, corrected spelling
  accepted as fallback); the "Güncel Satış Fiyatı" TEXT column ("250 ₺" style) is
  currency-parsed; a row already marked "Evet" imports as included. **201**
  `{ listId, name, itemCount, matched, unmatched, skippedRows }`; the raw file is kept
  for the byte-preserving export. `DATA_WRITE` capability.
- **Discount list read / write endpoints** (İndirimler — `GET`, `PATCH`, `DELETE`
  under `/v1/organizations/{orgId}/stores/{storeId}/discount-lists`). Siblings of the
  Flash Products surface, on top of the import upload above:
  - `GET .../discount-lists` returns `{ data: [...] }`, one row per saved list with its
    discount configuration (type + per-type parameters), item count, included count and
    the exported flag. Money fields are GROSS decimal strings, dates ISO.
  - `GET .../discount-lists/{listId}` returns the list with a summary card and every item
    carrying a `current` and a `discounted` price scenario, both computed on read and never
    stored. Each scenario's reduced commission comes from a THREE-TIER chain resolved on
    that scenario's OWN price: (1) the store's latest commission-tariff band covering the
    price, else (2) the variant's synced commission, else (3) the category rate — so an
    item's discounted price can land in a different band than its current price. When
    nothing in the chain resolves the item is `calculable:false` with `reason:"NO_COMMISSION"`
    (`NO_PRODUCT` / `NO_COST` / `NO_SHIPPING` cover the other gaps). The summary card reports
    `perOrderCost` (Σ current − discounted over included items), `maxTotalCost`
    (`perOrderCost × orderLimit`, or `null`) and `avgProfitDelta` (mean discounted − current
    net profit over the included, calculable items). Money fields are GROSS decimal strings.
  - `POST .../discount-lists/{listId}/items/{itemId}/estimate` returns the full profit
    breakdown (income + commission / shipping / PSF / stoppage / VAT) for ONE item under the
    `{ "scenario": "current" | "discounted" }` body, reusing the same chain + engine the
    detail uses — so the breakdown modal never disagrees with the detail row. Read-only
    (POST only because it carries a body). `DATA_READ` capability. `calculable:false` with a
    `reason` and a `null` breakdown when the item is unmatched, uncostable or has no
    resolvable commission; an unknown `scenario` is a **422** `VALIDATION_ERROR`.
  - `PATCH .../discount-lists/{listId}` full-replaces the discount configuration (the name
    changes only when provided); the same validator that gates the import gates this body,
    so an invalid combination is a **422** `VALIDATION_ERROR`. Returns `{ id }`.
  - `PATCH .../discount-lists/{listId}/selections` toggles item inclusion: `mode:"set"`
    updates the given `{ itemId, included }` rows (a foreign itemId is silently skipped),
    `mode:"all"` / `"none"` flip the whole list. An empty `"set"` payload is a **422**
    `SELECTIONS_REQUIRED`. Returns `{ updated }`.
  - `DELETE .../discount-lists/{listId}` hard-deletes the list (items cascade); **204**.
  - `POST .../discount-lists/{listId}/export` returns Trendyol's ORIGINAL uploaded file
    (`XLSX`, `attachment; filename*=UTF-8''…`) with each row's participation written back
    into the "Kampayaya Dahil Edilsin Mi?" column — an included row as "Evet", an excluded
    one as "Hayır". Only cells that DEVIATE from the source are byte-patched, so every other
    cell is byte-for-byte intact and a list with no changes vs. the original streams back
    verbatim. Marks the list exported. **409** `CONFLICT` when the list kept no stored source
    file (or it is unreadable / not a recognizable İndirimler export). `DATA_WRITE` capability.
    _(Superseded within this Unreleased: these now answer `409` `STORED_FILE_MISSING`,
    `STORED_FILE_UNREADABLE` or `STORED_FILE_UNRECOGNIZED`; see "Workbook exports run through the
    generic workbook export".)_
- **Generic manual-sync trigger endpoint** (`POST /v1/organizations/{orgId}/stores/{storeId}/syncs`).
  Enqueues a PENDING MANUAL `SyncLog` for the `syncType` chosen in the body
  (`{ "syncType": "ORDERS" | "PRODUCTS" | "SETTLEMENTS" | "CLAIMS" }`) and returns
  **202** `{ syncLogId, status: "PENDING", enqueuedAt }`. Applies the same
  auth / store-access / cooldown contract as the old PRODUCTS-only route: **409**
  `SYNC_IN_PROGRESS` (with `meta.existingSyncLogId`) when a sync of that type is
  already active for the store, **429** `RATE_LIMITED` (with `Retry-After`) inside
  the per-`(store, syncType)` cooldown window. `PRODUCTS_DELTA` is rejected with a
  **422** `VALIDATION_ERROR` (`errors[].code = INVALID_SYNC_TYPE`) — it is a
  cron-internal lightweight walk, not a user-triggerable sync. The prior
  `POST /v1/organizations/{orgId}/stores/{storeId}/products/sync` route is now
  **deprecated** (marked `deprecated: true` in the spec) but stays live during the
  web-client migration; it behaves identically to this route with
  `syncType: "PRODUCTS"`.
- **`SyncLogListResponse.freshness`** (array) — added to both sync-log list
  endpoints (`GET /v1/organizations/{orgId}/sync-logs` and
  `GET /v1/organizations/{orgId}/stores/{storeId}/sync-logs`). Each entry is
  `{ storeId, syncType, completedAt, recordsProcessed }` and reports the single
  most-recent COMPLETED run per `(store, syncType)`. Computed with a raw
  `DISTINCT ON`, so it survives the recent-5 cap on `data`: a sync type whose last
  success scrolled off the recent list (e.g. a nightly PRODUCTS scan behind five
  newer ORDERS runs) is still reported here. Returned in both default and
  `active=true` modes, and scoped to the caller's accessible stores for
  MEMBER/VIEWER.
- **`VariantSummary.delistedAt`** (ISO 8601 date-time | null) — surfaced on every
  product-list variant row (`GET /v1/organizations/{orgId}/stores/{storeId}/products`
  and the shared `VariantSummary` shape). Set when the marketplace catalog delta last
  reported the variant as delisted (removed from the active catalog); `null` while it
  is still listed. Drives the compact "delisted" badge on the products table variant
  rows. Read straight from `ProductVariant.delistedAt` — no computation.
- **`SyncLogResponse.syncType` gained `PRODUCTS_DELTA`** — the incremental
  product-freshness delta sync added in the earlier product-freshness wave. Additive
  enum widening; the existing `ORDERS` / `PRODUCTS` / `SETTLEMENTS` / `CLAIMS` values
  are unchanged. The spec snapshot was regenerated to pick it up.

### Changed

- **`QuoteBreakdown` now carries three grouped allocation totals** (every
  price-estimate endpoint that returns a breakdown: commission / Plus / advantage
  / flash tariff item estimates and the product-pricing quote). The profit-detail
  dialogs render a grouped "satış nereye gitti" allocation, so the sums are done
  once in the backend (`serializeBreakdown`) rather than re-added on the client:
  - `marketplaceFeesGross` — commission + shipping + platform service + any
    micro-export fees (derived so buckets without their own field are included).
  - `taxesGross` — stoppage + net VAT.
  - `totalDeductionsGross` — `saleGross − netProfit`; the four groups
    (cost + marketplace + taxes + profit) close to `saleGross`.
- **New-order notification summary now carries `status` and `isPromotion`**
  (`GET /v1/organizations/{orgId}/stores/{storeId}/live-performance/notification-summary`).
  Two fields were added to `NewOrderNotificationSummary` so the realtime toast can
  suppress notifications that are not genuinely new sales:
  - `status` — the order lifecycle status (`OrderStatus`) for `source=orders`;
    `null` for `source=buffer` (a buffer entry is not yet an order). The client
    drops a toast for a `CANCELLED` / first-seen-`RETURNED` order.
  - `isPromotion` — `true` when the order graduated from the live-performance
    buffer (its `promotedFromBufferAt` is set), meaning the seller already saw it
    as a cost-missing buffer entry; always `false` for buffer sources. The client
    suppresses a duplicate ding for an already-shown order.
- **Manual product sync now enforces a per-store cooldown**
  (`POST /v1/organizations/{orgId}/stores/{storeId}/products/sync`). A second
  user-initiated (MANUAL) trigger inside the cooldown window returns **429
  RATE_LIMITED** with a `Retry-After` header of the remaining seconds
  (PRODUCTS window: 30 minutes). Scheduled (CRON) and store-connect (BOOTSTRAP)
  runs never count toward the cooldown, and a currently-active sync still
  returns **409 SYNC_IN_PROGRESS** (the cooldown check runs before the slot
  acquire and does not preempt it). No schema change to the response shape —
  the route already documented `429` via `Common429Response`.
  (`POST /v1/webhooks/orders/{storeId}`). Trendyol replays every failed request
  (4xx included) every 5 minutes until it succeeds, then flips the webhook to
  PASSIVE, so the response code is now a control signal:
  - Deterministic dead-ends return **200** instead of 4xx so Trendyol stops
    retrying a request that can never succeed: a malformed JSON body, a
    schema-invalid payload (previously `422`), a payload naming a different
    seller (supplier mismatch, previously `401`), an unknown order status, and a
    payload that passes schema validation but crashes the mapper. The event is
    logged (issue codes / reason only — never the payload) and, where a row was
    already written, marked terminal (`processedAt` + `processingError`).
  - Transient faults (fee-definition resolution, intake, DB) now return **200**
    too (superseded within this Unreleased by the Paket D entry above): the event
    is persisted and left unprocessed with a backoff, and the sync-worker consumer
    tick — a durable queue over `webhook_events` — is the replay engine instead of
    Trendyol's retry. Only a genuine infrastructure failure BEFORE the row is
    persisted still surfaces as **5xx**.
  - A re-delivery whose prior idempotency row is still unprocessed returns **200**
    and is NOT reprocessed at any age (the earlier 2-minute stale-reprocess branch
    is removed): a per-row lease — the consumer tick or an in-request claim — is
    the sole owner of unprocessed rows, so a second writer can never double-insert
    order items.
  - A non-UUID `storeId` path segment now returns **404** (guarded before the
    DB) instead of collapsing a Prisma error to `500`.
  - Repeated credential-mismatch / decrypt / shape failures for one store
    self-heal: past an in-memory threshold the stale `webhookSecret` is nulled so
    the reconciler rotates a fresh one; the webhook reads as disabled (**404**)
    until it does. `401` (auth) and `404` (disabled) still flow normally as the
    intended PASSIVE-flip heal path.
  - Added a 1 MB body limit and a per-store rate limit (bucketed on the
    `storeId` path param). Oversize bodies drop with **200**; rate-limit
    overflow returns **429** (transient for Trendyol). The documented response
    set drops `400` and adds `429`.
- **Trendyol order webhook now accepts sparse line financial fields**
  (`POST /v1/webhooks/orders/{storeId}`). Per-line `lineUnitPrice`,
  `lineGrossAmount`, and `vatRate` are now **optional** in the request body
  schema (they were required). The mapper already tolerates their absence
  (`?? 0`, logged as `orders.sparse-line`), so the receiver was needlessly
  stricter than the pipeline it feeds. Trendyol STAGE test-order webhooks omit
  these fields; previously such payloads were silently 200-dropped with no row
  written, which killed the webhook's real-time path (intake + toast + live
  performance) under stage testing. A sparse order now intakes as an estimate,
  and a later sync/settlement reflects the real values. `sellerId` and
  `quantity` remain required.
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
  by the offer window's END (covering week → covering sub-period → barcode band; a window straddling a
  sub-period boundary anchors to the period containing its END — verified live 2026-07-07, TB300X450R
  10 Temmuz flash), falling back to the flat "Mevcut Komisyon" rate with NO category fallback. Each
  detail item exposes `commissionSource` (`band` / `current`) and, on a band, `commissionBands` (the
  ladder for the ⓘ popover). NOTE: the exact J/M participation label casing is pending a live vendor
  round-trip.

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
  _(Superseded within this Unreleased: the code is now `WRONG_FILE_FOR_PAGE`; see "Workbook
  imports run through the generic workbook import".)_
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
  SNAPSHOT-AT-CREATE: an order captures the settings when it is created. A change recomputes the
  stored profit of the store's orders that never captured them; orders that did keep their captured
  settings. Defined types: `ProfitSettings`, `UpdateProfitSettingsInput`.

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

- **Today's products keep an order line without a variant**
  (`GET /v1/organizations/{orgId}/stores/{storeId}/live-performance/today-products`). Such a line is
  shown by its barcode, resolved like a buffer line, instead of being dropped. Wire shape unchanged.
- **Products list `brandId` and `categoryId` pattern in the spec**
  (`GET /v1/organizations/{orgId}/stores/{storeId}/products`). The `pattern` of the `brandId` and
  `categoryId` query parameters is `^\d+$`, where it used to read `^d+$`, which their own examples
  did not match. Spec only; runtime parsing is unchanged.
- **Organization name pattern in the spec** (`POST /v1/organizations`).
  `CreateOrganizationInput.name.pattern` is `[\p{L}\p{N}]`, where it used to carry a literal `/u`
  suffix that no value matched. The validation itself is unchanged. Documentation only.
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
