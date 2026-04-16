# Zorunlu HTTP Header Alanları

> Source: https://developers.trendyol.com/docs/trendyol-autoft/zorunlu-http-header-alanlari/

# Zorunlu HTTP Header Alanları

-   Bütün atılacak olan isteklerde aşağıdaki header’ların gönderilmesi zorunludur.

Name

Type

Description

x-clientip

string (IPv4)

İsteğin gönderildiği IPv4 adresi olmalıdır. İstek atılan serverin IP adresi gönderilebilir.

x-correlationid

string (UUID)

Trendyol altyapısında kullanılan log takibi amacıyla UUID olarak değer verilen header’dır. Her seferinde yeni rastgele bir UUID yaratılmalıdır. Bunun gönderilmesi durumunda karşılıklı olarak trendyol ve istemci arasında log takibi yapılmasına imkan sağlar.

x-agentname

string

İsteği yapan client adı, entegrator firma yada satıcı isimi verilebilir.

Authorization

string (Basic Token)

Trendyol panelden alınan API KEY ve API SECRET KEY ile oluşturulur. Bu süreçte kullanacağınız bilgiler, Trendyol Pazaryeri bilgileriniz olmalıdır. Online tool ile oluşturulabilir. [Basic Auth Generator](https://www.debugbear.com/basic-auth-header-generator)
