# Webhook Aktife/Pasife Alma - Content

## Webhook Aktife Alma

Bu servis ile pasif durumunda olan webhook methodlarını aktife alabilirsiniz. Entegrasyon servislerine gönderilecek istekler, temel kimlik doğrulama yöntemi olan "basic authentication" ile yetkilendirilmelidir. Basic Authentication için kullanılan sellerId, API KEY ve API SECRET KEY bilgileri satıcı panelinde yer alan "Hesap Bilgilerim" bölümündeki "Entegrasyon Bilgileri" sayfasından alınmalıdır.

### PUT activate

#### PROD

https://apigw.trendyol.com/integration/webhook/sellers/{sellerId}/webhooks/{Id}/activate

#### STAGE

https://stageapigw.trendyol.com/integration/webhook/sellers/{sellerId}/webhooks/{Id}/activate

### Örnek Servis Cevabı

200 OK

## Webhook Pasife Alma

Bu servis aktif durumunda olan webhook methodlarını pasife alabilirsiniz. Entegrasyon servislerine gönderilecek istekler, temel kimlik doğrulama yöntemi olan "basic authentication" ile yetkilendirilmelidir. Basic Authentication için kullanılan sellerId, API KEY ve API SECRET KEY bilgileri satıcı panelinde yer alan "Hesap Bilgilerim" bölümündeki "Entegrasyon Bilgileri" sayfasından alınmalıdır.

### PUT deactivate

#### PROD

https://apigw.trendyol.com/integration/webhook/sellers/{sellerId}/webhooks/{Id}/deactivate

#### STAGE

https://stageapigw.trendyol.com/integration/webhook/sellers/{sellerId}/webhooks/{Id}/deactivate

### Örnek Servis Cevabı

200 OK
