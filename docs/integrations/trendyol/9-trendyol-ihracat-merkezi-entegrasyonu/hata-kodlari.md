# Hata Kodları

> Source: https://developers.trendyol.com/docs/trendyol-autoft/hata-kodlari/

# Hata Kodları

## Error Response[​](#error-response "Error Response doğrudan bağlantı")

### Response Body[​](#response-body "Response Body doğrudan bağlantı")

```
{  "status": 0,  "type": "string",  "traceId": "string",  "error": {    "code": 0,    "title": "string",    "detail": "string"  }}
```

### Response Fields[​](#response-fields "Response Fields doğrudan bağlantı")

Name

Type

Description

status

integer

HTTP cevap kodu (400,401, 500 vb.)

type

string

Ana hata tipi

traceId

string

Hatanın takibinin yapılması için dönecek kod

code

integer

Alınan hatanın özel kod numarası (Detayları 'Kod Tablosu'nda görebilirsiniz)

title

string

Alınan hatanın ana başlığı

detail

string

Alınan hatanın açıklaması

### HTTP Status Codes[​](#http-status-codes "HTTP Status Codes doğrudan bağlantı")

Code

Text

Description

400

Bad Request

İstek geçersiz. Geçersiz sorgu parametreleri olan istekler bu yanıtı alır.

401

Unauthorized

İsteğiniz doğrulanırken bir sorun oluştu. Bunun nedeni, kimlik doğrulama bilgilerinin eksik veya yanlış olması olabilir.

404

Not Found

İstenen URI geçersiz veya istenen kaynak mevcut değil.

500

Internal Server Error

Bu genellikle geçici bir hatadır, örneğin yüksek yük durumunda veya bir uç noktada geçici olarak sorun yaşanıyorsa.

### Common Error Codes[​](#common-error-codes "Common Error Codes doğrudan bağlantı")

Code

Explanation

1001

İstek ulaşırken bir hata oluştu

1002

Zorunlu alanları doldurunuz

1003

Talebiniz gerçekleştirilemedi

1004

Uygun olmayan parametre girildi

1005

Sistemsel bir sorun meydana geldi, tekrar deneyiniz.

1006

Yetkisiz erişim talebi

2000

Sistemsel bir sorun meydana geldi, tekrar deneyiniz.

2001

Geçersiz istek.

2002

Sistemsel bir sorun meydana geldi, tekrar deneyiniz.

2003

Sistemsel bir sorun meydana geldi, tekrar deneyiniz.

2004

Sistemsel bir sorun meydana geldi, tekrar deneyiniz.

2005

Sistemsel bir sorun meydana geldi, tekrar deneyiniz.

2006

Barkod için listing bulunamadı. Öncelikle ürünü yaratmanız gerekmektedir.

2007

Ürün sistemde kayıtlı değil. Lütfen 'Trendyol Pazaryeri'nden ürünü oluşturunuz.

3001

Ürün sistemde kayıtlı değil. Lütfen 'Trendyol Pazaryeri'nden ürünü oluşturunuz.

3002

Eklenmek istenen ürün henüz onaylanmamış.

3003

Eklenmek istenen ürün içerisinde bazı alanlar eksik ya da hatalı.

3004

Geçersiz bir composition bilgisi girildi. (örnek : 95% Pamuk, 5% Elestan)

3005

Eklenmek istenen ürünün teslimat tipi uygun değil.

3006

Bilinmeyen hata. Lütfen tekrar deneyiniz. Devam etmesi durumunda destek ekibi ile iletişime geçiniz.

3007

Oluşturmak istenilen ürün barkodu ile TY barkodu arasında uyuşmazlık vardır.

3008

Sistemsel bir sorun meydana geldi, tekrar deneyiniz.

3009

Ürün satışa uygun değildir.

9999

Bilinmeyen hata. Destek ekibi ile iletişime geçiniz.
