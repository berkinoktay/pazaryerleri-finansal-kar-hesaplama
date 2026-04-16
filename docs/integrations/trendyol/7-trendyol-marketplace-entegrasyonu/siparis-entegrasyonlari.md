# Trendyol Marketplace Entegrasyonu - Sipariş Entegrasyonu

## İçindekiler

1. [Test Siparişi Oluşturma](#1-test-siparişi-oluşturma)
2. [Sipariş Paketlerini Çekme (getShipmentPackages)](#2-sipariş-paketlerini-çekme-getshipmentpackages)
3. [Askıdaki Sipariş Paketlerini Çekme](#3-askıdaki-sipariş-paketlerini-çekme)
4. [Kargo Takip Kodu Bildirme (updateTrackingNumber)](#4-kargo-takip-kodu-bildirme-updatetrackingnumber)

---

## 1. Test Siparişi Oluşturma

### Genel Bilgiler

Test siparişi oluşturma servisi **STAGE ortamında** talep edilen senaryolarda test siparişi oluşturulması için kullanılacaktır.

**Önemli Notlar:**

- İstek yaparken, **"SellerID"** bilgisini Header içinde göndermelisiniz
- Bu değer, kullanılan test satıcısının satıcı ID'si olmalıdır
- Header içerisinde göndermiş olduğunuz satıcıId ile **basic authentication** yapmanız gerekmektedir
- Test ortamı bilgilerini edinmek için [Canlı-Test Ortam Bilgileri](https://integration-documentation-udwy.readme.io/docs/3-canlı-test-ortam-bilgileri) bölümünü inceleyebilirsiniz
- İstek başarıyla tamamlandığında, tarafınıza gönderilen response içinde **"orderNumber"** değeri yer alacaktır
- Bu sipariş numarasını kullanarak ilgili işlemleri gerçekleştirebilirsiniz

### Kurumsal Faturalı Test Siparişi Oluşturma

Kurumsal faturalı test siparişi oluşturmak için aşağıda yer alan request body içerisinde **"commercial"** alanı **true** olarak gönderilmelidir.

**"commercial"** alanının true olduğu durumda, **"invoiceAddress"** altında bulunan şu alanları doldurmanız gerekmektedir:

- **company**
- **invoiceTaxNumber**
- **invoiceTaxOffice**

### Mikro İhracat Test Siparişi Oluşturma

Mikro ihracat test siparişi oluşturmak için aşağıda yer alan request body içerisinde **"microRegion"** alanı doldurulmalıdır.

- **Azerbaycan** mikro ihracat test siparişi oluşturmak için: `"microRegion": "AZ"`
- **Gulf bölgesi** mikro ihracat test siparişi oluşturmak için: `"microRegion": "GULF"`

### POST

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/test/order/orders/core
```

### Örnek Servis İsteği

```json
{
  "customer": {
    "customerFirstName": "Adı",
    "customerLastName": "Soyadı"
  },
  "invoiceAddress": {
    "addressText": "test deneme adresi",
    "city": "İzmir",
    "company": "",
    "district": "Bornova",
    "invoiceFirstName": "Adı",
    "invoiceLastName": "Soyadı",
    "latitude": "string",
    "longitude": "string",
    "neighborhood": "",
    "phone": "5000000000",
    "postalCode": "",
    "email": "musteri@email.com",
    "invoiceTaxNumber": "Firma Tax Number",
    "invoiceTaxOffice": "Firma Tax Office"
  },
  "lines": [
    {
      "barcode": "9900000000486",
      "quantity": 2,
      "discountPercentage": 50
    }
  ],
  "seller": {
    "sellerId": 2738
  },
  "shippingAddress": {
    "addressText": "test deneme adresi",
    "city": "İzmir",
    "company": "",
    "district": "Bornova",
    "latitude": "string",
    "longitude": "string",
    "neighborhood": "",
    "phone": "5000000000",
    "postalCode": "",
    "shippingFirstName": "Adı",
    "shippingLastName": "Soyadı",
    "email": "musteri@email.com"
  },
  "commercial": false,
  "microRegion": "String"
}
```

---

## 2. Sipariş Paketlerini Çekme (getShipmentPackages)

# Sipariş Paketlerini Çekme (getShipmentPackages)

> ⚠️ **ÖNEMLİ GÜNCELLEME (Yakında Devreye Alınacaktır)**
>
> `getShipmentPackages` endpoint'i için aşağıdaki değişiklikler planlanmaktadır:
>
> - Maksimum erişilebilir kayıt sayısı **10.000** (`maxQueryWindowResult`) ile sınırlandırılacaktır (ilerleyen dönemlerde bu limit daha da düşürülebilir)
> - Erişilebilir veri kapsamı **son 1 ay** ile sınırlandırılacaktır
> - Rate limit değerleri güncellenecek olup, yüksek hacimli isteklerde daha sık **429 (Too Many Requests)** hatası alınabilecektir
>
> Bu değişiklikler, büyük veri setlerini tarama (scanning) senaryolarında mevcut endpoint'in kullanımını sınırlayacaktır.

> 🚀 **Önerilen Aksiyon**
>
> Büyük veri çekme ve senkronizasyon işlemleri için `getShipmentPackagesStream` endpoint'ine geçiş yapmanız önerilir.
>
> - Stream endpoint: Cursor tabanlı pagination ile çalışır
> - Büyük veri setleri için optimize edilmiştir
> - Rate limit açısından daha verimli kullanım sağlar

> 💡 **Not**
>
> Mevcut `getShipmentPackages` endpoint'i kullanılmaya devam edilebilir, ancak:
>
> - Büyük veri tarama (full scan)
> - Periyodik senkronizasyon (polling)
>
> gibi senaryolar için **uygun değildir**.

---

Trendyol sistemine ilettiğiniz ürünler ile müşteriler tarafından verilen ve ödeme kontrolünde olan her siparişin bilgisini bu method yardımıyla alabilirsiniz. Sistem tarafından ödeme kontrolünden sonra otomatik paketlenerek sipariş paketleri oluşturulur.

## Sipariş Sorgulama ve Sıralama

- Bu servise 1 dakika içinde en fazla **1000 adet** istek atabilirsiniz.
- Servise atılan isteklerde, `PackageLastModifiedDate` sıralamasına göre bir response alırsınız.
- `suppliers/{supplierId}/orders?status=Created` gibi bir query ile paket statülerine göre sorgulama yapılabilir.
- Kullanılabilen statüler: `Created`, `Picking`, `Invoiced`, `Shipped`, `Cancelled`, `Delivered`, `UnDelivered`, `Returned`, `Repack`, `UnSupplied`
- Sipariş bilgilerini çekerken, ürünün `createProducts` ile gönderilen **Barkod** değerlerine göre paketleme ve işlemler yapılmalıdır.
- Maksimum **1 aylık** geçmişe dönük sipariş sorgularını bu servis üzerinden yapabilirsiniz.

## Alanlar, Veri Tipleri ve Karakter Sayıları

- Body içindeki değerlerin karakter sayıları ve veri tipleri, sipariş sayısının doğal artışıyla birlikte değişebilir. Sisteminizi buna uygun şekilde kurmanız önerilir.
- Sipariş datasında bulunan `orderNumber`, Trendyol sistemindeki ana sipariş numarasını temsil eder. İlgili seviyede yer alan `id` değeri, oluşturulmuş Sipariş Paketini temsil eder.
- `customerId`, Trendyol müşteri hesabına tanımlı unique bir değerdir.
- `deliveryAddressType`, `"Shipment"` veya `"CollectionPoint"` olarak dönebilir. `"CollectionPoint"` ise sipariş teslimat noktası siparişidir.
- `orderDate`, Timestamp (milliseconds) formatında GMT +3 olarak iletilir. `createdDate` bilgileri ise GMT formatında iletilir. Convert işlemi yaparken bu bilgiye dikkat edilmelidir.
- Hızlı teslimat bilgisi için kullanılan `fastDeliveryType` alanı, `"TodayDelivery"`, `"SameDayShipping"`, `"FastDelivery"` değerlerini alabilir.
- Trendyol Satıcı Panelinde `cargoTrackingNumber` değeri için kullanılan barkod **CODE128** formatındadır.
- Trendyol İhracat Partnerliği kapsamında `3pByTrendyol` alanı eklenmiştir. Boolean bir alandır. Değeri `true` olduğunda `micro` alanı `false` değer alacaktır. `invoiceAddress` datasında Trendyol'a ait şirket bilgileri yer alacak olup faturalar da buradaki bilgilere göre kesilecektir.

## Sipariş Statüleri İle İlgili Bilgiler

- **Awaiting** statüsündeki siparişleri sadece stok işlemleri için kullanabilirsiniz. Bu statüdeki siparişler "Created" statüsüne geçene kadar herhangi bir işlem yapmamanız gerekmektedir. İlerleyen günlerde bu veriler dönmeyecektir. Bu statüdeki siparişleri kargoya teslim ettiğinizde sipariş iptali yaşanabileceğini ve Trendyol'un bu konuda sorumluluk kabul etmediğini belirtmek isteriz.
- İptal olan siparişler için `status=Cancelled,UnSupplied` parametresi kullanılabilir.
- Bölünmüş siparişler için `status=UnPacked` parametresi kullanılabilir.
- Bir sipariş paketi içindeki bir ya da birden fazla kalem iptal edilirse, `orderNumber` aynı kalarak sipariş paketi bozulur ve yeni bir `id` değeri ve kargo barkodu oluşturulur.

## Adres Bilgilerine Erişim

Sipariş paketlerini çekme servisi tarafından dönen Türkiye, Azerbaycan ve GULF bölgelerinin adres alanlarının id değerlerine (`city`, `district`, `neighbourhood`) **Adres Bilgileri Servislerinden** ulaşabilirsiniz.

GULF Bölgesi (Suudi Arabistan, Bahreyn, Katar, Kuveyt, Birleşik Arap Emirlikleri ve Umman) siparişlerindeki adres alanları bazı durumlarda boş dönebilir. Özellikle ilçe bilgisi ile ilgili sistemlerinizde kontroller varsa kaldırmanız önerilir.

## Menşei Bilgisi

Mikro ihracat siparişlerinde oluşan paketlerde faturalara menşei bilgisi eklenmesi gerekmektedir. Menşei bilgisi `"lines"` alanı altından `"productOrigin"` datası üzerinden dönecektir.

## Altın, Gübre ve Yüksek Tutarlı Siparişler

Altın, gübre veya 5000₺ üzeri siparişlere ait TCKN numarası `"IdentityNumber"` alanında iletilir.

## Kurumsal Faturalı Siparişler

Siparişin kurumsal olup olmadığını belirlemek için sipariş datasındaki `commercial` değerini kontrol ediniz.

- `"commercial": true` → kurumsal bir sipariş
- `"commercial": false` → bireysel bir müşteriye ait sipariş

**Kurumsal Fatura Bilgileri:** Eğer sipariş kurumsal bir müşteriye aitse (`commercial=true`), aşağıdaki bilgileri `invoiceAddress` alanından alabilirsiniz:

- `"company"`: Kurumun adı
- `"taxNumber"`: Kurumun vergi numarası
- `"taxOffice"`: Kurumun bağlı olduğu vergi dairesi

**E-Fatura Mükellefi Kontrolü:** Kurumsal müşterinin e-fatura mükellefi olup olmadığını kontrol etmek için `invoiceAddress` alanındaki `eInvoiceAvailable` değerini kullanabilirsiniz.

- `"eInvoiceAvailable": true` → müşteri e-fatura mükellefidir
- `"eInvoiceAvailable": false` → müşteri e-fatura mükellefi değildir

## `createdBy` Alanı

| Değer              | Açıklama                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `"order-creation"` | Paket, gelen siparişle doğrudan oluşturulur                                                                      |
| `"cancel"`         | Paket, kısmi iptalden sonra oluşturulur                                                                          |
| `"split"`          | Paket, paket bölünmesine göre oluşturulur                                                                        |
| `"transfer"`       | Siparişi alan satıcının ürünü olmaması nedeniyle Trendyol tarafından başka bir satıcıya yönlendirilen siparişler |

---

## GET getShipmentPackages

Herhangi bir tarih parametresi vermeden istek atmanız halinde **son bir hafta** içerisindeki siparişleriniz gösterilecektir. `startDate` ve `endDate` parametrelerini eklemeniz halinde verilebilecek maksimum aralık **iki hafta** olacaktır.

**PROD:**

```
https://apigw.trendyol.com/integration/order/sellers/{sellerId}/orders
```

**STAGE:**

```
https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/orders
```

**Önerilen Endpoint (PROD):**

```
https://apigw.trendyol.com/integration/order/sellers/{sellerId}/orders?status=Created&startDate={startDate}&endDate={endDate}&orderByField=PackageLastModifiedDate&orderByDirection=DESC&size=50
```

## Servis Parametreleri

| Parametre            | Parametre Değer                                                                                                                                 | Açıklama                                                                                                     | Tip    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------ |
| `startDate`          |                                                                                                                                                 | Belirli bir tarihten sonraki siparişleri getirir. Timestamp (milliseconds) ve GMT +3 olarak gönderilmelidir. | long   |
| `endDate`            |                                                                                                                                                 | Belirtilen tarihe kadar olan siparişleri getirir. Timestamp (milliseconds) ve GMT +3 olarak gönderilmelidir. | long   |
| `page`               |                                                                                                                                                 | Sadece belirtilen sayfadaki bilgileri döndürür                                                               | int    |
| `size`               | Maksimum 200                                                                                                                                    | Bir sayfada listelenecek maksimum adeti belirtir.                                                            | int    |
| `supplierId`         |                                                                                                                                                 | İlgili tedarikçinin ID bilgisi gönderilmelidir                                                               | long   |
| `orderNumber`        |                                                                                                                                                 | Sadece belirli bir sipariş numarası verilerek o siparişin bilgilerini getirir                                | string |
| `status`             | `Created`, `Picking`, `Invoiced`, `Shipped`, `Cancelled`, `Delivered`, `UnDelivered`, `Returned`, `AtCollectionPoint`, `UnPacked`, `UnSupplied` | Siparişlerin statülerine göre bilgileri getirir.                                                             | string |
| `orderByField`       | `PackageLastModifiedDate`                                                                                                                       | Son güncellenme tarihini baz alır.                                                                           | string |
| `orderByDirection`   | `ASC`                                                                                                                                           | Eskiden yeniye doğru sıralar.                                                                                | string |
| `orderByDirection`   | `DESC`                                                                                                                                          | Yeniden eskiye doğru sıralar.                                                                                | string |
| `shipmentPackageIds` |                                                                                                                                                 | Paket numarasıyla sorgu atılır.                                                                              | long   |

## Örnek Servis Cevabı

```json
{
  "totalElements": 1,
  "totalPages": 1,
  "page": 0,
  "size": 1,
  "content": [
    {
      "shipmentAddress": {
        "id": 11111111,
        "firstName": "Trendyol",
        "lastName": "Customer",
        "company": "",
        "address1": "DSM Grup Danışmanlık İletişim ve Satış Ticaret A.Ş. Maslak Mahallesi Saat Sokak Spine Tower No:5 İç Kapı No:19 Sarıyer/İstanbul",
        "address2": "",
        "city": "İstanbul",
        "cityCode": 34,
        "district": "Sarıyer",
        "districtId": 54,
        "countyId": 0, // CEE bölgesi için gelecektir.
        "countyName": "", // CEE bölgesi için gelecektir.
        "shortAddress": "", // GULF bölgesi için gelecektir.
        "stateName": "", // GULF bölgesi için gelecektir.
        "addressLines": {
          "addressLine1": "",
          "addressLine2": ""
        },
        "postalCode": "34200",
        "countryCode": "TR",
        "neighborhoodId": 21111,
        "neighborhood": "Maslak Mahallesi",
        "phone": null,
        "fullAddress": "DSM Grup Danışmanlık İletişim ve Satış Ticaret A.Ş. Maslak Mahallesi Saat Sokak Spine Tower No:5 İç Kapı No:19 Sarıyer/İstanbul",
        "fullName": "Trendyol Customer"
      },
      "orderNumber": "10654411111",
      "packageGrossAmount": 498.9, // Paketin toplam brüt tutarı (indirimsiz)
      "packageSellerDiscount": 0.0, // Satıcı indirim tutarı
      "packageTyDiscount": 0.0, // commercial true olduğu durumda dolu gelebilir, false olduğu durumda 0 dönecektir.
      "packageTotalDiscount": 0.0, // Toplam indirim tutarı (packageSellerDiscount + packageTyDiscount)
      "discountDisplays": [
        {
          "displayName": "Sepette %20 İndirim",
          "discountAmount": 100
        }
      ],
      "taxNumber": null,
      "invoiceAddress": {
        "id": 11111112,
        "firstName": "Trendyol",
        "lastName": "Customer",
        "company": "", // GULF bölgesi siparişlerinde boş gelebilir.
        "address1": "DSM Grup Danışmanlık İletişim ve Satış Ticaret A.Ş. Maslak Mahallesi Saat Sokak Spine Tower No:5 İç Kapı No:19 Sarıyer/İstanbul",
        "address2": "",
        "city": "İstanbul",
        "cityCode": 0,
        "district": "Sarıyer", // GULF bölgesi siparişlerinde boş gelebilir.
        "districtId": 54,
        "countyId": 0, // CEE bölgesi için gelecektir.
        "countyName": "", // CEE bölgesi için gelecektir.
        "shortAddress": "", // GULF bölgesi için gelecektir.
        "stateName": "", // GULF bölgesi için gelecektir.
        "addressLines": {
          "addressLine1": "",
          "addressLine2": ""
        },
        "postalCode": "", // GULF bölgesi siparişlerinde boş gelebilir.
        "countryCode": "TR",
        "neighborhoodId": 0,
        "phone": null,
        "latitude": "11.111111",
        "longitude": "22.222222",
        "fullAddress": "DSM Grup Danışmanlık İletişim ve Satış Ticaret A.Ş. Maslak Mahallesi Saat Sokak Spine Tower No:5 İç Kapı No:19 Sarıyer/İstanbul",
        "fullName": "Trendyol Customer",
        "taxOffice": "Company of OMS's Tax Office", // Kurumsal fatura olmadığı durumda (commercial=false ise) body içerisinde dönmeyecektir.
        "taxNumber": "Company of OMS's Tax Number" // Kurumsal fatura olmadığı durumda (commercial=false ise) body içerisinde dönmeyecektir.
      },
      "customerFirstName": "Trendyol",
      "customerEmail": "pf+j1jm1x11@trendyolmail.com",
      "customerId": 1451111111,
      "supplierId": 2738,
      "customerLastName": "Customer",
      "shipmentPackageId": 3330111111, // Paket ID'si
      "cargoTrackingNumber": 7280027504111111,
      "cargoTrackingLink": "https://tracking.trendyol.com/?id=111111111-1111-1111-1111-11111111",
      "cargoSenderNumber": "210090111111",
      "cargoProviderName": "Trendyol Express",
      "lines": [
        {
          "quantity": 1,
          "salesCampaignId": 11,
          "productSize": "Tek Ebat",
          "stockCode": "111111", // Satıcı stok kodu
          "productName": "Kuş ve Çiçek Desenli Tepsi - Yeşil / Altın Sarısı - 49 cm, 01SYM134, Tek Ebat",
          "contentId": 1239111111,
          "productOrigin": "TR",
          "sellerId": 2738, // Satıcı ID'si
          "lineGrossAmount": 498.9, // Ürünün birim brüt fiyatı (indirimsiz)
          "lineTotalDiscount": 0.0, // Birim toplam indirim (lineSellerDiscount + lineTyDiscount)
          "lineSellerDiscount": 0.0, // Birim satıcı indirimi (item'ların ortalaması)
          "lineTyDiscount": 0.0, // Birim Trendyol indirimi (item'ların ortalaması)
          "discountDetails": [
            // Her bir adet (item) için ayrı indirim detayı
            {
              "lineItemPrice": 498.9, // İndirimli birim fiyat (lineGrossAmount - lineItemSellerDiscount - lineItemTyDiscount)
              "lineItemSellerDiscount": 0.0, // Bu item'a uygulanan satıcı indirimi
              "lineItemTyDiscount": 0.0 // Bu item'a uygulanan Trendyol indirimi
            }
          ],
          "currencyCode": "TRY",
          "productColor": "Yeşil",
          "lineId": 4765111111, // Sipariş satır ID'si
          "vatRate": 20.0, // KDV oranı
          "barcode": "8683772071724",
          "orderLineItemStatusName": "Delivered",
          "lineUnitPrice": 498.9, // Net birim fiyat (lineGrossAmount - lineSellerDiscount - lineTyDiscount)
          "fastDeliveryOptions": [],
          "productCategoryId": 2710,
          "commission": 13, // Komisyon oranı
          "businessUnit": "Sports Shoes",
          "cancelledBy": "", // İptal eden taraf
          "cancelReason": "", // İptal nedeni
          "cancelReasonCode": 0 // İptal neden kodu
        }
      ],
      "orderDate": 1762253333685,
      "identityNumber": "11111111111",
      "currencyCode": "TRY",
      "packageHistories": [
        {
          "createdDate": 1762242537624,
          "status": "Created"
        }
      ],
      "shipmentPackageStatus": "Delivered",
      "status": "Delivered",
      "whoPays": 1, // Eğer satıcı anlaşması ise 1 gelir, trendyol anlaşması ise alan gelmez
      "deliveryType": "normal",
      "timeSlotId": 0,
      "estimatedDeliveryStartDate": 1762858136000,
      "estimatedDeliveryEndDate": 1763030936000,
      "packageTotalPrice": 498.9, // Paketin toplam net fiyatı (indirimli)
      "deliveryAddressType": "Shipment",
      "agreedDeliveryDate": 1762376340000,
      "fastDelivery": false,
      "originShipmentDate": 1762242537619,
      "lastModifiedDate": 1762865408581,
      "commercial": false,
      "fastDeliveryType": "",
      "deliveredByService": false,
      "warehouseId": 372389,
      "invoiceLink": "https://efatura01.evidea.com/11111111111",
      "micro": true,
      "giftBoxRequested": false,
      "3pByTrendyol": false,
      "etgbNo": "25341453EX025864", // micro true olduğunda etgbNo alanı için bilgi dönecektir.
      "etgbDate": 1762646400000, // micro true olduğunda etgbDate alanı için bilgi dönecektir.
      "containsDangerousProduct": false, // micro ihracat siparişlerinde satıcıya gelen siparişte paket içerisinde herhangi bir tehlikeli ürün varsa pil, parfüm vb. gibi, true dönecektir.
      "cargoDeci": 10,
      "isCod": false,
      "createdBy": "order-creation", // Paketin nasıl oluşturulduğunu gösterir, "order-creation", "split", "cancel" veya "transfer" olabilir
      "originPackageIds": null, // Bu alan iptal veya bölme işlemlerinden sonra doldurulur ve bu işlemlerden sonra ilk paketin packageid'sini verir.
      "hsCode": "711111000000", // Bu alan mikro siparişler için string olarak dönecektir.
      "shipmentNumber": 606404425
    }
  ]
}
```

## Paket Statüleri

| Statü               | Açıklama                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `orderDate`         | Müşterinin trendyol.com üzerinde siparişi oluşturduğu zaman dönmektedir.                                                                                                                   |
| `Awaiting`          | Ödeme onayından bekleyen siparişler. Bu statüdeki siparişler "Created" statüsüne geçene kadar herhangi bir işlem yapmamanız gerekmektedir. Sadece stok güncellemeleri için kullanılabilir. |
| `Created`           | Sipariş gönderime hazır statüsünde olduğu zaman dönmektedir.                                                                                                                               |
| `Picking`           | Sizin tarafınızdan iletilebilecek bir statüdür. Siparişi toplamaya veya paketi hazırlamaya başladığınız zaman iletebilirsiniz.                                                             |
| `Invoiced`          | Siparişin faturasını kestiğiniz zaman iletilebilecek statüdür.                                                                                                                             |
| `Shipped`           | Taşıma durumuna geçen siparişler bu statüdedir.                                                                                                                                            |
| `AtCollectionPoint` | Ürün ilgili PUDO teslimat noktasındadır. Müşterinin teslim alması beklenmektedir.                                                                                                          |
| `Cancelled`         | İptal edilen siparişlerdir. Unsupplied siparişleri de kapsar.                                                                                                                              |
| `UnPacked`          | Paketi bölünmüş olan siparişlerdir.                                                                                                                                                        |
| `Delivered`         | Teslim edilen siparişlerdir. Bu statüden sonra herhangi bir statü değişikliği yapılamaz.                                                                                                   |
| `UnDelivered`       | Sipariş müşteriye ulaştırılamadığı zaman döner.                                                                                                                                            |
| `Returned`          | Müşteriye ulaşmayan siparişin tedarikçiye geri döndüğü bilgisidir. Bu statüden sonra herhangi bir statü değişikliği yapılamaz.                                                             |

## Mikro İhracat Siparişleri için Ülke Kodu Bilgileri

| Ülke                      | Ülke Kodu |
| ------------------------- | --------- |
| Suudi Arabistan           | SA        |
| Birleşik Arap Emirlikleri | AE        |
| Katar                     | QA        |
| Kuveyt                    | KW        |
| Umman                     | OM        |
| Bahreyn                   | BH        |
| Azerbaycan                | AZ        |
| Slovakya                  | SK        |
| Romanya                   | RO        |
| Çekya                     | CZ        |

---

---

# Sipariş Paketlerini Akış ile Çekme (getShipmentPackagesStream)

`getShipmentPackagesStream`, sipariş paketlerini cursor tabanlı (stream) olarak çekmenizi sağlayan endpoint'tir.

> ⚠️ **ÖNEMLİ**
>
> Mevcut `getShipmentPackages` endpoint'i büyük veri setlerini tarama (scanning) amacıyla optimize edilmemiştir. Bu endpoint için:
>
> - Maksimum erişilebilir kayıt sayısı: **10.000**
> - Yüksek hacimli veri çekimlerinde sistem üzerinde yük oluşabilir
> - Rate limit kısıtlarına daha hızlı takılınabilir
>
> Bu nedenle aşağıdaki senaryolarda `getShipmentPackagesStream` kullanılması önerilir:
>
> - ✔ Büyük veri tarama (full scan)
> - ✔ Periyodik senkronizasyon (polling / cron)
> - ✔ Tüm siparişleri export etme

- ✅ Response yapısı aynıdır; sadece pagination ile ilgili alanlar (`totalElements`, `totalPages`, `page`) dönmeyecektir.
- ❗ Pagination mekanizması değişmiştir (cursor tabanlı).

## 📦 Veri Kapsamı & Tarih Kısıtları

- Bu endpoint üzerinden **son 3 aylık** veri erişilebilir.
- ❗ Zaman aralığı maksimum **2 hafta (14 gün)** ile sınırlandırılmıştır. `lastModifiedStartDate` ve `lastModifiedEndDate` gönderilmezse sistem otomatik olarak son 2 hafta ile sınırlar.

## ❗ Response Farkı

`getShipmentPackagesStream` endpoint'inin response yapısı mevcut endpoint ile aynıdır; sadece aşağıdaki alanlar **dönmemektedir**:

- `totalElements`
- `totalPages`
- `page`

Bunun yerine aşağıdaki alanlar kullanılır:

- `hasMore`
- `nextCursor`
- `size`

Bu nedenle page tabanlı pagination kullanan entegrasyonların cursor tabanlı yapıya geçmesi gerekmektedir.

> 💡 **Migration Notu**
>
> - `page++` yerine → `nextCursor` kullanılır
> - `totalPages` kontrolü yerine → `hasMore` kontrol edilir

## Stream Servisi vs. Mevcut Servis

| Özellik                | Mevcut Servis (getShipmentPackages) | Stream Servisi (getShipmentPackagesStream) |
| ---------------------- | ----------------------------------- | ------------------------------------------ |
| Kullanım Amacı         | Küçük / anlık sorgular              | Büyük veri tarama & senkronizasyon         |
| Pagination             | Page tabanlı (`page`, `totalPages`) | Cursor tabanlı (`nextCursor`, `hasMore`)   |
| Maksimum Veri Erişimi  | ⚠️ 10.000 kayıt ile sınırlı         | ✅ Yüksek limitli akış                     |
| Büyük Veri Performansı | ⚠️ Sınırlı                          | ✅ Optimize                                |

## Cursor Tabanlı Sayfalama Nasıl Çalışır?

Cursor mekanizması, klasik page mantığından farklıdır:

- `page` yerine akış pointer'ı (cursor) kullanılır
- Her istek, bir önceki kaldığı yerden devam eder
- Büyük veri setlerinde stabil ve verimli ilerleme sağlar

**Akış:**

1. İlk istekte `nextCursor` gönderilmez
2. Yanıtta `hasMore = true` ise devam edilir
3. `nextCursor` değeri alınır ve sonraki istekte kullanılır
4. `hasMore = false` olduğunda akış tamamlanır

## ⚠️ Kritik Kurallar

- `nextCursor` **opaque** bir değerdir → parse edilmemeli, değiştirilmemelidir.
- Aynı cursor kullanırken daha önce başlatılan filtreler değiştirilmemelidir → filtre değişirse **400 Bad Request** alınır.
- Sıralama sabittir; **Last Modified Date'e göre DESC** olarak sonuç döner.
- Yeni filtre ile çalışmak için → yeni akış başlatılmalıdır.

> **Önerilen kullanım:** Minimum **5 saniye** aralıklarda istek atılmasıdır.

## Endpoint

**PROD:**

```
GET https://apigw.trendyol.com/integration/order/sellers/{sellerId}/orders/stream
```

**STAGE:**

```
GET https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/orders/stream
```

## Örnek Servis Cevabı

```json
{
  "hasMore": true,
  "nextCursor": "609ca79b-1fdf-4c4e-a814-498ce9c1c039",
  "size": 50,
  "content": [
    {
      "shipmentAddress": {
        "id": 11111111,
        "firstName": "Trendyol",
        "lastName": "Customer",
        "company": "",
        "address1": "DSM Grup Danışmanlık İletişim ve Satış Ticaret A.Ş. Maslak Mahallesi Saat Sokak Spine Tower No:5 İç Kapı No:19 Sarıyer/İstanbul",
        "address2": "",
        "city": "İstanbul",
        "cityCode": 34,
        "district": "Sarıyer",
        "districtId": 54,
        "countyId": 0, // CEE bölgesi için gelecektir.
        "countyName": "", // CEE bölgesi için gelecektir.
        "shortAddress": "", // GULF bölgesi için gelecektir.
        "stateName": "", // GULF bölgesi için gelecektir.
        "addressLines": {
          "addressLine1": "",
          "addressLine2": ""
        },
        "postalCode": "34200",
        "countryCode": "TR",
        "neighborhoodId": 21111,
        "neighborhood": "Maslak Mahallesi",
        "phone": null,
        "fullAddress": "DSM Grup Danışmanlık İletişim ve Satış Ticaret A.Ş. Maslak Mahallesi Saat Sokak Spine Tower No:5 İç Kapı No:19 Sarıyer/İstanbul",
        "fullName": "Trendyol Customer"
      },
      "orderNumber": "10654411111",
      "packageGrossAmount": 498.9, // Paketin toplam brüt tutarı (indirimsiz)
      "packageSellerDiscount": 0.0, // Satıcı indirim tutarı
      "packageTyDiscount": 0.0, // commercial true olduğu durumda dolu gelebilir, false olduğu durumda 0 dönecektir.
      "packageTotalDiscount": 0.0, // Toplam indirim tutarı (packageSellerDiscount + packageTyDiscount)
      "discountDisplays": [
        {
          "displayName": "Sepette %20 İndirim",
          "discountAmount": 100
        }
      ],
      "taxNumber": null,
      "invoiceAddress": {
        "id": 11111112,
        "firstName": "Trendyol",
        "lastName": "Customer",
        "company": "", // GULF bölgesi siparişlerinde boş gelebilir.
        "address1": "DSM Grup Danışmanlık İletişim ve Satış Ticaret A.Ş. Maslak Mahallesi Saat Sokak Spine Tower No:5 İç Kapı No:19 Sarıyer/İstanbul",
        "address2": "",
        "city": "İstanbul",
        "cityCode": 0,
        "district": "Sarıyer", // GULF bölgesi siparişlerinde boş gelebilir.
        "districtId": 54,
        "countyId": 0, // CEE bölgesi için gelecektir.
        "countyName": "", // CEE bölgesi için gelecektir.
        "shortAddress": "", // GULF bölgesi için gelecektir.
        "stateName": "", // GULF bölgesi için gelecektir.
        "addressLines": {
          "addressLine1": "",
          "addressLine2": ""
        },
        "postalCode": "", // GULF bölgesi siparişlerinde boş gelebilir.
        "countryCode": "TR",
        "neighborhoodId": 0,
        "phone": null,
        "latitude": "11.111111",
        "longitude": "22.222222",
        "fullAddress": "DSM Grup Danışmanlık İletişim ve Satış Ticaret A.Ş. Maslak Mahallesi Saat Sokak Spine Tower No:5 İç Kapı No:19 Sarıyer/İstanbul",
        "fullName": "Trendyol Customer",
        "taxOffice": "Company of OMS's Tax Office", // Kurumsal fatura olmadığı durumda (commercial=false ise) body içerisinde dönmeyecektir.
        "taxNumber": "Company of OMS's Tax Number" // Kurumsal fatura olmadığı durumda (commercial=false ise) body içerisinde dönmeyecektir.
      },
      "customerFirstName": "Trendyol",
      "customerEmail": "pf+j1jm1x11@trendyolmail.com",
      "customerId": 1451111111,
      "supplierId": 2738,
      "customerLastName": "Customer",
      "shipmentPackageId": 3330111111, // Paket ID'si
      "cargoTrackingNumber": 7280027504111111,
      "cargoTrackingLink": "https://tracking.trendyol.com/?id=111111111-1111-1111-1111-11111111",
      "cargoSenderNumber": "210090111111",
      "cargoProviderName": "Trendyol Express",
      "lines": [
        {
          "quantity": 1,
          "salesCampaignId": 11,
          "productSize": "Tek Ebat",
          "stockCode": "111111", // Satıcı stok kodu
          "productName": "Kuş ve Çiçek Desenli Tepsi - Yeşil / Altın Sarısı - 49 cm, 01SYM134, Tek Ebat",
          "contentId": 1239111111,
          "productOrigin": "TR",
          "sellerId": 2738, // Satıcı ID'si
          "lineGrossAmount": 498.9, // Ürünün birim brüt fiyatı (indirimsiz)
          "lineTotalDiscount": 0.0, // Birim toplam indirim (lineSellerDiscount + lineTyDiscount)
          "lineSellerDiscount": 0.0, // Birim satıcı indirimi (item'ların ortalaması)
          "lineTyDiscount": 0.0, // Birim Trendyol indirimi (item'ların ortalaması)
          "discountDetails": [
            // Her bir adet (item) için ayrı indirim detayı
            {
              "lineItemPrice": 498.9, // İndirimli birim fiyat (lineGrossAmount - lineItemSellerDiscount - lineItemTyDiscount)
              "lineItemSellerDiscount": 0.0, // Bu item'a uygulanan satıcı indirimi
              "lineItemTyDiscount": 0.0 // Bu item'a uygulanan Trendyol indirimi
            }
          ],
          "currencyCode": "TRY",
          "productColor": "Yeşil",
          "lineId": 4765111111, // Sipariş satır ID'si
          "vatRate": 20.0, // KDV oranı
          "barcode": "8683772071724",
          "orderLineItemStatusName": "Delivered",
          "lineUnitPrice": 498.9, // Net birim fiyat (lineGrossAmount - lineSellerDiscount - lineTyDiscount)
          "fastDeliveryOptions": [],
          "productCategoryId": 2710,
          "commission": 13, // Komisyon oranı
          "businessUnit": "Sports Shoes",
          "cancelledBy": "", // İptal eden taraf
          "cancelReason": "", // İptal nedeni
          "cancelReasonCode": 0 // İptal neden kodu
        }
      ],
      "orderDate": 1762253333685,
      "identityNumber": "11111111111",
      "currencyCode": "TRY",
      "packageHistories": [
        {
          "createdDate": 1762242537624,
          "status": "Created"
        }
      ],
      "shipmentPackageStatus": "Delivered",
      "status": "Delivered",
      "whoPays": 1, // Eğer satıcı anlaşması ise 1 gelir, trendyol anlaşması ise alan gelmez
      "deliveryType": "normal",
      "timeSlotId": 0,
      "estimatedDeliveryStartDate": 1762858136000,
      "estimatedDeliveryEndDate": 1763030936000,
      "packageTotalPrice": 498.9, // Paketin toplam net fiyatı (indirimli)
      "deliveryAddressType": "Shipment",
      "agreedDeliveryDate": 1762376340000,
      "fastDelivery": false,
      "originShipmentDate": 1762242537619,
      "lastModifiedDate": 1762865408581,
      "commercial": false,
      "fastDeliveryType": "",
      "deliveredByService": false,
      "warehouseId": 372389,
      "invoiceLink": "https://efatura01.evidea.com/11111111111",
      "micro": true,
      "giftBoxRequested": false,
      "3pByTrendyol": false,
      "etgbNo": "25341453EX025864", // micro true olduğunda etgbNo alanı için bilgi dönecektir.
      "etgbDate": 1762646400000, // micro true olduğunda etgbDate alanı için bilgi dönecektir.
      "containsDangerousProduct": false, // micro ihracat siparişlerinde satıcıya gelen siparişte paket içerisinde herhangi bir tehlikeli ürün varsa pil, parfüm vb. gibi, true dönecektir.
      "cargoDeci": 10,
      "isCod": false,
      "createdBy": "order-creation", // Paketin nasıl oluşturulduğunu gösterir, "order-creation", "split", "cancel" veya "transfer" olabilir
      "originPackageIds": null, // Bu alan iptal veya bölme işlemlerinden sonra doldurulur ve bu işlemlerden sonra ilk paketin packageid'sini verir.
      "hsCode": "711111000000", // Bu alan mikro siparişler için string olarak dönecektir.
      "shipmentNumber": 606404425
    }
  ]
}
```

## 3. Askıdaki Sipariş Paketlerini Çekme

### Genel Bilgiler

Ödeme güvenliğinden geçmekte olan ve kargo firmasından kargo bilgisi beklenen siparişlerinizi, bu method yardımıyla alabilirsiniz.

Sistem tarafından ödeme kontrolünden ve kargo bilgileri tamamlandıktan sonra otomatik paketlenerek sipariş paketleri oluşturulur.

**Önemli Notlar:**

- **Awaiting** statüsündeki siparişleri **sadece stok kontrolleriniz için** kullanabilirsiniz
- Ödeme kontrolünden geçen siparişler artık **Created** statüsünde sizlere dönecektir
- Ödeme kontrolünden geçmeyen siparişler ise **Cancelled** statüsünde sizlere dönecektir

### GET getShipmentPackages

**Production URL:**

```
https://apigw.trendyol.com/integration/order/sellers/{sellerId}/orders?status=Awaiting
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/orders?status=Awaiting
```

### Servis Parametreleri

| Parametre          | Parametre Değer  | Açıklama                                                                            | Tip    |
| ------------------ | ---------------- | ----------------------------------------------------------------------------------- | ------ |
| startDate          |                  | Belirli bir tarihten sonraki siparişleri getirir. Timestamp olarak gönderilmelidir. | long   |
| endDate            |                  | Belirtilen tarihe kadar olan siparişleri getirir. Timestamp olarak gönderilmelidir. | long   |
| page               |                  | Sadece belirtilen sayfadaki bilgileri döndürür                                      | int    |
| size               | Maksimum 200     | Bir sayfada listelenecek maksimum adeti belirtir.                                   | int    |
| supplierId         |                  | İlgili tedarikçinin ID bilgisi gönderilmelidir                                      | long   |
| orderNumber        |                  | Sadece belirli bir sipariş numarası verilerek o siparişin bilgilerini getirir       | string |
| orderByField       | LastModifiedDate | Son güncellenme tarihini baz alır.                                                  | string |
| orderByField       | CreatedDate      | Siparişin oluşma tarihini baz alır                                                  | string |
| orderByDirection   | ASC              | Eskiden yeniye doğru sıralar.                                                       | string |
| orderByDirection   | DESC             | Yeniden eskiye doğru sıralar.                                                       | string |
| shipmentPackagesId |                  | Paket numarasıyla sorgu atılır.                                                     | long   |

### Sipariş Statüleri

| Statü     | Açıklama                                                                                                                                                                                                                                                                                           |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| orderDate | Müşterinin trendyol.com üzerinde siparişi oluşturduğu zaman dönmektedir.                                                                                                                                                                                                                           |
| Awaiting  | Müşterinin trendyol.com üzerinde siparişi oluşturduktan sonra ödeme onayından bekleyen siparişler için bu statü dönmektedir. (Bu statüdeki siparişler "Created" statüsüne geçene kadar herhangi bir işlem yapmamanız gerekmektedir. Sadece stok güncellemeleri için bu statüyü kullanabilirsiniz.) |

### Örnek Servis İsteği

```json
{
    "page": 0,
    "size": 50,
    "totalPages": 1,
    "totalElements": 1,
    "content": [
        {
            "shipmentAddress": {
                "id": 0,
                "firstName": "***",
                "lastName": "***",
                "address1": "***",
                "address2": "***",
                "addressLines": {
                    "addressLine1": "***",
                    "addressLine2": "***"
                },
                "city": "***",
                "cityCode": 0,
                "district": "***",
                "districtId": 0,
                "countyId": 0, //CEE bölgesi için gelecektir.
                "countyName": "***", //CEE bölgesi için gelecektir.
                "shortAddress": "***", //GULF bölgesi için gelecektir.
                "stateName": "***", //GULF bölgesi için gelecektir.
                "postalCode": "***",
                "countryCode": "***",
                "phone": "***",
                "latitude": "***",
                "longitude": "***",
                "fullAddress": "*** *** *** ***",
                "fullName": "*** ***"
            },
            "orderNumber": "252647418",
            "grossAmount": 55.95,
            "totalDiscount": 0.00,
            "taxNumber": "***",
            "invoiceAddress": {
                "id": 0,
                "firstName": "***",
                "lastName": "***",
                "company": "",
                "address1": "***",
                "address2": "***",
                "addressLines": {
                    "addressLine1": "***",
                    "addressLine2": "***"
                },
                "city": "***",
                "cityCode": 0,
                "district": "***",
                "districtId": 0,
                "countyId": 0, //CEE bölgesi için gelecektir.
                "countyName": "***", //CEE bölgesi için gelecektir.
                "shortAddress": "***", //GULF bölgesi için gelecektir.
                "stateName": "***", //GULF bölgesi için gelecektir.
                "postalCode": "***",
                "countryCode": "***",
                "phone": "***",
                "latitude": "***",
                "longitude": "***",
                "fullAddress": "*** *** *** ***",
                "fullName": "*** ***"
            },
            "customerFirstName": "***",
            "customerEmail": "***",
            "customerId": 0,
            "customerLastName": "***",
            "id": 0,
            "cargoTrackingNumber": 0,
            "cargoProviderName": "***",
            "lines": [
                {
                    "quantity": 1,
                    "productId": 197197197,
                    "salesCampaignId": 111111,
                    "productSize": "L",
                    "merchantSku": "merchantSku",
                    "productName": "Kadın Siyah Pantolon",
                    "productCode": 554554554,
                    "amount": 55.95,
                    "discount": 0,
                    "discountDetails": [
                        {
                            "lineItemPrice": 55.95,
                            "lineItemDiscount": 0
                        }
                    ],
                    "currencyCode": "TRY",
                    "productColor": "SIYAH",
                    "id": 444444444,
                    "sku": "skue",
                    "vatBaseAmount": 8.0,
                    "barcode": "6000001036071",
                    "orderLineItemStatusName": "Approved",
                    "price": 55.95
                    "productCategoryId": 11111,
                    "laborCost": 11.11,
                    "commission": 9
                }
            ],
            "orderDate": 1583327549228,
            "identityNumber": "0000000000000",
            "currencyCode": "TRY",
            "packageHistories": [
                {
                    "createdDate": 0,
                    "status": "Awaiting"
                }
            ],
            "shipmentPackageStatus": "Approved",
            "deliveryType": "normal",
            "estimatedDeliveryStartDate": 1583392349000,
            "estimatedDeliveryEndDate": 1583824349000,
            "totalPrice": 55.95,
            "cargoDeci": 0,
            "isCod": false,
            "createdBy": "",
            "originPackageIds": null,
            "whoPays": null,
            "hsCode": ""
        }
    ]
}
```

---

## 4. Kargo Takip Kodu Bildirme (updateTrackingNumber)

### Kargo Takip Kodu Bildirme (Kullanım Dışı)

Bu method herhangi bir paket için çağırıldığında, artık Trendyol'un anlaşması üzerinden olan paket değil, **tedarikçinin kendi anlaşması üzerinden** yaptığı gönderinin durumu sorgulanmaya başlar ve Yola Çıktı, Teslim Edildi, Teslim Edilemedi bilgileri entegrasyon üzerinden alınır ve takip edilir.

**Önemli Kurallar:**

- Eğer bir sipariş iptal edilmiş ise Sipariş Paketlerini Çekme servisi kullanılıp güncel paket numarasına gönderim işlemi yapılması gerekmektedir
- Kargo takip numarası beslemeye çalıştığınız paket **cancelled, shipped, delivered** statülerinde ise tarafınıza **"Shipment Update Edilebilir Bir Durumda Değil."** hatası dönecektir
- **Yola Çıkmış, Teslim Edilmiş** statüdeki paketler için kargo kodu kullanılamaz
- Eğer kargo numarası update edilen bir pakete **tedarik edememe bildirimi** yapılırsa, yeni bir paket ve kargo kodu oluşacağı için entegrasyon üzerinden yeni oluşacak paketin de tekrar kargo kodunun güncellenmesi beklenir

### Kargo Çalışma Şekli Tablosu

| Kendi Kargo fiyatlarım ile Çalışacağım                                             | Trendyol Anlaşmalı Kargo Fiyatları ile Çalışacağım                                                                                                                                      |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Satıcı Kargo Kodu Kullanılmalıdır (Kargo takip kodu servis üzerinden bildirilmeli) | Trendyol Kargo Kodu Kullanılmalıdır                                                                                                                                                     |
| - DHL eCommerce<br>- Aras Kargo<br>- Sürat Kargo<br>- Horoz Lojistik               | - Horoz Lojistik<br>- DHL eCommerce<br>- PTT Kargo<br>- Sürat Kargo<br>- Yurtiçi Kargo<br>- Kolay Gelsin Kargo<br>- Ceva Tedarik<br>- PTT Kargo<br>- Aras Kargo<br>- Kolay Gelsin Kargo |

### PUT updateTrackingNumber

**Production URL:**

```
https://apigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/update-tracking-number
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/update-tracking-number
```

### Örnek Servis İsteği

```json
{
  "trackingNumber": "string"
}
```

### Örnek Servis Cevabı

```
HTTP 200
```

## 5. Paket Statü Bildirimi (updatePackage)

### Genel Bilgiler

Siparişe ait paketi **sadece 2 paket statüsü** ile güncelleyebilirsiniz. Bu statüler haricindekiler sistem tarafından otomatik olarak pakete aktarılmaktadır.

**Önemli Kural:**
Statü beslemelerini yaparken önce **"Picking"** sonra **"Invoiced"** statü beslemesi yapmanız gerekmektedir.

---

### PUT updatePackage (Toplanmaya Başlandı Bildirimi - Picking)

Picking statüsü beslediğiniz an Trendyol panelinde **"Sipariş İşleme Alınmıştır"** ifadesi gözükecektir. Bu statü ile kendi tarafınızda siparişlerinize ait durumu kontrol edebilirsiniz.

**Production URL:**

```
https://apigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}
```

#### Örnek Servis İsteği

```json
{
  "lines": [
    {
      "lineId": {lineId},  // long gönderilmelidir.
      "quantity": 3        // int gönderilmelidir.
    }
  ],
  "params": {},
  "status": "Picking"
}
```

---

### PUT updatePackage (Fatura Kesme Bildirimi - Invoiced)

Invoiced statüsü beslediğiniz an Trendyol panelinde **"Sipariş İşleme Alınmıştır"** ifadesi gözükecektir. Bu statü ile kendi tarafınızda siparişlerinize ait durumu kontrol edebilirsiniz.

**Production URL:**

```
https://apigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}
```

#### Örnek Servis İsteği

```json
{
  "lines": [
    {
      "lineId": {lineId},  // long gönderilmelidir.
      "quantity": 3        // int gönderilmelidir.
    }
  ],
  "params": {
    "invoiceNumber": "EME2018000025208"
  },
  "status": "Invoiced"
}
```

---

## 6. Tedarik Edememe Bildirimi (updatePackage)

### Genel Bilgiler

Tedarikçinin paket içerisindeki ürünlerden bir ya da birkaçını **Tedarik Edememe** kaynaklı iptal etmesi için kullanılır.

**Önemli Notlar:**

- Bu method yardımıyla yapılan bir iptal sonrası, iptal edilen paket bozularak **yeni ID'li bir paket oluşturulacaktır**
- Tedarik edememe bildirimi yapıldıktan sonra Trendyol Order Management System tarafından aynı **orderNumber** üzerinde yeni bir **ShipmentPackageID** oluşturulmakta ve daha önceki shipmentpackage iptal edilmektedir
- Bu durumda Tedarik Edememe kaydı yapıldıktan sonra tekrar **Sipariş Paketlerini Çekme** işlemi yapılması gerekmektedir

### PUT updatePackage

**Production URL:**

```
https://apigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/items/unsupplied
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/items/unsupplied
```

### Örnek Servis İsteği

```json
{
  "lines": [
    {
      "lineId": 0,
      "quantity": 0
    }
  ],
  "reasonId": 0
}
```

### Tedarik Edememe Nedenleri

| reasonId | name                      | description                                                                                                                   |
| -------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 500      | Stok tükendi              | Ürünün stoğu tükenmesi ve gönderimin gecikmesi gibi sebeplerle tedarik edilememesi durumunda seçilmelidir.                    |
| 501      | Kusurlu/Defolu/Bozuk Ürün | Ürün kusurlu/defolu/bozuk olduğu için gönderilememesi durumunda seçilmelidir.                                                 |
| 502      | Hatalı Fiyat              | Yanlış fiyat beslenmesi durumunda seçilmelidir.                                                                               |
| 504      | Entegrasyon Hatası        | Entegrasyon firmasından kaynaklı olarak hatalı fiyat ya da stok aktarımında yaşanan sorunlarda seçilmelidir.                  |
| 505      | Toplu Alım                | Üründe yapılan indirim sonrası tek bir üründen ve aynı müşteri tarafından toplu olarak satın alınması durumunda seçilmelidir. |
| 506      | Mücbir Sebep              | Doğal afet, hastalık, cenaze vb. durumlarda seçilmelidir                                                                      |

---

## 7. Sipariş Paketlerini Bölme (splitShipmentPackage)

### Genel Bilgiler

Bu servis ile Trendyol üzerinde oluşmuş siparişlerinizi birden fazla paket haline getirebilirsiniz.

**Önemli Notlar:**

- Bu servisi kullandıktan sonra sipariş numarasına bağlı yeni paketler **"UnPacked"** statüsünde, **asenkron olarak** oluşacaktır
- Bu nedenle **Sipariş Paketlerini Çekme** servisinden tekrar güncel paketleri çekmelisiniz

---

### Sipariş Paketlerini Birden Fazla Barkod İle Bölme

Bu method ile bir sipariş paketinin içerisinde olan ürünleri miktar ve ilgili barkodun **orderLineId** değeri ile pakette toplayarak işlem yapabilirsiniz.

**Önemli:** Eğer istek atarken dışarıda bıraktığınız bir ürün/ler olursa o ürün/ler ayrı ve yeni bir pakette oluşacaktır.

#### POST splitMultiPackageByQuantity

**Production URL:**

```
https://apigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/split-packages
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/split-packages
```

#### Örnek Servis İsteği

```json
{
  "splitPackages": [
    {
      "packageDetails": [
        {
          "orderLineId": 12345,
          "quantities": 2
        },
        {
          "orderLineId": 123456,
          "quantities": 1
        }
      ]
    },
    {
      "packageDetails": [
        {
          "orderLineId": 123,
          "quantities": 1
        },
        {
          "orderLineId": 1234,
          "quantities": 1
        }
      ]
    }
  ]
}
```

---

### POST splitShipmentPackage

**Production URL:**

```
https://apigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/split
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/split
```

#### Örnek Servis İsteği

```json
{
  "orderLineIds": [{orderLineId}]
}
```

---

### Sipariş Paketlerini Bölme (Tek Request İle Birden Fazla Paket Oluşturma)

Bu servisi kullandıktan sonra sipariş numarasına bağlı yeni paketler **asenkron olarak** oluşacaktır. Bu nedenle Sipariş Paketlerini Çekme servisinden tekrar güncel paketleri çekmelisiniz.

#### POST splitShipmentPackage

**Production URL:**

```
https://apigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/multi-split
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/multi-split
```

#### Örnek Servis İsteği

Örnekte paket içerisineki 3,5,6 orderLine'ları için bir paket, 7,8,9 orderLine'ları için başka bir paket ve kalan orderLine'lar için de bir tane olmak üzere **3 paket oluşacaktır**.

**Önemli:** Bir paket üzerinde üzerindeki bütün orderLine'lar bu servis gönderilmemelidir. Kalan orderLine'lar için otomatik paket zaten sistem tarafından yaratılacaktır.

```json
{
  "splitGroups": [
    {
      "orderLineIds": [3, 5, 6]
    },
    {
      "orderLineIds": [7, 8, 9]
    }
  ]
}
```

---

### Sipariş Paketlerini Barkod Bazlı Bölme

Bu servisi kullandıktan sonra sipariş numarasına bağlı yeni paketler **asenkron olarak** oluşacaktır. Bu nedenle Sipariş Paketlerini Çekme servisinden tekrar güncel paketleri çekmelisiniz.

#### POST splitShipmentPackageByQuantity

**Production URL:**

```
https://apigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/quantity-split
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/quantity-split
```

#### Örnek Servis İsteği

```json
{
  "quantitySplit": [
    {
      "orderLineId": 0,
      "quantities": [2, 2]
    }
  ]
}
```

---

## 8. Desi ve Koli Bilgisi Bildirimi (updateBoxInfo)

### Genel Bilgiler

Bu servis ile **Horoz ve CEVA Lojistik** firmalarına ait sipariş paketleriniz için desi ve koli bilgisi besleyebilirsiniz.

**Önemli:** Horoz ve CEVA Lojistik için **"boxQuantity"** ve **"deci"** değerleri zorunludur.

### PUT updateBoxInfo

**Production URL:**

```
https://apigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/box-info
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/box-info
```

### Örnek Servis İsteği

```json
{
  "boxQuantity": 4,
  "deci": 4.4
}
```

---

## 9. Alternatif Teslimat İle Gönderim

### Genel Bilgiler

Oluşturulan sipariş paketinin müşteriye teslim etmek için **alternatif gönderim seçeneklerinin** kullanıldığı ve bu işlemleri Trendyol'a aşağıdaki servisler ile iletebilirsiniz.

---

### PUT processAlternativeDelivery (Kargo Linki ile Gönderim)

Sipariş paketini gönderdikten sonra elinizde olan **kargo takip linki** ile besleme yapabilirsiniz.

Bu isteği başarılı bir şekilde ilettikten sonra sipariş otomatik olarak **"Shipped" (Taşıma Durumunda)** statüsüne geçecektir.

**Production URL:**

```
https://apigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/alternative-delivery
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/alternative-delivery
```

#### Örnek Servis İsteği

```json
{
  "isPhoneNumber": false,
  "trackingInfo": "http://tex....", //Kargo firmasının takip linki paylaşılmalıdır.
  "params": {}
}
```

---

### PUT processAlternativeDelivery (Telefon Numarası ile Gönderim)

Sipariş paketini gönderdikten sonra siparişin durumu ile alakalı müşterilerin bilgi alabileceği bir **telefon numarası** ile besleme yapabilirsiniz.

Bu isteği başarılı bir şekilde ilettikten sonra sipariş otomatik olarak **"Shipped" (Taşıma Durumunda)** statüsüne geçecektir.

**Production URL:**

```
https://apigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/alternative-delivery
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/alternative-delivery
```

#### Örnek Servis İsteği

```json
{
  "isPhoneNumber": true,
  "trackingInfo": "5555555555",
  "params": {},
  "boxQuantity": 1,
  "deci": 1.4
}
```

#### Data Tipleri

| Alan          | Data Tipi | Açıklama                               | Zorunluluk |
| ------------- | --------- | -------------------------------------- | ---------- |
| isPhoneNumber | bool      | Her zaman "true" olmalıdır             | Zorunlu    |
| trackingInfo  | string    | Teslim edecek kişinin telefon numarası | Zorunlu    |
| params        | map       | Her zaman boş olmalıdır                | Zorunlu    |
| boxQuantity   | int       | Kutu Sayısı                            | Opsiyonel  |
| deci          | float64   | Paketin Desi miktarı                   | Opsiyonel  |

#### Örnek Servis Cevapları

200 cevabını aldıktan sonra sipariş paketlerini çekme servisinden güncel **cargoTrackingNumber** değerine ulaşabilir ve bu değer ile müşteri siparişi teslim aldıktan sonra bu değeri bize iletebilirsiniz.

```
"200 OK"
```

---

### PUT manualDeliver - Kargo Takip Numarası (Alternatif Teslimat ile Gönderilmiş Paketi Teslim Etme)

Bu isteği yaparken bir JSON body ihtiyacı yoktur. İsteği attıktan sonra size **200 OK** cevabı dönecektir.

**Production URL:**

```
https://apigw.trendyol.com/integration/order/sellers/{sellerId}/manual-deliver/{cargoTrackingNumber}
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/manual-deliver/{cargoTrackingNumber}
```

---

### PUT manualDeliver - Paket Numarası (Alternatif Teslimat ile Gönderilmiş Paketi Teslim Etme)

Bu isteği yaparken bir JSON body ihtiyacı yoktur. İsteği attıktan sonra size **200 OK** cevabı dönecektir.

**Production URL:**

```
https://apigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/manual-deliver
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/manual-deliver
```

---

### Alternatif Teslimat İle İade Gerçekleştirme

#### PUT manualReturn - Kargo Takip Numarası (Alternatif Teslimat ile Gönderilmiş Paketin İade Edilmesi)

Bu servisi, tarafınızdan **"shipped"** statüsüne geçirilip müşteriye teslim edilemediği durumda deponuza geri dönen ve bu sebeple **"delivered"** statüsüne geçirilemeyen siparişler için kullanabilirsiniz.

Bu isteği yaparken bir JSON body ihtiyacı yoktur. İsteği attıktan sonra size **200 OK** cevabı dönecektir.

**Production URL:**

```
https://apigw.trendyol.com/integration/order/sellers/{sellerId}/manual-return/{cargoTrackingNumber}
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/manual-return/{cargoTrackingNumber}
```

---

#### PUT manualReturn - Paket Numarası (Alternatif Teslimat ile Gönderilmiş Paketin İade Edilmesi)

Bu servisi, tarafınızdan **"shipped"** statüsüne geçirilip müşteriye teslim edilemediği durumda deponuza geri dönen ve bu sebeple **"delivered"** statüsüne geçirilemeyen siparişler için kullanabilirsiniz.

Bu isteği yaparken bir JSON body ihtiyacı yoktur. İsteği attıktan sonra size **200 OK** cevabı dönecektir.

**Production URL:**

```
https://apigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/manual-return
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/manual-return
```

---

### Alternatif Teslimat İle Dijital Ürün Gönderimi

#### PUT processAlternativeDelivery (Dijital Ürün Teslimatı)

Bu servisi çağırdığınız zaman verdiğiniz bilgiler müşterilere otomatik olarak **SMS ve e-mail** olarak iletilecektir.

**Önemli:** digitalCode alanı **6-120 karakter** arasında olmalıdır.

**Production URL:**

```
https://apigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/alternative-delivery
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/alternative-delivery
```

#### Örnek Servis İsteği

Dijital ürünler için var olan bu serviste siparişin teslim edildi bilgisi Trendyol tarafından otomatik iletilecektir.

```json
{
  "isPhoneNumber": true,
  "trackingInfo": "5555555555",
  "params": {
    "digitalCode": "AX4567fasdf"
  }
}
```

## 10. Yetkili Servis İle Gönderim

### Genel Bilgiler

Ürünlerini **yetkili servise** kargolayan satıcılarımızın bu servisi çağırmaları gerekmektedir.

**Kimler Kullanmalı:**

- Lojistik firmalarıyla **Tedarikçi Öder** entegrasyonu yapan satıcılar
- Ürünlerini yetkili servise kargolayan satıcılar
- Mevcut durumda lojistik firmalarından sadece **Horoz Lojistik** ile tedarikçi öder çalışmamız bulunmaktadır

**Önemli:** Paket **shipped** statusune geçirilene kadar herhangi bir zamanda bu servis çağırılabilir.

### PUT delivered-by-service

**Production URL:**

```
https://apigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/delivered-by-service
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/delivered-by-service
```

---

## 11. Paket Kargo Firması Değiştirme (changeCargoProvider)

### Genel Bilgiler

Bu metod sipariş paketlerinin kargo firmalarının değiştirilmesi için kullanılmaktadır.

**Önemli Kurallar:**

- Bu işlem bir paket için **5 dakika içerisinde yalnızca 1 kere** yapılabilir
- Kargo değişiminden sonra ilgili paketi **sipariş servisimizden tekrar çekerek** kontrol etmeniz gerekmektedir
- Kargo firması **TEX** olarak gönderilen güncelleme istekleri satıcının TEX kotasının dolduğu durumlarda geçersiz olacaktır

### PUT changeCargoProvider (Paket Kargo Firması Değiştirme)

**Production URL:**

```
https://apigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/cargo-providers
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/cargo-providers
```

### Örnek Servis İsteği

```json
{
  "cargoProvider": "string"
}
```

### cargoProvider Değerleri

**cargoProvider** değeri için kullanılabilecek değerler aşağıdaki gibidir:

- **"YKMP"**
- **"ARASMP"**
- **"SURATMP"**
- **"HOROZMP"**
- **"DHLECOMMP"**
- **"PTTMP"**
- **"CEVAMP"**
- **"TEXMP"**
- **"KOLAYGELSINMP"**
- **"CEVATEDARIK"**

---

## 12. Depo Bilgisi Güncelleme

### Genel Bilgiler

Bu servis **sadece Trendyol Express kullanan satıcılarımız için** geçerli olacaktır.

Bu servis ile Sipariş Paketlerini Çekme servisinden dönen **"WarehouseId"** alanı güncellenebilecektir.

**Not:** Eğer sevkiyat adresi eklenmesi isteniyor ise satıcı paneli üzerinden ekleme yapılabilmektedir.

### PUT updateWarehouse

**Production URL:**

```
https://apigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/warehouse
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/warehouse
```

### Örnek Servis İsteği

```json
{
  "warehouseId": int
}
```

### Başarılı Servis Cevabı

```
"200 OK"
```

### Hatalı Servis Cevabı

```
"400 Bad Request"  // paket statusu update etmeye uygun değilse (Created, Invoiced, Picking dışında ise)
```

---

## 13. Ek Tedarik Süresi Tanımlama

### Genel Bilgiler

Bu servis üzerinden dileyen satıcılar sipariş paketleri için **ek tedarik süresi** tanımlama işlemi gerçekleştirebilmektedir.

**Önemli Kurallar:**

- **agreedDeliveryDateExtendible** true döndüğü durumda aşağıdaki servis kullanılabilecektir
- False iken istek atıldığı durumda tarafınıza hata dönecektir
- Ek süre girilebilmesi için **belirlenen bir tarih aralığı** olacaktır
- Bu tarih aralığını sipariş paketlerini çekme servisinde **agreedDeliveryExtensionStartDate**, **agreedDeliveryExtensionEndDate** olarak görebilirsiniz
- Ek süre girilmediği durumda **agreedDeliveryExtensionEndDate** tarihinde sipariş Trendyol tarafından iptal edilecektir

### Sipariş Paketlerini Çekme Servisi - Yeni Alanlar

Sipariş paketlerini çekme servisi response body'sine aşağıdaki alanlar eklenmiştir:

- **"agreedDeliveryDateExtendible"**
- **"extendedAgreedDeliveryDate"**
- **"agreedDeliveryExtensionStartDate"**
- **"agreedDeliveryExtensionEndDate"**

### PUT agreedDeliveryDate

**Production URL:**

```
https://apigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/extended-agreed-delivery-date
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/extended-agreed-delivery-date
```

### Örnek İstek

```json
{
  "extendedDayCount": 1 // 1, 2, 3 değerlerinden birini alabilir.
}
```

---

## 14. Test Siparişlerinde Statü Güncellemeleri

### Genel Bilgiler

Test senaryolarınızı gerçekleştirmek adına **stage ortamda** vermiş olduğunuz siparişler için statüleri aşağıdaki servis aracılığıyla güncelleyebilirsiniz.

**Önemli Notlar:**

- Bu servis **sadece stage ortamı için** kullanılmaktadır
- Header içinde **SellerID** gönderilmelidir
- Değeri ise kullanmış olduğunuz test satıcısının satıcı ID'si olmalıdır
- Header içerisinde göndermiş olduğunuz satıcıId ile **basic authentication** yapmanız gerekmektedir

### Güncellenebilir Statüler

Aşağıdaki statülere güncelleyebilirsiniz:

- **Shipped**
- **AtCollectionPoint**
- **Delivered**
- **UnDelivered**
- **Returned**

### Statü Açıklamaları

| Status            | Açıklama                                                       |
| ----------------- | -------------------------------------------------------------- |
| Shipped           | Paket kargoya verildi                                          |
| AtCollectionPoint | Paket kargo firmasının dağıtım noktasına ulaştı                |
| Delivered         | Paket teslimat noktasına ulaştı                                |
| UnDelivered       | Paket teslim edilemedi (kargonun dağıtım merkezine geri döndü) |
| Returned          | Paket geri gönderildi                                          |

**Önemli:** Statüler **sıralı ilerlemektedir**. Örneğin **"Delivered"** olan bir paket **"AtCollectionPoint"** ve **"Shipped"** statüsüne geri çekilemez.

### Method PUT

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/test/order/sellers/{sellerId}/shipment-packages/{packageId}/status
```

### Örnek Servis İsteği

```json
{
  "lines": [
    {
      "lineId": 4944785,
      "quantity": 1
    }
  ],
  "params": {},
  "status": "Delivered"
}
```

### Başarılı Servis Cevabı

```
"200 OK"
```

---

### İade Test Siparişlerini WaitingInAction Statüsüne Çekme

Test senaryolarınızı gerçekleştirmek adına stage ortamda vermiş olduğunuz siparişler için yaratmış olduğunuz iade talepleri sonrasında iade statüsünü **waitinginaction'a** çekmek için aşağıdaki servisi kullanabilirsiniz.

**Not:** Bu servis **sadece stage ortamı için** kullanılmaktadır.

### Method PUT

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/test/order/sellers/{sellerId}/claims/waiting-in-action
```

### Örnek Servis İsteği

```json
{
  "shipmentPackageId": 56526451 // getClaims servisinden dönen "orderShipmentPackageId" değerine karşılık gelmektedir
}
```

### Başarılı Servis Cevabı

```
"200 OK"
```

---

## 15. Adres Bilgileri

### Genel Bilgiler

Sipariş paketlerini çekme servisinden dönen adres bilgilerine aşağıdaki servisler üzerinden ulaşabilirsiniz.

---

### Ülke Bilgisi

**HTTP METHOD:** GET

Ülke bilgisine aşağıdaki servisten ulaşabilirsiniz.

#### Servis Endpointleri

**Production URL:**

```
https://apigw.trendyol.com/integration/member/countries
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/member/countries
```

---

### GULF ve CEE Ülkeleri İçin İl Bilgisi

**HTTP METHOD:** GET

Gulf ve Cee ülkeleri için ilgili ülke kodu ile o ülkenin il bilgisine aşağıdaki servisten ulaşabilirsiniz.

**Not:** CountryCode bilgisini ülke bilgisi servisinden dönen **"code"** alanından almalısınız.

#### Servis Endpointleri

**Production URL:**

```
https://apigw.trendyol.com/integration/member/countries/{CountryCode}/cities
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/member/countries/{CountryCode}/cities
```

**Önemli:** CEE ülkeleri için ilçe bilgisi servisimizde bulunmamaktadır.

---

### GULF Ülkeleri İçin İlçe Bilgisi

**HTTP METHOD:** GET

Gulf ülkeleri için ilçe bilgilerine aşağıdaki servisten ulaşabilirsiniz.

**Not:** CityCode bilgisini il bilgisi servisinden dönen **"id"** alanından almalısınız.

#### Servis Endpointleri

**Production URL:**

```
https://apigw.trendyol.com/integration/member/countries/{CountryCode}/cities/{cityId}/districts
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/member/countries/{CountryCode}/cities/{cityId}/districts
```

---

### Azerbaycan İçin İl Bilgisi

**HTTP METHOD:** GET

Azerbaycan için il bilgilerine aşağıdaki servisten ulaşabilirsiniz.

#### Servis Endpointleri

**Production URL:**

```
https://apigw.trendyol.com/integration/member/countries/domestic/AZ/cities
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/member/countries/domestic/AZ/cities
```

---

### Azerbaycan İçin İlçe Bilgisi

**HTTP METHOD:** GET

Azerbaycan için ilçe bilgilerine aşağıdaki servisten ulaşabilirsiniz.

**Not:** CityCode bilgisini il bilgisi servisinden dönen **"id"** alanından almalısınız.

#### Servis Endpointleri

**Production URL:**

```
https://apigw.trendyol.com/integration/member/countries/domestic/AZ/cities/{cityCode}/districts
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/member/countries/domestic/AZ/cities/{cityCode}/districts
```

---

### Türkiye İçin İl Bilgisi

**HTTP METHOD:** GET

Türkiye için il bilgisine aşağıdaki servisten ulaşabilirsiniz.

#### Servis Endpointleri

**Production URL:**

```
https://apigw.trendyol.com/integration/member/countries/domestic/TR/cities
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/member/countries/domestic/TR/cities
```

---

### Türkiye İçin İlçe Bilgisi

**HTTP METHOD:** GET

Türkiye için ilçe bilgilerine aşağıdaki servisten ulaşabilirsiniz.

**Not:** CityCode bilgisini il bilgisi servisinden dönen **"id"** alanından almalısınız.

#### Servis Endpointleri

**Production URL:**

```
https://apigw.trendyol.com/integration/member/countries/domestic/TR/cities/{CityCode}/districts
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/member/countries/domestic/TR/cities/{CityCode}/districts
```

---

### Türkiye İçin Mahalle Bilgisi

**HTTP METHOD:** GET

Türkiye için mahalle bilgilerine aşağıdaki servisten ulaşabilirsiniz.

**Notlar:**

- CityCode bilgisini il bilgisi servisinden dönen **"id"** alanından almalısınız
- DistrictCode bilgisini ilçe bilgisi servisinden dönen **"id"** alanından almalısınız

#### Servis Endpointleri

**Production URL:**

```
https://apigw.trendyol.com/integration/member/countries/domestic/TR/cities/{CityCode}/districts/{DistrictCode}/neighborhoods
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/member/countries/domestic/TR/cities/{CityCode}/districts/{DistrictCode}/neighborhoods
```

## 16. İşçilik Bedeli Tutarı Gönderme

### Genel Bilgiler

İşçilik bedeli tutarını beslemek için bu servisi kullanmanız gerekmektedir.

**Önemli Kurallar:**

- **"laborCostPerItem"** alanı line üzerindeki **tek bir item için** işçilik bedeline karşılık gelmektedir
- Paket statusu **"delivered"** olana kadar bu besleme yapılabilir
- **"delivered"** statusu sonrası güncelleme yapılamaz
- **"laborCostPerItem"** 0'dan küçük olamaz
- İtem'in faturalandırılacak tutarından büyük olamaz
- **Yalnızca belirli kategoriler için** beslenebilir (kategori ID listesine aşağıdaki tablodan ulaşabilirsiniz)
- Bu servis ile paket statusu **"delivered"** olana kadar güncellenebilir
- **"laborCostPerItem"** beslenmesi zorunlu değildir
- Girilen değerler sipariş paketlerini çekme servisinden ilerleyen dönemde dönecektir (**"lines"** alanı altından)

### İşçilik Bedeli Tutarı Gönderme

**HTTP METHOD:** PUT

**Production URL:**

```
https://apigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/labor-costs
```

**Stage URL:**

```
https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/labor-costs
```

### Örnek Servis İsteği

```json
[
  {
    "orderLineId": 3653527482,
    "laborCostPerItem": 32.12
  },
  {
    "orderLineId": 3653527483,
    "laborCostPerItem": 78.65
  }
]
```

### Başarılı Servis Cevabı

```
"200 OK"
```

---

### İşçilik Bedeli Beslenmesi Gereken Kategori Listesi

| MainCategory | SubCategory              | CategoryId |
| ------------ | ------------------------ | ---------- |
| Mücevher     | Altın Bileklik           | 1238       |
| Mücevher     | Pırlanta Bileklik        | 1240       |
| Mücevher     | Altın Kolye              | 1246       |
| Mücevher     | Pırlanta Kolye           | 1248       |
| Mücevher     | Altın Küpe               | 1254       |
| Mücevher     | Pırlanta Küpe            | 1256       |
| Mücevher     | Altın Yüzük              | 1258       |
| Mücevher     | Pırlanta Yüzük           | 1260       |
| Mücevher     | Altın Set & Takım        | 1264       |
| Mücevher     | Pırlanta Set & Takım     | 1266       |
| Mücevher     | Altın Kıkırdak Küpe      | 3418       |
| Mücevher     | Pırlanta Kıkırdak Küpe   | 3419       |
| Mücevher     | Altın Halhal             | 3501       |
| Mücevher     | Altın Şahmeran           | 3504       |
| Mücevher     | Elmas Bileklik           | 3883       |
| Mücevher     | Elmas Kolye              | 3884       |
| Mücevher     | Elmas Küpe               | 3885       |
| Mücevher     | Elmas Yüzük              | 3886       |
| Mücevher     | Elmas Set & Takım        | 3887       |
| Mücevher     | Altın Kolye Ucu          | 5255       |
| Mücevher     | Altın Alyans             | 5597       |
| Sarrafiye    | Tam Altın                | 1229       |
| Sarrafiye    | Yarım Altın              | 1230       |
| Sarrafiye    | Çeyrek Altın             | 1231       |
| Sarrafiye    | Gram Altın               | 1232       |
| Sarrafiye    | Cumhuriyet Altını        | 1234       |
| Sarrafiye    | Reşat Altın              | 1236       |
| Sarrafiye    | Ata Altın                | 1237       |
| Sarrafiye    | Yatırımlık Altın Bilezik | 3017       |
| Sarrafiye    | Gram Gümüş               | 4050       |
| Sarrafiye    | Sarrafiyeli Takılar      | 5317       |
| Takı         | Gümüş Bileklik           | 1239       |
| Takı         | Gümüş Halhal             | 3499       |
| Takı         | Gümüş Kıkırdak Küpe      | 3416       |
| Takı         | Gümüş Kolye              | 1247       |
| Takı         | Gümüş Küpe               | 1255       |
| Takı         | Gümüş Şahmeran           | 3502       |
| Takı         | Gümüş Set & Takım        | 1265       |
| Takı         | Gümüş Yüzük              | 1259       |
| Takı         | İnci Bileklik            | 3171       |
| Takı         | İnci Kolye               | 3168       |
| Takı         | İnci Küpe                | 3170       |
| Takı         | İnci Set Takım           | 5209       |
| Takı         | İnci Yüzük               | 3169       |
| Takı         | Gümüş Alyans             | 5598       |

---

## 📋 Sipariş Entegrasyonu - Özet ve En İyi Pratikler

### Genel İş Akışı

#### 1. Test Ortamı Hazırlığı

- Stage ortamda test siparişi oluşturun
- Kurumsal ve mikro ihracat senaryolarını test edin
- Test siparişlerinde statü güncellemelerini kullanın

#### 2. Sipariş Alma Süreci

```
1. Sipariş Paketlerini Çekme (getShipmentPackages)
   ↓
2. Awaiting → Created statüsüne geçişi bekleyin
   ↓
3. Picking statüsü bildirimi (opsiyonel)
   ↓
4. Invoiced statüsü bildirimi
   ↓
5. Kargo işlemleri
   ↓
6. Shipped → Delivered
```

#### 3. Sipariş Paketlerini Çekme

**Önerilen Parametre Seti:**

```
?status=Created
&startDate={timestamp}
&endDate={timestamp}
&orderByField=PackageLastModifiedDate
&orderByDirection=DESC
&size=50
```

**Önemli Limitler:**

- 1 dakika içinde maksimum 1000 istek
- Maksimum 3 aylık geçmiş sorgulanabilir
- startDate ve endDate arası maksimum 2 hafta

#### 4. Paket Statü Yönetimi

**Sıralı Statü İlerlemesi:**

```
Awaiting → Created → Picking → Invoiced → Shipped →
AtCollectionPoint → Delivered
```

**Özel Durumlar:**

- **Cancelled:** İptal edilen siparişler
- **UnPacked:** Bölünmüş paketler
- **UnSupplied:** Tedarik edilemeyen siparişler
- **UnDelivered:** Teslim edilemeyen siparişler
- **Returned:** İade edilen siparişler

#### 5. Paket Bölme İşlemleri

**Ne Zaman Kullanılır:**

- Ürünler farklı zamanlarda hazır olduğunda
- Farklı depolardan gönderim yapılacağında
- Kısmi tedarik durumlarında

**Önemli:** Bölme işleminden sonra yeni paketler **asenkron** oluşur, mutlaka tekrar sipariş çekin.

#### 6. Alternatif Teslimat Senaryoları

**3 Farklı Yöntem:**

1. **Kargo Linki ile Gönderim:** Kargo takip linki paylaşın
2. **Telefon Numarası ile Gönderim:** İletişim telefonu paylaşın
3. **Dijital Ürün Teslimatı:** Dijital kod gönderin (6-120 karakter)

#### 7. Adres Yönetimi

**Bölgelere Göre Servisler:**

- **Türkiye:** İl → İlçe → Mahalle
- **Azerbaycan:** İl → İlçe
- **GULF:** İl → İlçe
- **CEE:** İl (İlçe servisi yok)

### Kritik Hatırlatmalar

#### ✅ Mutlaka Yapılması Gerekenler

1. **Awaiting Statüsü:**
   - Sadece stok kontrolü için kullanın
   - Created statüsüne geçene kadar işlem yapmayın

2. **Tarih Formatları:**
   - orderDate: GMT +3 (Timestamp milliseconds)
   - createdDate: GMT (Timestamp)

3. **Paket Bölme:**
   - Bölme sonrası asenkron işlem
   - Yeni paketleri mutlaka tekrar çekin

4. **Tedarik Edememe:**
   - Yeni paket ID oluşur
   - Eski paket iptal edilir
   - Yeni paketi tekrar çekin

5. **Kargo Değişimi:**
   - 5 dakika içinde 1 kere yapılabilir
   - TEX kotası kontrolü yapın

#### ❌ Yapılmaması Gerekenler

1. Awaiting statüsünde kargoya vermeyin
2. Picking ve Invoiced sırasını tersine çevirmeyin
3. Delivered olan paketi geri çekmeyin
4. 1 dakikada 1000'den fazla istek atmayın
5. 3 aydan eski siparişleri sorgulamayın

### Özel Durumlar

#### Kurumsal Faturalı Siparişler

```json
{
  "commercial": true,
  "invoiceAddress": {
    "company": "...",
    "taxNumber": "...",
    "taxOffice": "...",
    "eInvoiceAvailable": true/false
  }
}
```

#### Mikro İhracat Siparişleri

- **micro** alanını kontrol edin
- **productOrigin** menşei bilgisini faturaya ekleyin
- Ülke kodlarını doğru kullanın (AZ, SA, AE, QA, KW, OM, BH)

#### 3pByTrendyol (Trendyol İhracat Partnerliği)

```json
{
  "3pByTrendyol": true,
  "micro": false,
  "invoiceAddress": {
    // Trendyol şirket bilgileri
  }
}
```

#### Altın ve Yüksek Tutarlı Siparişler

- 5000₺ üzeri siparişlerde **IdentityNumber** alanı dolu gelir
- Altın ve gübre ürünlerinde TCKN zorunludur

### Kargo Şirketi Kodları

**İlk 3 Rakama Göre:**

- **733:** Trendyol Express
- **725:** Yurtiçi Kargo
- **732:** Alternatif Teslimat
- **734:** PTT Kargo
- **884:** Horoz Lojistik

**cargoProvider Kodları:**

- YKMP, ARASMP, SURATMP, HOROZMP
- DHLECOMMP, PTTMP, CEVAMP, TEXMP
- KOLAYGELSINMP, CEVATEDARIK

### İşçilik Bedeli Kuralları

**Önemli Noktalar:**

- Sadece mücevher, sarrafiye ve takı kategorileri için
- 0'dan küçük olamaz
- Item tutarından büyük olamaz
- Delivered olana kadar güncellenebilir
- Zorunlu değil, opsiyonel

### Servis Limitleri Tablosu

| Servis                            | Limit                | Açıklama               |
| --------------------------------- | -------------------- | ---------------------- |
| getShipmentPackages               | 1000 req/dakika      | Sipariş çekme          |
| changeCargoProvider               | 1 req/5 dakika/paket | Kargo değişimi         |
| Tarih aralığı (startDate-endDate) | 2 hafta              | Maksimum aralık        |
| Geçmiş sorgu                      | 3 ay                 | Maksimum geçmişe dönük |
| Page size                         | 200                  | Maksimum sayfa boyutu  |
| digitalCode                       | 6-120 karakter       | Dijital ürün kodu      |

### Hata Yönetimi

#### Sık Karşılaşılan Hatalar

1. **"Shipment Update Edilebilir Bir Durumda Değil"**
   - Paket cancelled, shipped veya delivered durumunda
   - Statü uygun olana kadar bekleyin

2. **"TEX kotası doldu"**
   - Trendyol Express kotası bitti
   - Alternatif kargo seçin

3. **"400 Bad Request" (Depo Güncelleme)**
   - Paket Created, Invoiced, Picking dışında
   - Uygun statüde tekrar deneyin

### Test Senaryoları (Stage Ortam)

#### Sipariş Akış Testi

```
1. Test siparişi oluştur
2. Sipariş paketlerini çek
3. Picking bildirimi yap
4. Invoiced bildirimi yap
5. Shipped statüsüne çek
6. Delivered statüsüne çek
```

#### İade Testi

```
1. Test siparişi oluştur
2. Delivered yap
3. İade talebi oluştur
4. WaitingInAction statüsüne çek
```

---

## 🔗 İlgili Dokümanlar

- Ürün Entegrasyonu
- Teslimat Entegrasyonu
- İade Entegrasyonu
- Fatura Entegrasyonu
- Satıcı Bilgileri Entegrasyonu
- Webhook Servisleri

---

## ✅ Sipariş Entegrasyonu Kontrol Listesi

### Başlangıç

- [ ] Test ortamı bilgilerini edinin
- [ ] Basic authentication ayarlayın
- [ ] Test siparişi oluşturun

### Sipariş Alma

- [ ] getShipmentPackages servisini entegre edin
- [ ] Awaiting ve Created statülerini ayırt edin
- [ ] PackageLastModifiedDate sıralamasını kullanın
- [ ] 1000 req/dakika limitini kontrol edin

### Statü Yönetimi

- [ ] Picking bildirimi entegrasyonu
- [ ] Invoiced bildirimi entegrasyonu
- [ ] Kargo takip kodu bildirimi (gerekirse)

### Özel Durumlar

- [ ] Tedarik edememe senaryosu
- [ ] Paket bölme senaryosu
- [ ] Alternatif teslimat yöntemleri
- [ ] Kurumsal fatura kontrolü
- [ ] Mikro ihracat kontrolü

### Adres Yönetimi

- [ ] Türkiye adres servisleri
- [ ] Azerbaycan adres servisleri
- [ ] GULF adres servisleri
- [ ] CEE adres servisleri

### Son Kontroller

- [ ] İşçilik bedeli besleme (gerekirse)
- [ ] Kargo değişim senaryosu
- [ ] Depo güncelleme (TEX için)
- [ ] Ek tedarik süresi tanımlama

---

**Son Güncelleme:** Ocak 2026

**Doküman Versiyonu:** v1.0

**İletişim:** API Entegrasyon Destek Talebi başlığından destek talep edebilirsiniz.
