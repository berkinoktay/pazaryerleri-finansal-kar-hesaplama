# Webhook Model

> Source: https://developers.trendyol.com/docs/marketplace/webhook/webhook-model

# Webhook Model

Webhook ( web kancaları ) geliştirmeleri ile birlikte , belirli bir olay ve ya işlem gerçekleştiğinde başka bir uygulamayı otomatik olarak bilgilendirebileceğiz.

Siparişlerinizi çekmek için kullandığınız getshipmentpackage servisini kullanarak veri almak yerine , webhook ile (web kancaları ile) ,olayın meydana geldiği zaman tetiklenen, sizin paylaştığınız özel bir URL’ye istek gönderen bir mekanizma kullanılmaktadır.

### Webhook Servisi[](#webhook-servisi)

Trendyol Satıcı Merkezi'ndeki sipariş pakerleri ile ilgili bildirim almak için webhook aboneliklerini kullanabilirsiniz. Siparişlerin aşağıdaki statuleri için webhook kullanılabilir

- "CREATED"
- "PICKING"
- "INVOICED"
- "SHIPPED"
- "CANCELLED"
- "DELIVERED"
- "UNDELIVERED"
- "RETURNED"
- "UNSUPPLIED"
- "AWAITING"
- "UNPACKED"
- "AT_COLLECTION_POINT"
- "VERIFIED"

Tüm statuleri tek bir webhook yaratma servisi ile elde edebilirsiniz. Yapılan istekler statu farketmeksizin full order datası olarak iletilecek olup, satıcıların, siparişin istenen durumunu alabilmesi için webhook hizmetini aşağıda ki modele göre sağlamanız gerekmektedir.

### Webhook Authorization[](#webhook-authorization)

İzin verilen 2 tür yetkilendirme yöntemi vardır: "BASIC_AUTHENTICATION" veya "API_KEY". Webhook isteğinizi oluştururken "AuthenticationType" adlı alanda ilgili yöntemlerden birini kullanmalısınız.

- "AuthenticationType" alanı "API_KEY" ise, "apiKey" alanı zorunludur ve "username" ve "password" alanları gönderilmeyebilir.
  - Eğer servisiniz header'da api key bekliyorsa, ilgili alan "x-api-key" olarak gönderilecektir.
- "AuthenticationType" alanı "BASIC_AUTHENTICATION" ise, "username" ve "password" alanları zorunludur. "apiKey" alanı gönderilmeyebilir.

### Webhook Yeniden Tetikleme Modeli[](#webhook-yeniden-tetikleme-modeli)

Webhook servislerinde hata alınması durumunda, sistem otomatik olarak aksiyon alacak olup ilgili webhook isteğini pasife alacaktır, bu kapsamda satıcılarımıza iki adet mail iletiyor olacağız.

- 1.Mailde hata alınan webhook ID ile ilgili bilgileri paylaşıyor olup, bu servise istek atmaya devam edeceğimiz süreyi sizinle paylaşıyor olacağız.
- 2.Mailde ise ilgili sürenin sonuna geldiğimizi ve hata alınan webhook ID nin pasife alındığını sizlere bildirmiş olacağız.

Pasife alınan webhooklarınızı servisinizdeki sorunu giderdikten sonra aktife alabilirsiniz.

### Webhook Önemli Notlar[](#webhook-önemli-notlar)

- Webhook servislerinize yapılan herhangi bir başarısız istek olması durumunda, Trendyol, başarılı olana kadar her 5 dakikada bir başarısız istekleri iletecektir. (Bu gelecekte değiştirilecektir)
- Webhook ile veri gönderimi her zaman olanaklı olamadığı için, ilgili servis üzerinden, Trendyol'dan periyodik olarak veri almak için geliştirme yapmanız tavsiye edilmektedir.
  - Örneğin sipariş datası için bir webhook isteği oluşturduysanız, getshipmentpackage servisini kullanarak periyodik olarak datalarınızı eşitlemenizi öneririz.
- Webhook servislerinizin endpointi "Trendyol", "Dolap", "Localhost" ibareleri içermemelidir.
- 1 satıcı için oluşturulabileceek maksimum webhook sayısı 15 dir. Pasife alınan webhooklarda burdaki sayıya dahildir. Maksimum webhook sayısını aşarsanız var olan webhooklarınızdan uygun olanı silip yeniden webhook tanımlayabilirsiniz

### Webhook Request Modeli[](#webhook-request-modeli)

Şu anda satıcıların getShipmentPackages hizmetiyle yalnızca aynı modele sahip siparişleri kullanmasına izin veriyoruz.

- Request tipi JSON formatında olmalıdır.
- Request methodu POST olmalıdır.

**"createdBy" aşağıdaki değerleri alabilir:**

- "order-creation" -> Paket, gelen siparişle doğrudan oluşturulur
- "cancel" -> Paket, kısmi iptalden sonra oluşturulur
- "split" -> Paket, paket bölünmesine göre oluşturulur
- "transfer" -> Siparişi alan satıcının ürünü olmaması nedeniyle Trendyol tarafından başka bir satıcıya yönlendirilen siparişler.

**Trendyol siparişleri aşağıdaki modele göre iletiyor olacak**

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
