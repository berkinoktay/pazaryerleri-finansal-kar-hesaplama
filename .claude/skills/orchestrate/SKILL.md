---
name: orchestrate
description: Onaylanmış bir planı uygulama aşamasında yürütür. Ana oturum (Opus 5.5) orkestratör olur. Özellik işini implementer ajanlarına sırayla devreder ve her adımı Opus ile denetletir. Riskli işte kapanışta bir kez Fable ile denetletir. İşi check:all kapısıyla bitirir. Berkin çok adımlı bir iş, özellik geliştirme ya da "planla ve uygulat" istediğinde ve plan hazır olduğunda bu modu aç.
---

# Orkestrasyon: uygulama aşaması

Bu düzen 2026-11-10'daki denetimde Berkin'in kararlarıyla kuruldu. Birinci öncelik kalite ve doğruluktur; maliyet ikinci planda. Ajanın "yaptım, geçti" sözüne değil, mekanik kontrole güvenilir.

## 0. Başlarken

- **Model:** uygulama aşamasında ana oturum Opus 5.5 ile çalışır.
  - Aktif model Fable ise (planlama aşamasından kalmış olabilir) Berkin'e "Plan onaylandı; uygulamaya geçmeden `/model opus` yazmanı öneririm" de ve cevabını bekle. Modeli kendin değiştirme.
- **Plan:** onaylı bir plan ya da spec yoksa önce planlama yapılır.
  - Planlama, superpowers `brainstorming` ve ardından `writing-plans` ile yürür.
  - Planlama Fable 5.1 ile yapılır. Berkin'e `/model fable` öner.
- **Tek yazıcı:** `git status --short` çıktısına bak.
  - Bu oturumun yapmadığı commit'lenmemiş bir değişiklik varsa dur ve Berkin'e sor. Başka bir oturumun yarım işi olabilir.
  - Başka bir oturum aynı repoda yazıyorsa (`ListAgents` o oturumu meşgul gösteriyorsa) bekle ya da sor.

## 1. Rolün

Sen ana oturumsun ve uygulayıcılar da Opus'ta çalışıyor. Bu yüzden işi devretmenin amacı daha güçlü bir model kullanmak değil. Üç amacı var:

1. Ana bağlamı uzun uygulama çıktısından temiz tutmak.
2. Her yazma adımını `implementer`'ın kontrol kapısından geçirmek. Bu kapı Stop kancası olarak çalışır ve ajanın typecheck, lint, birim test ya da UTF-8 hatasıyla bitirmesine izin vermez.
3. Kodu taze gözle denetletmek.

İşin türüne göre kimin yapacağı:

- **Özellik işi** birden fazla dosyaya dokunur, yeni davranış ekler ya da test yazımı gerektirir. Bu iş `implementer`'a gider.
- **Küçük düzeltmeyi kendin yap.** Kapanış kapısında çıkan hatalar ve birkaç satırlık tek dosya değişiklikleri buna girer. Bu değişiklikler de kapanıştaki `check:all`'dan geçer.
- **Türkçe kullanıcı metnini** (i18n değerleri, Türkçe doküman) kendin yaz ya da metni brifte birebir ver. Alt ajanlar çok baytlı karakterleri bozabiliyor.
- **Akış ve operasyon işlerinde ajan açma:** onay, merge, "devam", commit, PR ve tek komutluk koşuları kendin yap.

## 2. Ajan kadrosu ve model kuralı

| İş                                               | Ajan                        | Model                    |
| ------------------------------------------------ | --------------------------- | ------------------------ |
| Uygulama adımı (varsayılan)                      | `implementer`               | Opus 5.5 (frontmatter)   |
| Prisma şeması, migration, RLS politikası         | `supabase-schema-architect` | Opus 5.5                 |
| Kök nedeni bilinmeyen hata, flake analizi        | `debugger`                  | Opus 5.5                 |
| Adım denetimi                                    | `code-reviewer`             | Opus 5.5                 |
| Kapanış denetimi (yalnızca riskli işte, bir kez) | `code-reviewer`             | çağrıda `model: "fable"` |
| Geniş keşif (dosya dökümü değil, sonuç lazım)    | `Explore`                   | varsayılan               |

- **Model kuralı:** ajan çağrısında `model: "sonnet"` ya da `model: "haiku"` verme. Berkin'in kararı: önemli iş her zaman en güçlü modelde yapılır.
- **Opus sürümü sabit:** ajan tanımlarında `model: claude-opus-5-5` yazar. Proje `settings.json` dosyası da `ANTHROPIC_DEFAULT_OPUS_MODEL` ile `opus` takma adını Opus 5.5'e bağlar. Bu yüzden `/model opus` ve çağrıdaki `model: "opus"` da Opus 5.5'e gider. Yeni bir Opus sürümüne geçmek Berkin'in kararıdır; bu iki yer birlikte güncellenir.
- `superpowers:subagent-driven-development` kullanma, çünkü genel amaçlı ajanlara düşük model atıyor.
- Workflow aracını yalnızca Berkin açıkça isterse aç, küçük boyutta tut.
- `Explore`'a dar ve net bir kapsam ver ("şu klasörde şunu bul") ve yalnızca sonucu iste. Kapsamsız tarama çok uzun sürüyor.

## 3. Akış

1. **Anla.**
   - Planı, kök `CLAUDE.md` dosyasını ve ilgili alt klasörün `CLAUDE.md`'sini oku.
   - Tenant, kimlik bilgisi ya da para yolu varsa `docs/SECURITY.md`'yi oku.
   - Kâr motoru işinde `docs/business-rules/profit-formula.md`'yi oku.
2. **Böl.** İşi bağımsız ve tek sorumlu adımlara ayır. Her adım için şunları yaz: hangi dosyalar, ne değişecek, kabul kriteri ne. Mimari kararları sen ver; uygulayıcıya "sen karar ver" bırakma.
3. **Sırayla devret.**
   - Aynı anda yalnızca bir yazan ajan çalışır (`implementer`, `supabase-schema-architect` ya da `debugger`). Bunun iki sebebi var: kontrol kapısı çalışma ağacındaki tüm değişiklikleri kontrol ediyor ve Berkin'in makinesi paralel ağır koşumda donuyor.
   - Paralel çalışma yalnızca salt-okunur ajanlarda (`Explore`, `code-reviewer`) yapılır.
4. **Adım dönüşünü denetle.**
   - `.claude/state/verify-last.log` dosyasının son satırını oku: `PASS`, `WARN`, `FAIL` ya da `GAVE_UP`.
   - `GAVE_UP` görürsen ya da raporda **KIRMIZI** yazıyorsa adım başarısızdır. Düzeltme adımını devret; küçükse kendin düzelt.
   - Raporu tarife karşı oku. "Geçti" sözü kanıt değildir.
   - Anlamlı her adımdan sonra `code-reviewer`'ı Opus ile çalıştır. Brife uygulayıcının özetini koyma.
5. **Kapanış kapısından geç.** Adımlar sırasıyla:
   1. **Riskli işse** bütün diff için bir kez `code-reviewer`'ı `model: "fable"` ile çağır. Riskli iş: para ya da kâr hesabı, tenant kapsamlı sorgu ya da endpoint, kimlik bilgisi ya da şifreleme, migration. Fable kullanılamazsa (limit ya da hata) denetimi Opus ile yap ve bunu kapanış raporunda açıkça yaz.
   2. `/code-review` (yerleşik komut). Bulguları uygula ya da `--fix` kullan.
   3. React kodu değiştiyse `/vercel-react-best-practices`, veritabanı kodu değiştiyse `supabase:supabase-postgres-best-practices` çalıştır.
   4. `apps/web` değiştiyse `/frontend-pr-review` çalıştır.
   5. `pnpm check:all` komutunu kendin ve tek başına koş; başka ağır süreç çalışırken koşma. Kırmızıysa küçük hatayı kendin düzelt, büyüğünü devret, sonra yeniden koş.

   Kapı yeşil olmadan "tamamlandı" deme.

6. **Raporla.** Kısa ve tam cümlelerle Türkçe yaz:
   - ne yapıldı;
   - ne doğrulandı (hangi komut, hangi sonuç);
   - Fable denetimi yapıldı mı;
   - ne açık kaldı.

   Commit için Berkin'den onay iste.

## 4. Brif şablonları

`implementer` için:

```
Adım: <tek cümlelik amaç>
Dosya(lar): <yollar>
Yapılacak: <net talimat; mimari kararlar dahil>
Kabul kriteri: <nasıl doğru sayılır>
Kurallar ve skill'ler: <okunacak dosyalar; Skill aracıyla yüklenecek skill'ler>
Türkçe metin: <birebir metin ya da "yok">
Kısıtlar: <tenant filtresi, decimal.js, i18n, dokunulmayacak dosyalar>
```

`code-reviewer` için (uygulayıcının özeti EKLENMEZ):

```
Diff: <git diff aralığı ve yollar>
Özgün istek: <Berkin'in kendi cümlesi>
Plan/spec: <yol>
Kurallar: <SECURITY.md §9 / profit-formula.md / ilgili CLAUDE.md>
Odak: <bu adımda özellikle bakılacak risk>
```

## 5. Yasaklar

- `tests/integration/rls` takımını hiçbir ajana koşturma. Bu takım geliştirme veritabanını siliyor.
- Git durumunu değiştiren komutlar (commit, stash, checkout, reset, rebase, merge) yalnızca ana oturumda ve Berkin'in onayıyla çalışır. Proje ayarları bunların çoğu için zaten onay soruyor.
