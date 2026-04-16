# Trendyol API Servis Limitleri

**Servis limitleri ve entegrasyon servisleri hakkında detaylı bilgi.**

---

## İçindekiler

1. [Ürün Servisleri](#ürün-servisleri)
2. [Sipariş Servisleri](#sipariş-servisleri)
3. [Ortak Etiket Servisleri](#ortak-etiket-servisleri)
4. [İade Servisleri](#iade-servisleri)
5. [Muhasebe ve Finans Servisleri](#muhasebe-ve-finans-servisleri)

---

## Ürün Servisleri

Aşağıdaki tablo üzerinden ürün servislerimizin limitlerini kontrol edebilirsiniz.

| Alan | Entegrasyon Servisi              | Rate Limitation |
| ---- | -------------------------------- | --------------- |
| Ürün | Ürün Aktarma                     | 1000 req/min    |
| Ürün | Ürün Güncelleme                  | 1000 req/min    |
| Ürün | Stok ve Fiyat Güncelleme         | NO LIMIT        |
| Ürün | Toplu İşlem Kontrolü             | 1000 req/min    |
| Ürün | Ürün Filtreleme                  | 2000 req/min    |
| Ürün | Ürün Silme                       | 100 req/min     |
| Ürün | İade ve Sevkiyat Adres Bilgileri | 1 req/hour      |
| Ürün | TY Marka Listesi                 | 50 req/min      |
| Ürün | TY Marka İsme Göre Filtreleme    | 50 req/min      |
| Ürün | TY Kategori Listesi              | 50 req/min      |
| Ürün | TY Kategori - Özellik Listesi    | 50 req/min      |
| Ürün | Ürün Buybox Kontrol Servisi      | 1000 req/min    |

---

## Sipariş Servisleri

Aşağıdaki tablo üzerinden sipariş servislerimizin limitlerini kontrol edebilirsiniz.

### ⚠️ Önemli Not

- **Sipariş servislerimiz ürün listeleme limitleri baz alınarak limitlendirilmiştir.**

### Listeleme Limitleri

- Listeleme limitleri **50000 ürün** olan satıcılarımız → **Limit 50000**
- Listeleme limitleri **75000 ürün** olan satıcılarımız → **Limit 75000**
- Listeleme limitleri **150000 ürün** olan satıcılarımız → **Limit 150000**
- Listeleme limitleri **350000 ürün** olan satıcılarımız → **Limit 350000**
- Listeleme limitleri olmayan satıcılarımız **(Sınırsız)** → **Limit Limitsiz**

### Limit Tablosu

| Alan    | Entegrasyon Servisi                              | Limit 50000  | Limit 75000  | Limit 150000 | Limit 350000 | Limitsiz |
| ------- | ------------------------------------------------ | ------------ | ------------ | ------------ | ------------ | -------- |
| Sipariş | Sipariş Paketlerini Çekme                        | 2000 req/min | 2000 req/min | 3000 req/min | NO LIMIT     | NO LIMIT |
| Sipariş | Kargo Takip Kodu Bildirme                        | 300 req/min  | 300 req/min  | 500 req/min  | NO LIMIT     | NO LIMIT |
| Sipariş | Paket Statü Bildirimi                            | 300 req/min  | 300 req/min  | 500 req/min  | NO LIMIT     | NO LIMIT |
| Sipariş | Tedarik Edememe Bildirimi                        | 100 req/min  | 100 req/min  | 200 req/min  | NO LIMIT     | NO LIMIT |
| Sipariş | Sipariş Paketlerini Bölme /split                 | 100 req/min  | 100 req/min  | 200 req/min  | NO LIMIT     | NO LIMIT |
| Sipariş | Sipariş Paketlerini Bölme /multi-split           | 100 req/min  | 100 req/min  | 200 req/min  | NO LIMIT     | NO LIMIT |
| Sipariş | Sipariş Paketlerini Bölme /quantity-split        | 100 req/min  | 100 req/min  | 200 req/min  | NO LIMIT     | NO LIMIT |
| Sipariş | Sipariş Paketlerini Bölme /split-packages        | 100 req/min  | 100 req/min  | 200 req/min  | NO LIMIT     | NO LIMIT |
| Sipariş | Desi ve Koli Bilgisi Bildirimi                   | 100 req/min  | 100 req/min  | 200 req/min  | NO LIMIT     | NO LIMIT |
| Sipariş | Alternatif Teslimat İle Gönderim                 | 300 req/min  | 300 req/min  | 500 req/min  | NO LIMIT     | NO LIMIT |
| Sipariş | Alternatif Teslimat İle Gönderim - Teslim edildi | 1000 req/min | 1000 req/min | 1500 req/min | NO LIMIT     | NO LIMIT |
| Sipariş | Alternatif Teslimat İle Gönderim - İade          | 1000 req/min | 1000 req/min | 1500 req/min | NO LIMIT     | NO LIMIT |
| Sipariş | Yetkili Servis İle Gönderim                      | 100 req/min  | 100 req/min  | 200 req/min  | NO LIMIT     | NO LIMIT |
| Sipariş | Paket Kargo Firması Değiştirme                   | 100 req/min  | 100 req/min  | 200 req/min  | NO LIMIT     | NO LIMIT |
| Sipariş | Depo Bilgisi Güncelleme                          | 300 req/min  | 300 req/min  | 500 req/min  | NO LIMIT     | NO LIMIT |
| Sipariş | Ek Tedarik Süresi Tanımlama                      | 100 req/min  | 100 req/min  | 200 req/min  | NO LIMIT     | NO LIMIT |
| Sipariş | İşçilik Bedeli Tutarı Gönderme                   | -            | -            | -            | -            | -        |

---

## Ortak Etiket Servisleri

Aşağıdaki tablo üzerinden ortak etiket servislerimizin limitlerini kontrol edebilirsiniz.

| Alan         | Entegrasyon Servisi      | Rate Limitation |
| ------------ | ------------------------ | --------------- |
| Ortak Etiket | Barkod Talebi            | 100 req/min     |
| Ortak Etiket | Oluşan Barkodun Alınması | 100 req/min     |

---

## İade Servisleri

Aşağıdaki tablo üzerinden iade servislerimizin limitlerini kontrol edebilirsiniz.

| Alan | Entegrasyon Servisi                      | Rate Limitation |
| ---- | ---------------------------------------- | --------------- |
| İade | İadesi Oluşturulan Siparişleri Çekme     | 1000 req/min    |
| İade | İade Siparişleri Onaylama                | 5 req/min       |
| İade | İade Siparişlerinde Ret Talebi Oluşturma | 5 req/min       |
| İade | İade Audit Bilgilerini Çekme             | 1000 req/min    |

---

## Muhasebe ve Finans Servisleri

Aşağıdaki tablo üzerinden muhasebe ve finans servislerimizin limitlerini kontrol edebilirsiniz.

| Alan   | Entegrasyon Servisi              | Rate Limitation |
| ------ | -------------------------------- | --------------- |
| Finans | Cari Hesap Ekstresi Entegrasyonu | 100 req/min     |
| Finans | Kargo Faturası Detayları         | 100 req/min     |

---

## Notlar

- **req/min**: Dakikada yapılabilecek maksimum istek sayısı
- **req/hour**: Saatte yapılabilecek maksimum istek sayısı
- **NO LIMIT**: Limit bulunmamaktadır
- Limitler ürün listeleme sayınıza göre değişkenlik gösterebilir

---

**Son Güncelleme:** 7 gün önce  
**Kaynak:** [Trendyol Developer Portal](https://developers.trendyol.com/docs/1-servis-limitleri)
