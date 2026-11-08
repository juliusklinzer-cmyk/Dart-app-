/*
 * Alle Suiten nacheinander, Abbruch beim ersten Fehler.
 *
 *   node tests/alle.mjs          (npm run test:alle; deploy/deploy.sh ruft es auf)
 *
 * Reihenfolge: erst die schnellen Node-Suiten (Engine, Liga, Mail,
 * Mitteilungen), dann der Browser gegen index.html, dann das Buendel bauen
 * und dieselben Browser-Tests gegen dart-turnier.html, zuletzt Server-API
 * und Konto (zwei Geraete, dauert am laengsten). Das Buendel wird hier
 * gebaut, damit die Einzeldatei nie ungeprueft bleibt -- genau das war die
 * Luecke des Audits vom 08.11.2026 (T-H2).
 *
 * Kein npm, kein cross-env: jede Suite startet als eigener Node-Prozess mit
 * derselben Laufzeit (process.execPath), die Umgebung wird je Schritt
 * ergaenzt. So laeuft es auf Windows, in WSL und im Deploy gleich.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const SCHRITTE = [
  { name: 'Checkout-Engine', skript: 'tests/checkout-engine.mjs' },
  { name: 'Liga-Daten', skript: 'tests/liga-daten.mjs' },
  { name: 'Mail', skript: 'tests/mail.mjs' },
  { name: 'Mitteilungen', skript: 'tests/mitteilungen.mjs' },
  { name: 'Browser: index.html', skript: 'tests/e2e.mjs' },
  { name: 'Einzeldatei bauen', skript: 'build-single.mjs' },
  { name: 'Browser: dart-turnier.html', skript: 'tests/e2e.mjs', env: { TARGET: 'dart-turnier.html' } },
  { name: 'Server-API', skript: 'tests/api.mjs' },
  { name: 'Konto: zwei Geraete', skript: 'tests/konto.mjs' }
];

const start = Date.now();
for (const [i, s] of SCHRITTE.entries()) {
  console.log(`\n══ ${i + 1}/${SCHRITTE.length} ${s.name} (${s.skript}) ══`);
  const t = Date.now();
  const erg = spawnSync(process.execPath, [path.join(ROOT, s.skript)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...(s.env || {}) }
  });
  const dauer = Math.round((Date.now() - t) / 1000);
  if (erg.error) {
    console.error(`\nFEHLER: ${s.name} liess sich nicht starten: ${erg.error.message}`);
    process.exit(1);
  }
  if (erg.status !== 0) {
    console.error(`\nFEHLER: ${s.name} ist nach ${dauer} s rot (Exit ${erg.status ?? erg.signal}). Abbruch.`);
    process.exit(erg.status || 1);
  }
  console.log(`── ${s.name}: gruen nach ${dauer} s ──`);
}
console.log(`\nAlle ${SCHRITTE.length} Suiten gruen, ${Math.round((Date.now() - start) / 1000)} s insgesamt.`);
