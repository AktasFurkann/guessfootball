# guessfootball

Transfermarkt kariyer verisiyle beslenen "futbolcuyu tahmin et" oyununun backend'i.
Veri toplama betigi + MongoDB + Express API.

## Hizli baslangic

```bash
npm install
cp .env.example .env      # ve MONGODB_URI'yi doldur
npm run scrape            # Transfermarkt'tan veriyi cek ve DB'ye yaz (~8 dk)
npm run dev               # http://localhost:3000
```

Tarayicida **http://localhost:3000** adresini ac: ana menu (Oyna / Ayarlar /
Oyundan Cik) ve **"En Yakin Tahmin"** oyunu gelir.

### Veri hacmi ve oyuncu havuzu

Veritabani iki asamada doldurulur: `npm run scrape` kurasyonlu 80 yildizi (hizli),
`npm run collect-ids` + `npm run scrape-bulk` ise **7000+** oyuncuyu (12 buyuk lig
guncel kadrolari + milli takimlar + ~180 efsane, Super Lig dahil) getirir.

Veritabaninda binlerce oyuncu olsa da cogu taninmadigi icin oyun rastgele secimi
varsayilan olarak **taninir havuzdan** yapar (zirve piyasa degeri >= 20M **veya**
mac sayisi >= 350; ikincisi eski/Turk efsanelerini de kapsar). Genisletmek icin:
`GET /api/game/random?pool=all` (tum 7000+), `?pool=stars` (en bilindik ~1200).
Isim-tahmini modunda `?difficulty=easy` en bilindik havuzu kullanir.

## Oyun: En Yakin Tahmin

Iki oyuncu ayni ekranda oynar. Ortaya rastgele bir futbolcu (isim + foto) gelir;
her iki oyuncu bes satirdaki degeri tahmin eder ve **en yakin tahmin o satiri
kazanir**. Satirlar: kariyer golu, piyasa degeri (milyon €), kariyer takim sayisi,
boy (cm) ve dogum yili. Skorlar turlar boyunca birikir. Bir alan veride bossa
(orn. bazi efsanelerin guncel piyasa degeri) o satir "veri yok" olur ve puanlanmaz.

Arayuz `public/` altinda saf HTML/CSS/JS'tir ve Express tarafindan ayni origin'den
sunulur; bu yuzden `localhost` API'sine sorunsuz erisir. Ayarlar (oyuncu adlari,
puan sifirlama) tarayicida `localStorage`'da tutulur.

### Oyun modları

- **En Yakın Tahmin — Aynı Ekranda:** İki oyuncu tek cihazda, sırayla değer tahmin eder.
- **En Yakın Tahmin — Online:** Herkes kendi cihazından (aşağıda).
- **Kariyer Kıyası:** Ortada bir oyuncu gösterilir; iki taraf BAŞKA futbolcular
  yazar ve o futbolcunun aynı satırdaki değeri (kariyer golü, milli gol, piyasa
  değeri, boy, doğum yılı) ortadakine en yakın olan satırı kazanır. İsim yazarken
  otomatik tamamlama çıkar (bellek içi indeks; aksan/Türkçe harf farkını yok
  sayar, ünlü oyuncuları öne alır, öneride ülke·mevki·kulüp gösterir). Oyuncu
  adları varsayılan "Oyuncu 1 / Oyuncu 2", Ayarlar'dan değiştirilebilir.
- **Milli Kadro:** Rastgele bir ülke bayrağı çıkar; iki taraf o ülkenin senior
  milli takımında oynamış futbolcularla kadro kurar (1 KL, 2 DEF, 2 ORT, 1 FOR).
  Otomatik tamamlama sadece o ülkenin ve boş mevkinin oyuncularını gösterir (en
  çok maça çıkanlar önce). Her oyuncunun milli maç sayısı altında görünür; her
  tur yeni bir ülke gelir, kadro dolunca en yüksek toplam milli maça ulaşan kazanır.

Online oynanış detayı:

- **Online — Arkadaşınla:** Herkes kendi cihazından oynar. Biri **Oda Kur** der,
  4 haneli bir kod alır; arkadaşı **Odaya Katıl** ile kodu girer. Sunucu
  futbolcuyu seçer, iki ekranı Socket.IO ile senkronlar; her oyuncu yalnızca
  kendi tarafını doldurur, ikisi de gönderince satır açılır ve en yakın kazanır.
  Doğru cevaplar sunucuda tutulur (istemciye sızmaz), kazananı sunucu hesaplar.

Online motorun uçtan uca testi: `npm run test:online` (sunucu ayakta olmalı).

## Online yayın (deploy)

Oyun tek servis olarak çalışır (Express + Socket.IO aynı port, statik arayüz de
aynı origin'den). Ücretsiz **Render.com** ile:

1. **MongoDB Atlas ağ erişimi:** Atlas → *Network Access* → *Add IP Address* →
   **`0.0.0.0/0`** (her yerden) ekle. Bulut sunucusunun IP'si sabit olmadığı için
   bu şart; yoksa deploy edilen sunucu veritabanına bağlanamaz.
2. Projeyi bir **GitHub** deposuna gönder (`git init && git add . && git commit`,
   sonra GitHub'a push). `.env` gönderilmez (`.gitignore`'da).
3. **render.com** → *New* → *Blueprint* → repoyu seç. `render.yaml` ayarları
   otomatik okunur.
4. Render panelinde **`MONGODB_URI`** ortam değişkenini gir (Atlas bağlantı
   dizen). `DB_NAME` ve `TM_LOCALE` zaten `render.yaml`'da tanımlı.
5. Deploy bitince Render sana `https://guessfootball-xxxx.onrender.com` gibi bir
   adres verir. Bu linki arkadaşınla paylaş; ikiniz de açıp oda kodu ile oynarsınız.

> Not: Odalar sunucu belleğinde tutulur; ücretsiz Render tek örnek (instance)
> çalıştırdığı için bu yeterlidir. Ücretsiz plan bir süre trafik olmayınca uykuya
> geçer, ilk açılış birkaç saniye sürebilir.

Alternatif (hızlı, deploy'suz): sunucuyu kendi bilgisayarında `npm start` ile
çalıştırıp bir tünel aç (`cloudflared tunnel --url http://localhost:3000` ya da
`ngrok http 3000`), çıkan public linki arkadaşına ver. Sadece senin bilgisayarın
ve sunucu açıkken oynanır.

## Komutlar

| Komut | Aciklama |
|---|---|
| `npm run scrape` | Kurasyonlu 80 yildizi cekip DB'ye yazar (kucuk/hizli set) |
| `npm run scrape -- --dry-run` | DB'ye yazmaz, `data/players.json` + `data/teams.json` uretir |
| `npm run collect-ids` | Genis ID listesi toplar (ligler + milli takimlar + efsaneler) -> `data/ids.json` |
| `npm run scrape-bulk` | `data/ids.json`'daki herkesi ceker (7000+); **resumable**, `data/*.json`'a yazar |
| `npm run scrape-bulk -- --limit=50` | Ilk 50 (duman testi) · `--full` transfer+piyasa gecmisi de · `--to-db` dogrudan DB |
| `npm run seed` | `data/*.json` dosyalarini DB'ye yukler (kariyeri bos olanlari atlar) |
| `npm start` / `npm run dev` | API sunucusu + oyun arayuzu + online (Socket.IO) |
| `npm test` | Bellek ici MongoDB ile uctan uca API testi (Atlas gerekmez) |
| `npm run test:online` | Online oda motorunun socket testi (sunucu ayakta olmali) |

## API

### `GET /api/players/random`

Oyun icin rastgele bir oyuncunun **kimligi gizlenmis** kariyer verisi.
`name`, `shortName`, `fullName`, `portraitUrl` ve `relativeUrl` yanitta yer almaz.

`?difficulty=easy|normal|hard`
- `easy` — en az 300 maci olan taninmis oyuncular, son kulup ipucu acik
- `hard` — mevcut kulup, forma numarasi, piyasa degeri ve sezon dokumu de gizlenir

```jsonc
{
  "difficulty": "normal",
  "player": {
    "id": 28003,
    "position": { "name": "Sağ Kanat", "category": "Forvet" },
    "nationalities": ["Arjantin", "İspanya"],
    "age": 39, "heightCm": 170, "foot": "Sol ayak",
    "careerTotals": { "clubs": 4, "games": 991, "goals": 811, "assists": 397 },
    "careerByClub": [
      { "clubId": "131", "name": "FC Barcelona", "crestUrl": "https://...",
        "games": 778, "goals": 672, "assists": 303, "seasons": 17,
        "firstDate": "2004-10-16...", "lastDate": "2021-05-16..." }
    ],
    "hints": ["Uyruk: Arjantin, İspanya", "Mevki: Sağ Kanat", "Dogum yili: 1987"]
  }
}
```

### `GET /api/players/check?id=...&guess=...`

Tahmini dogrular. Dogruysa oyuncunun kimligi acilir, yanlissa **sizdirilmaz**.

```jsonc
{ "correct": true, "guess": "mesi", "normalizedGuess": "mesi", "distance": 1,
  "player": { "id": 28003, "name": "Lionel Messi", "portraitUrl": "https://..." } }
```

Esnek eslestirme: buyuk/kucuk harf, Turkce karakter (`ş`, `ğ`, `ı`, `ö`, `ü`, `ç`),
aksan (`é`, `ć`, `ñ`), tek basina soyad (`van dijk`, `güler`) ve 1-2 harflik yazim
hatasi kabul edilir. Ancak tahmin **baska bir futbolcunun gercek ismiyse** yazim
hatasi sayilmaz — yani `kante` tahmini Harry Kane icin dogru kabul edilmez.

### `GET /api/teams`

Tum takimlar ve logolari. `?q=` isim aramasi, `?country=`, `?nationalTeam=true|false`,
`?limit=` & `?skip=` sayfalama.

### Digerleri

| Uc | Aciklama |
|---|---|
| `GET /api/players` | Otomatik tamamlama icin hafif isim listesi (`?q=`) |
| `GET /api/players/:id` | Tam oyuncu dokumani (cozum ekrani) |
| `GET /api/teams/:id` | Tek takim |
| `GET /api/game/random` | "En Yakin Tahmin" modu: kimligi acik oyuncu + `answers` (gol, piyasa degeri, takim sayisi, boy, dogum yili) |
| `GET /health` | Sunucu + veritabani durumu |

## Veri kaynagi hakkinda

Yaygin olarak paylasilan `ceapi/player/{id}/performance` ucu **artik calismiyor**
(404) ve performans sayfasi Svelte ile istemci tarafinda render edildigi icin
HTML kazima da sonuc vermiyor (sunucu HTML'inde tablo yok). Bu proje, sayfanin
kendi kullandigi guncel JSON katmanini kullanir:

| Uc | Ne verir |
|---|---|
| `tmapi.transfermarkt.technology/player/{id}/performance-game` | Tum kariyerin mac mac performansi |
| `tmapi.transfermarkt.technology/players?ids[]=` | Profil, portre, dogum, boy, ayak, mevki |
| `tmapi.transfermarkt.technology/clubs?ids[]=` | Kulup adi, logo, ulke, renkler |
| `tmapi.transfermarkt.technology/competitions?ids[]=` | Musabaka adi ve logosu |
| `tmapi.transfermarkt.technology/attributes` | Ulke / mevki sozlugu (surec basina bir kez) |
| `transfermarkt.com.tr/ceapi/transferHistory/list/{id}` | Transfer gecmisi ve bonservisler |
| `transfermarkt.com.tr/ceapi/marketValueDevelopment/graph/{id}` | Piyasa degeri gecmisi |

`ids[]=` dizi formati zorunludur; virgullu duz liste `400` dondurur.

Kariyer istatistikleri mac mac veriden toplanir ve yalnizca
`participationState === "played"` olan maclar sayilir. Dogrulama: Messi'nin
Barcelona satiri 778 mac / 672 gol / 303 asist cikar.

### Nazik kullanim

Betik her istek arasinda `.env` ile ayarlanan **1.5-2 sn** rastgele bekleme uygular,
gercekci `User-Agent` havuzundan rastgele secim yapar ve 429/5xx durumunda ustel
geri cekilme ile en fazla 3 kez dener. Bu degerleri dusurmemek gerekir.

> Bu proje Transfermarkt GmbH & Co. KG ile iliskili degildir. Resmi olmayan uclar
> haber verilmeden degisebilir; egitim amacli kullanim icindir.

## Oyuncu listesi

`src/data/playerIds.js` icindeki 80 futbolcunun tamami toplu sorguyla dogrulandi.
Scraper her calismada API'den donen ismi listedeki isimle karsilastirir; Transfermarkt
bir ID'yi baska bir oyuncuya tasirsa ozet raporunda uyari olarak gorunur.

## Proje yapisi

```
src/
  config.js                 .env okuma ve dogrulama
  db.js                     MongoClient singleton + indeksler
  scraper.js                Veri toplama orkestrasyonu
  seed.js                   JSON -> MongoDB yukleyici
  server.js                 Express + HTTP + Socket.IO baglama
  realtime.js               Socket.IO oda motoru (online mod)
  collectIds.js             Genis ID toplama (lig/milli/efsane)
  scrapeBulk.js             Resumable toplu veri cekimi
  data/playerIds.js         80 dogrulanmis Transfermarkt ID'si (kurasyonlu set)
  data/sources.js           Ligler, milli takimlar, efsane isimleri
  transfermarkt/
    endpoints.js            Uc tanimlari
    client.js               Gecikmeli/yeniden denemeli HTTP istemcisi
    transform.js            Ham JSON -> temiz dokuman (saf fonksiyonlar)
  game/matcher.js           Isim tahmini normalizasyonu ve eslestirme
  game/rows.js              Oyun satirlari (sunucu otorite kaynagi)
  game/roundData.js         Rastgele oyuncu + dogru degerler
  routes/                   players.js, teams.js, game.js
public/                     Oyun arayuzu (index.html, style.css, app.js)
render.yaml                 Render.com deploy blueprint'i
test/api.test.js            Uctan uca REST + statik testi
test/realtime.test.js       Online oda motoru socket testi
```
