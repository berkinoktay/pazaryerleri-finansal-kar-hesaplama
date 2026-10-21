# Trendyol Marketplace Entegrasyonu - Ürün Entegrasyonu V2

Bu dokümanın içeriği `urun-entegrasyonu-v2/` klasörüne, Trendyol'un kendi sayfa yapısını takip eden tek tek dosyalara ayrılmıştır. Güncel sayfa listesi: https://developers.trendyol.com/docs/ürün-v2-api-endpoint.md (tam dizin: https://developers.trendyol.com/llms.txt).

Her dosyanın ilk satırında kaynak adresi ile Trendyol'daki son güncelleme tarihi yazılıdır. Canlı ortamda doğrulanmış farklar dosyanın başındaki "PazarSync notu" bloğundadır; doküman ile canlı yanıt çelişirse not geçerlidir.

## Kullandığımız servisler

1. [Ürün Filtreleme - Temel Bilgiler v2](./urun-entegrasyonu-v2/urun-filtreleme-temel-bilgiler-v2.md)
2. [Ürün Filtreleme - Onaylı Ürün v2](./urun-entegrasyonu-v2/urun-filtreleme-onayli-urun-v2.md) — katalog senkronu, barkod kurtarma, mağaza bağlama probu
3. [Ürün Filtreleme – Onaylı Ürün V2 Stok ve Fiyat](./urun-entegrasyonu-v2/urun-filtreleme-onayli-urun-v2-stok-ve-fiyat.md) — stok/fiyat delta senkronu
4. [Stok ve Fiyat Güncelleme (updatePriceAndInventory)](./urun-entegrasyonu-v2/stok-ve-fiyat-guncelleme.md) — fiyat yazma
5. [Toplu İşlem Kontrolü (getBatchRequestResult)](./urun-entegrasyonu-v2/toplu-islem-kontrolu-getbatchrequestresult.md) — fiyat yazma sonucu
6. [Kargo Firması Filtreleme Servisi](./urun-entegrasyonu-v2/kargo-firmasi-filtreleme-servisi.md) — varyanttaki `cargoProviders` kodlarının listesi

## Referans (şu an kullanılmıyor)

7. [Ürün Buybox Kontrol Servisi](./urun-entegrasyonu-v2/urun-buybox-kontrol-servisi.md)
8. [Ürün Güncelleme - Onaylı Ürün v2](./urun-entegrasyonu-v2/urun-guncelleme-onayli-urun-v2.md)
9. [Ürün Güncelleme - Onaysız Ürün v2](./urun-entegrasyonu-v2/urun-guncelleme-onaysiz-urun-v2.md)
10. [Kategori Özellik Listesi v2](./urun-entegrasyonu-v2/kategori-ozellik-listesi-v2.md)
11. [Kategori Özellik Değerleri Listesi v2](./urun-entegrasyonu-v2/kategori-ozellik-degerleri-listesi-v2.md)
12. [Ürün Varyantlama](./urun-entegrasyonu-v2/urun-varyantlama.md) — eski birleşik dokümandan; Trendyol'da ayrı sayfası yok

Ürün yaratma, silme, arşivleme, kilit kaldırma, video, marka yaratma ve güncelleme sonucu kontrol servisleri ürün yönetimine ait olduğu için yerele alınmadı; gerekirse yukarıdaki dizinden okunmalı.
