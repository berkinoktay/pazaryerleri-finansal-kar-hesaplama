# Fatura Dosyası Gönderme

> Source: https://developers.trendyol.com/docs/marketplace/fatura-entegrasyonu/fatura-dosyas%C4%B1-gonderme

# Fatura Dosyası Gönderme

### Fatura Dosyası Gönderme[​](#fatura-dosyası-gönderme-1 "Fatura Dosyası Gönderme doğrudan bağlantı")

-   Dosya boyutu 10 MB dan büyük olamaz.
-   İleri tarihli fatura eklenemez
-   Gönderi paketi başka satıcıya aitse; hata şu şekilde dönecektir; Gönderi paketi, belirtilen satıcıya ait değil.sellerId:
-   Faturası oluşmuş bir pakete yüklenmek istediğinde; hata şu şekilde dönecektir; {paketNO} numaralı pakete ait fatura önceden gönderilmiş
-   Girilen paket No ile paket yoksa; hata şu şekilde dönecektir; {paketNo} Idli kargo paketi bulunamadı.
-   Dosya formatı invalidse; hata şu şekilde dönecektir; Dosya türü (.txt) desteklenmiyor. Desteklenen dosya türleri: application/pdf,image/jpeg,image/png
-   File gönderilmeden istek atılırsa; hata şu şekilde dönecektir; Dosya gönderilmedi. Lütfen fatura dosyasını seçip tekrar deneyin.
-   Mikro da fatura numarası girilmediğinde; hata şu şekilde dönecektir; Micro export type'lari icin fatura bilgisi zorunludur.
-   Mikro da tarih girilmediğinde; hata şu şekilde dönecektir; Micro export type'lari icin fatura bilgisi zorunludur.

### **POST** TR sellerInvoiceFile[​](#post-tr-sellerinvoicefile "post-tr-sellerinvoicefile doğrudan bağlantı")

PROD

https://apigw.trendyol.com/integration/sellers/{sellerId}/seller-invoice-file

STAGE

https://stageapigw.trendyol.com/integration/sellers/{sellerId}/seller-invoice-file

**Örnek Servis İsteği**

-   Herhangi bir JSON request body bulunmamaktadır.
-   Siparişe ait paket numarasını "shipmentPackageId" adı ile "form-data (Text)" olarak eklemeniz gerekmektedir.
-   Siparişe ait faturayı (pdf, jpeg, png) "form-data (file)" olarak eklemeniz gerekmektedir.

### **POST** Mikro sellerInvoiceFile[​](#post-mikro-sellerinvoicefile "post-mikro-sellerinvoicefile doğrudan bağlantı")

PROD

https://apigw.trendyol.com/integration/sellers/{sellerId}/seller-invoice-file

STAGE

https://stageapigw.trendyol.com/integration/sellers/{sellerId}/seller-invoice-file

**Örnek Servis İsteği**

-   Herhangi bir JSON request body bulunmamaktadır.
-   Siparişe ait paket numarasını "shipmentPackageId" adı ile "form-data (Text)" olarak eklemeniz gerekmektedir.
-   Mikro siparişler için "invoiceDateTime" ve "invoiceNumber" alanları "form-data (Text)" olarak eklemeniz gerekmektedir.
-   Siparişe ait faturayı (pdf, jpeg, png) "form-data (file)" olarak eklemeniz gerekmektedir.
