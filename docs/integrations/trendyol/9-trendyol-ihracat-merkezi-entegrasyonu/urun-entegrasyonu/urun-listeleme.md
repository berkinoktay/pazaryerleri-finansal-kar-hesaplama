# Ürün Listeleme

> Source: https://developers.trendyol.com/docs/trendyol-autoft/urun-entegrasyonu/urun-listeleme

# Ürün Listeleme

Trendyol’da ihracata açılmış ürünleri listelemek için kullanılır.

PROD

**GET** - https://apigw.trendyol.com/integration/ecgw/v2/**{sellerId}**/products

STAGE

**GET** - https://stageapigw.trendyol.com/integration/ecgw/v2/**{sellerId}**/products

## Filtre Açıklamaları[​](#filtre-açıklamaları "Filtre Açıklamaları doğrudan bağlantı")

Filtre Parametresi

Açıklama

barcodes

Ürünün benzersiz bir tanımlayıcısı olan barkod numarasıdır. Birden çok değer alabilir.

pageKey

Sisteme atılacak ilk istekte boş gönderilir. Sonraki isteklerde bir önceki isteğin response'unda header'da dönen **x-paging-key** değeri sıradaki isteğin **pageKey** değerine setlenmelidir. Bu işlem döngüsel olarak devam etmelidir.

size

Listelenmek istenen ürün sayısı. Maksimum **100**'dür.

> (**\***) Zorunlu Alanlar

not

Döviz türü (currency) bilgisi ihracat merkezine başvuru sırasında satıcı tarafından seçilmektedir. Değişiklik için bizimle iletişime geçebilirsiniz.

not

**type** alanı request modelden kaldırılmıştır. Clientlarımıza herhangi bir etkisi olmayacaktır.

### Örnek Request[​](#örnek-request "Örnek Request doğrudan bağlantı")

GET

**{ROOT\_URL}**/v2/1234/products?size=20&pageKey=1680212960932,898605982&barcodes=8683116492789

### Örnek Response[​](#örnek-response "Örnek Response doğrudan bağlantı")

```
[  {    "barcode": "8681261723738",    // Gönderim sağlanacak barkod, Trendyol sistemlerindeki barkod    "sellerBarcode": "example-seller-barcode",    // Satıcı sistemlerindeki barkod    "rrpPrice": 27.25,    "buyingPrice": 5.12,    "stock": 8,    "origin": "TR",    "composition": "%5 Elastan, %95 Pamuk", // Materyal Bileşeni    "description": "Dantelli V yaka Dikişli kısa kol",    "currency": "EUR",    "gtip": "610831000000",    "categoryId": 1000, //Ürün kategori id'si    "careInstructions": "T44", // Yıkama Talimatı    // Zorunlu Ürün Özellikleri    "attributes": [      {        "attributeId": 200,        "attributeName": "Renk",        "valueId": null,        "valueName": "Yeşil"      },      {        "attributeId": 300,        "attributeName": "Cinsiyet",        "valueId": 101,        "valueName": "Erkek"      },      {        "attributeId": 400,        "attributeName": "Materyal Bileşeni",        "valueId": null,        "valueName": "%5 Elastan, %95 Pamuk"      }    ]  },  {    "barcode": "8681261710478",    // Gönderim sağlanacak barkod, Trendyol sistemlerindeki barkod    "sellerBarcode": "example-seller-barcode-2",    // Satıcı sistemlerindeki barkod    "rrpPrice": 19,    "buyingPrice": 4.21,    "stock": 15,    "origin": "TR",    "composition": "%100 Pamuk",    "description": "İnce yaka işlemeli kısa kollu gömlek",    "currency": "EUR",    "gtip": "621210900000",    "categoryId": 1001,    "careInstructions": "T104",    "attributes": [      {        "attributeId": 200,        "attributeName": "Renk",        "valueId": null,        "valueName": "Yeşil"      },      {        "attributeId": 300,        "attributeName": "Cinsiyet",        "valueId": 101,        "valueName": "Erkek"      },      {        "attributeId": 400,        "attributeName": "Materyal Bileşeni",        "valueId": null,        "valueName": "%100 Pamuk"      }    ]  }]
```

Önemli Not

**composition, careInstructions** alanları **attributes** dizisi içinde listelenecektir. Bu iki alanı mümkün olan en kısa sürede **attributes** dizisinden kullanmanızı tavsiye ederiz.

Önemli Not

Aşağıdaki alanlar ilerleyen belirli bir periyot sonrasında response modelden silinecektir. Bu durumda tarafınıza tekrar bilgilendirme yapılacaktır.

**composition, careInstructions**
