# Hata Kodları

## 7. Trendyol Marketplace Entegrasyonu

Marketplace entegrasyonundaki hata kodlarına aşağıdan ulaşabilirsiniz.

---

## HTTP Durum Kodları

### Başarılı Yanıtlar (2xx)

| Hata Kodu          | Detay                                                             |
| ------------------ | ----------------------------------------------------------------- |
| **200 OK**         | Yaptığınız istek Trendyol tarafından başarıyla işlendi.           |
| **201 Created**    | Yaptığınız istek yerine getirildi ve yeni bir kaynak oluşturuldu. |
| **202 Accepted**   | Yaptığınız istek kabul edildi ancak henüz işleme koyulmadı.       |
| **204 No Content** | Yaptığınız istek kabul edildi ancak içerik döndürülmeyecek.       |

---

### İstemci Hataları (4xx)

| Hata Kodu                      | Detay                                                                                                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **400 Bad Request**            | Yaptığınız istek geçerli bir istek değildi, zorunlu alanlar doldurulmamış ya da yapılan isteğin içinde Trendyol'un kabul etmediği değerler mevcut.       |
| **401 Unauthorized**           | Gerekli kimlik doğrulama bilgileri istekte yok veya yanlış. Yetkilendirmeyi tekrar kontrol edin.                                                         |
| **403 Forbidden**              | Sunucu isteğe yanıt vermeyi reddediyor. Bu eylem için uygun kapsamı talep etmediyseniz genellikle bu durum yaşanır.                                      |
| **404 Not Found**              | İstenilen kaynak bulunamadı veya olmayan bir yere istek gönderildi.                                                                                      |
| **405 Method Not Allowed**     | Yapılan istek doğru metod ile yapılmadı. GET/POST isteğinizin doğru olduğunu kontrol edin.                                                               |
| **409 Resource Conflict**      | İstekteki çakışma nedeniyle istenen kaynak işlenemedi. Örneğin, istenen kaynak beklenen durumda olmayabilir.                                             |
| **414 URI Too Long**           | Sunucu, sağlanan Tekdüzen Kaynak Tanımlayıcısı (URI) çok uzun olduğundan isteği kabul etmeyi reddediyor.                                                 |
| **415 Unsupported Media Type** | Yük biçimi desteklenmeyen bir format olduğundan sunucu isteği kabul etmeyi reddediyor.                                                                   |
| **429 Too Many Requests**      | Yapılan istek sayısı, Trendyol'un belirlediği sınırı aştığı için talep kabul edilmedi. Trendyol'un API oranı sınırları hakkında daha fazla bilgi edinin. |

---

### Sunucu Hataları (5xx)

| Hata Kodu                     | Detay                                                                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **500 Internal Server Error** | Trendyol sisteminde bir hata oluştu. İsteğinizi yeniden deneyin. Sorun devam ederse lütfen tüm hata kodlarını ve işlemlerinizi kaydedin, Trendyol personelinin araştırabilmesi için Çağrı Merkezimiz ile iletişime geçin. |
| **502 Bad Gateway**           | Trendyol sisteminde bir hata oluştu. İsteğinizi yeniden deneyin.                                                                                                                                                          |
| **503 Service Unavailable**   | Trendyol sisteminde bir hata var ve şu anda kullanılamıyor. Bildirilen hizmet kesintileri için Trendyol bildirimlerinizi kontrol edin.                                                                                    |
| **504 Gateway Timeout**       | Yaptığınız istek zamanında tamamlanamadı. Yaptığınız istek çok büyükse, bunu birden fazla küçük isteğe bölmeyi deneyin.                                                                                                   |

---

## Hata Yönetimi İpuçları

### 400 Bad Request

- İstek body'nizin formatını kontrol edin (JSON formatı doğru mu?)
- Zorunlu alanların tamamını gönderdiğinizden emin olun
- Gönderilen değerlerin doğru data tipinde olduğunu kontrol edin

### 401 Unauthorized

- API Key ve Secret Key bilgilerinizi kontrol edin
- Basic Authentication header'ının doğru eklendiğinden emin olun
- Supplier ID'nin doğru olduğunu kontrol edin

### 403 Forbidden

- User-Agent header'ının eklendiğinden emin olun
- Test ortamı için IP yetkilendirmesi yapıldığını kontrol edin
- İstek yaptığınız endpoint için yetkiniz olduğundan emin olun

### 404 Not Found

- Endpoint URL'ini kontrol edin
- Yanlış ID veya parametre göndermediğinizden emin olun
- Base URL'in doğru olduğunu kontrol edin

### 429 Too Many Requests

- Rate limit'e takıldınız
- İstek hızınızı azaltın
- Servis Limitleri dökümanını kontrol edin
- 10 saniye içinde maksimum 50 istek atılabilir

### 500, 502, 503, 504 Sunucu Hataları

- İsteği birkaç saniye sonra tekrar deneyin
- Retry mekanizması uygulayın
- Sorun devam ederse destek ekibiyle iletişime geçin

---

## Destek

Hata durumları için:

- Hata kodunu kaydedin
- İstek ve response loglarını saklayın
- Timestamp bilgisini not edin
- **0850 258 58 00** numaralı çağrı merkezi üzerinden bildirim oluşturun

---

**Son Güncelleme:** Yaklaşık 1 ay önce  
**Kaynak:** [Trendyol Developer Portal - Hata Kodları](https://developers.trendyol.com/docs/hata-kodları)
