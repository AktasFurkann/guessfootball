/**
 * Ek efsaneleri (src/data/moreLegends.js) isimden cozup Atlas'a ekler.
 * Isim cozumleme schnellsuche ile yapilir (yerelde calisir); veri tmapi ile
 * cekilir. DB'de zaten olan isimler atlanir.
 *
 * Kullanim: node src/addLegends.js
 */
import { connect, players, close } from './db.js';
import { requestText } from './transfermarkt/client.js';
import { ensurePlayer } from './game/ensurePlayer.js';
import { normalize } from './game/matcher.js';
import { MORE_LEGENDS } from './data/moreLegends.js';

const SITE = 'https://www.transfermarkt.com.tr';
const searchUrl = (q) => `${SITE}/schnellsuche/ergebnis/schnellsuche?query=${encodeURIComponent(q)}`;

async function resolveId(name) {
  const html = await requestText(searchUrl(name), { label: `ara ${name}` });
  const m = html.match(/profil\/spieler\/(\d+)/);
  return m ? Number(m[1]) : null;
}

async function main() {
  await connect();

  // DB'deki mevcut isimler (normalize) - hizli atlamak icin.
  const existing = new Set(
    (await players().find({}, { projection: { name: 1 } }).toArray()).map((p) => normalize(p.name)),
  );

  const names = [...new Set(MORE_LEGENDS)];
  let added = 0;
  let skipped = 0;
  let failed = 0;

  for (const [i, name] of names.entries()) {
    const tag = `[${i + 1}/${names.length}] ${name}`;
    if (existing.has(normalize(name))) {
      skipped += 1;
      continue;
    }
    try {
      const id = await resolveId(name);
      if (!id) {
        failed += 1;
        console.warn(`${tag} - bulunamadı`);
        continue;
      }
      const doc = await ensurePlayer(id);
      if (doc) {
        added += 1;
        existing.add(normalize(doc.name));
        console.log(`${tag} -> ${doc.name} (${doc.careerTotals?.goals ?? 0} gol) ✓`);
      } else {
        failed += 1;
        console.warn(`${tag} - kariyer verisi yok`);
      }
    } catch (e) {
      failed += 1;
      console.warn(`${tag} - hata: ${e.message}`);
    }
  }

  console.log(`\n=== EKLEME ÖZETİ ===`);
  console.log(`Eklendi: ${added} · Zaten vardı: ${skipped} · Başarısız: ${failed}`);
  console.log(`Toplam oyuncu: ${await players().countDocuments()}`);
  await close();
}

main().catch(async (e) => {
  console.error('[addLegends] Ölümcül:', e);
  await close().catch(() => {});
  process.exitCode = 1;
});
