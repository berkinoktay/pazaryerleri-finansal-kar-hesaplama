# PazarSync — Product Vision & Requirements

## E-ticaret Satıcıları İçin Karlılık ve Operasyon Yönetim Platformu

---

Türkiye'de pazaryerlerinde satış yapan binlerce işletme var. Trendyol'da, Hepsiburada'da ve başka pazaryerlerinde mağaza açıyorlar, ürünlerini listeliyorlar, siparişleri karşılıyorlar. Ama çoğu satıcı şu soruyu güvenle cevaplayamıyor: "Bu ay gerçekten ne kadar kazandım?"

Çünkü ciro görmek kolay — pazaryeri panellerinde satış rakamları var. Ama gerçek kârı hesaplamak bambaşka bir iş. Komisyon oranları kategoriye göre değişiyor. Kargo maliyeti desi'ye göre farklı. Platform hizmet bedeli haftalık kesiliyor. İadeler geliyor, indirim kampanyaları var, KDV hesaplamaları var. Bunların hepsini bir araya getirip "bu siparişten şu kadar kazandım, bu üründen şu kadar kaybettim" diyebilmek — çoğu satıcının Excel'lerle, elle, haftalar sonra yapabildiği bir şey.

Biz bu problemi çözüyoruz.

---

## Ne Yapıyor?

Platform, satıcının pazaryeri hesaplarını API üzerinden bağladığı anda çalışmaya başlıyor. Siparişler, iadeler, komisyon oranları, kargo faturaları, platform kesintileri — tüm finansal veriler otomatik olarak çekiliyor ve birleştiriliyor.

**Sipariş bazında gerçek karlılık:** Her bir sipariş için gelir, ürün maliyeti, komisyon, kargo, platform bedeli, KDV ayrıştırması yapılıyor. Satıcı sadece "bu ay 50.000 TL sattım" değil, "bu siparişten 12 TL kâr ettim, şu siparişten 3 TL zarar ettim" seviyesinde görüyor.

**Ürün bazında analiz:** Hangi ürünler gerçekten para kazandırıyor, hangileri komisyon ve kargo maliyeti yüzünden zararda — bunu görmek, portföy kararlarını veri odaklı almayı sağlıyor.

**Gider yönetimi:** Ürün maliyetleri, reklam harcamaları, paketleme giderleri gibi tüm kalemler sisteme girilebiliyor. Böylece karlılık hesabı sadece pazaryeri verisiyle değil, gerçek operasyonel maliyetlerle yapılıyor.

**Otomatik mutabakat:** Pazaryeri ödemelerinin doğruluğunu kontrol etmek satıcılar için büyük bir sıkıntı. Sistem, sipariş verisini, hakediş raporlarını ve kargo faturalarını otomatik eşleştirip, "pazaryeri sana doğru mu ödedi?" sorusunu cevaplayabiliyor.

---

## Kime Hitap Ediyor?

Birincil hedef, Türkiye pazaryerlerinde aktif satış yapan küçük, orta ve büyük ölçekli e-ticaret işletmeleri. Ayda yüzlerce veya binlerce sipariş alan, birden fazla pazaryerinde mağazası olan, ama henüz kurumsal ERP sistemlerine yatırım yapacak ölçekte olmayan satıcılar.

Bu satıcılar genellikle:

- Karlılıklarını Excel'de takip etmeye çalışıyor (veya hiç etmiyor)
- Komisyon ve kargo kesintilerini net göremediği için fiyatlamayı sezgisel yapıyor
- Hangi ürünlerin zararda olduğunu ancak çeyrek sonunda fark ediyor
- Pazaryeri hakediş raporlarını kontrol edecek zamanı veya bilgisi yok

---

## Vizyon

**Kısa vadede** hedef, Türkiye pazaryeri satıcıları için en güvenilir karlılık platformu olmak. Satıcının "gerçekten ne kadar kazanıyorum?" sorusuna saniyeler içinde, sipariş bazında, doğrulanmış cevap verebilen bir araç.

**Orta vadede**, bu finansal altyapı üzerine operasyonel zeka katmanları ekleniyor: fiyatlama optimizasyonu, stok planlama, kampanya performans analizi. Veri zaten var — onu aksiyona dönüştürmek bir sonraki adım.

**Uzun vadede**, farklı pazaryerleri ve farklı ülkelere açılarak, cross-border e-ticaret satıcıları için de aynı değeri sunmak.

---

Özünde bu platform, e-ticaret satıcısının "muhasebecisi" değil — "iş ortağı" olmayı hedefliyor. Sadece geçmişi raporlamak değil, geleceğe dair daha iyi kararlar almasını sağlamak.

---

## Çoklu İşletme, Çoklu Mağaza: Platformun Çalışma Modeli

### Bir Hesap, Birden Fazla İşletme

Platform, tek bir kullanıcı hesabıyla birden fazla işletmeyi yönetebilecek şekilde tasarlanacak. Bir e-ticaret girişimcisinin hem kendi markası hem de danışmanlık verdiği bir müşterisi olabilir. Bir muhasebecinin takip ettiği beş farklı firma olabilir. Bir aile şirketinin farklı tüzel kişilikler altında çalışan üç ayrı e-ticaret operasyonu olabilir.

Her işletme platformda bağımsız bir organizasyon olarak yaşayacak. Veriler, kullanıcılar, ayarlar, mağaza bağlantıları — her şey organizasyon sınırları içinde izole tutulacak. Bir organizasyondaki sipariş verileri, gider kayıtları veya maliyet bilgileri başka bir organizasyondan kesinlikle görülemeyecek. Bu sadece bir uygulama tercihi değil, veritabanı seviyesinde zorunlu kılınacak bir güvenlik katmanı olacak.

Kullanıcı, hesabına giriş yaptığında hangi organizasyonda çalışacağını seçecek. O andan itibaren gördüğü her veri — siparişler, ürünler, karlılık raporları, takım üyeleri — o organizasyona ait olacak.

---

### Takım ve Roller

Bir organizasyon tek kişilik de olabilecek, on kişilik bir ekip de. Her takım üyesinin bir rolü olacak ve bu rol platformda neler yapabileceğini belirleyecek:

**İşletme Sahibi** her şeye erişecek — mağaza bağlantıları, fatura bilgileri, takım yönetimi, tüm finansal veriler. Organizasyonun tek sahibi o olacak.

---

### Mağazalar: Pazaryeri Bağlantıları

Bir organizasyonun birden fazla mağazası olabilecek. Burada mağaza, bir pazaryerindeki satıcı hesabını temsil edecek.

Bir işletme Trendyol'da satış yapıyorsa, Trendyol API bilgilerini girerek bir mağaza bağlantısı oluşturacak. Aynı işletme Hepsiburada'da da satıyorsa, ikinci bir bağlantı daha ekleyecek. Hatta aynı pazaryerinde birden fazla mağazası olan satıcılar — mesela farklı kategoriler için ayrı Trendyol hesapları kullananlar — her birini ayrı bağlantı olarak tanımlayabilecek.

Her mağaza bağlantısı kendi veri akışına sahip olacak:

- Kendi ürün listesi (o mağazadaki aktif ürünler)
- Kendi siparişleri
- Kendi settlement kayıtları (hakediş, komisyon, iade)
- Kendi kargo faturaları
- Kendi senkronizasyon durumu ve geçmişi

---

### İçerik Nasıl Değişecek?

Kullanıcı panele girdiğinde gördüğü her şey iki katmanlı bir filtrelemeyle şekillenecek: organizasyon ve mağaza.

**Organizasyon katmanı** otomatik işleyecek — kullanıcı hangi organizasyondaysa onun verilerini görecek. Bu değiştirilemez, atlanamaz bir kural olacak.

**Mağaza katmanı** ise zorunlu bir seçim olacak. Kullanıcı panele girdiğinde her zaman bir mağaza seçili durumda olacak — varsayılan olarak ilk bağlantısını yaptığı mağaza aktif gelecek. Mağaza seçimi olmadan dashboard görüntülenemeyecek. Kullanıcı mağazalar arasında geçiş yaptığında, tüm ekran o mağazanın verileriyle yeniden şekillenecek:

- **Siparişler sayfası:** Seçili mağazanın siparişleri, o pazaryerinin durum etiketleriyle
- **Ürünler sayfası:** O mağazadaki aktif listeler, o pazaryerinin komisyon oranlarıyla
- **Karlılık:** O mağazaya özel gelir-gider hesabı
- **Senkronizasyon:** O mağazanın son veri çekme durumu, hata varsa detayı

Bu zorunlu seçim bilinçli bir tasarım kararı olacak. Pazaryerleri arasında komisyon yapıları, kargo anlaşmaları ve kampanya mekanizmaları temelden farklı. Trendyol'daki bir ürünün karlılığı ile Hepsiburada'daki aynı ürünün karlılığı çok farklı olabilir. Verileri birleştirmek detay seviyesinde yanıltıcı bir tablo çizebilir — bu yüzden siparişler, ürünler ve karlılık gibi operasyonel sayfalar her zaman seçili mağazanın verilerini gösterecek. Ancak genel bakış veya raporlama alanlarında, satıcının pazaryerleri arasında tek tek geçiş yapmak zorunda kalmadan tüm mağazalarının ciro ve net kar bilgisini tarih bazında toplu görebildiği bir üst katman da sunulabilecek.

---

### Neden Bu Şekilde Tasarlanıyor?

E-ticaret ekosisteminde "tek mağaza, tek kişi" modeli gerçeği yansıtmıyor. Gerçek dünyada:

- Bir satıcının 3 farklı pazaryerinde mağazası oluyor
- Aynı kişi hem kendi işletmesini hem kardeşinin işletmesini yönetiyor
- Muhasebeci 8 farklı müşterisinin e-ticaret verilerini takip ediyor
- Bir operasyon ekibinde 4 kişi farklı sorumluluk alanlarıyla çalışıyor

Platform bu karmaşıklığı basitleştirmek için var olacak. Her işletme kendi alanında izole, her mağaza kendi verileriyle ayrışık, her takım üyesi kendi yetkisiyle sınırlı olacak. Kullanıcı sadece bir tıklamayla bağlam değiştirecek — farklı işletmeye geçecek, farklı mağazayı seçecek — ve gördüğü her şey anında o bağlama uyum sağlayacak.

Bu yapı, platformun ilk günden itibaren büyümeye hazır olmasını da sağlayacak. Tek mağazalı bir satıcı için gereksiz karmaşıklık olmayacak — sadece bir organizasyon, bir mağaza, belki bir kullanıcı. Ama işletme büyüdüğünde, yeni pazaryerleri eklediğinde, ekip kurduğunda, platform zaten hazır olacak.
