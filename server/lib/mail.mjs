/*
 * Mailversand ueber Brevo (SMTP-Relay mit STARTTLS) - ohne eine einzige
 * Abhaengigkeit, nur node:net und node:tls. Das Image bleibt damit so
 * schlank wie bisher (siehe deploy/Dockerfile).
 *
 * Zwei Absender, je nach Anlass (deploy/env.example):
 *   liga  Blink 180 <blink180@wirtschaftln.de>  Spielberichte, Erinnerungen
 *   app   Dart-App  <dart@wirtschaftln.de>      alles Allgemeine
 * Die Domain wirtschaftln.de ist bei Brevo authentifiziert (SPF/DKIM), die
 * Postfaecher liegen bei Microsoft - Antworten landen also dort.
 *
 * Ohne BREVO_SMTP_USER/KEY ist der Mailer nicht "bereit": er verwirft
 * jede Mail mit einer Logzeile, die API meldet 503. Nichts anderes haengt
 * daran - die App laeuft wie vorher.
 */
import net from 'node:net';
import tls from 'node:tls';
import { randomBytes } from 'node:crypto';

export const BREVO_HOST = 'smtp-relay.brevo.com';
export const BREVO_PORT = 587;

/* ---------- Adressen und Kopfzeilen ---------- */

function kopfWert(s) { return String(s || '').replace(/[\r\n]+/g, ' ').trim(); }

/* Umlaute im Betreff oder Anzeigenamen: RFC 2047 (Base64). */
export function kodiereKopf(s) {
  s = kopfWert(s);
  return /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=';
}

/* "Blink 180 <blink180@wirtschaftln.de>" oder nackte Adresse -> { name, adresse } */
export function adresse(roh) {
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(String(roh || ''));
  if (m) return { name: (m[1] || '').trim(), adresse: m[2].trim().toLowerCase() };
  return { name: '', adresse: String(roh || '').trim().toLowerCase() };
}
export function istAdresse(a) { return /^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]+$/.test(String(a || '')); }
function kopfAdresse(roh) {
  const a = adresse(roh);
  return a.name ? kodiereKopf(a.name) + ' <' + a.adresse + '>' : a.adresse;
}
function zeilen76(b64) { return b64.replace(/.{76}/g, '$&\r\n'); }
function dateiName(n) {
  const s = String(n || 'Anhang').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
  return s || 'Anhang';
}

/* ---------- HTML-Brief im Look der App ---------- */

/*
 * Jede Mail geht als Text UND als HTML raus (multipart/alternative): der
 * Text ist die Wahrheit und reicht jedem Leser, das HTML legt die Farben
 * der App darueber - schwarze Karte, roter Balken, Logo mit Wortmarke,
 * heller Knopf. Nichts wird doppelt gepflegt: textZuHtml() baut das HTML
 * aus dem Text. Regeln: Leerzeile = Absatz; ein Absatz, dessen erste
 * Zeile mit ":" endet, wird zum Block mit Ueberschrift und einer Zeile je
 * Eintrag; zwei Leerzeichen in so einer Zeile trennen links (Name) von
 * rechts (Ergebnis, fett). Links werden anklickbar.
 */
export const FARBEN = { bg: '#0d0a0b', karte: '#141011', flaeche: '#171213', linie: '#241c1e', text: '#f2eeee', muted: '#9a8f90', akzent: '#e5484d', primaer: '#f2eeee', aufPrimaer: '#0d0a0b' };
const SCHRIFT = "'Barlow Condensed', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const TITELSCHRIFT = "'Anton', 'Arial Black', 'Segoe UI', Helvetica, Arial, sans-serif";

export function escapeHtml(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}
/* Auf schon escapetem Text: https-Adressen anklickbar machen (Satzzeichen am Ende bleiben draussen). */
function verlinke(esc) {
  return esc.replace(/https?:\/\/[^\s<]+?(?=[.,;:)!?]*(?:\s|$))/g, function (url) {
    return '<a href="' + url + '" style="color:' + FARBEN.text + ';text-decoration:underline;text-decoration-color:' + FARBEN.akzent + ';">' + url.replace(/^https?:\/\//, '') + '</a>';
  });
}
export function textZuHtml(text) {
  const absaetze = String(text || '').replace(/\r\n/g, '\n').trim().split(/\n{2,}/);
  const zelle = 'padding:9px 14px;border-top:1px solid ' + FARBEN.linie + ';font-family:' + SCHRIFT + ';font-size:16px;line-height:1.35;color:' + FARBEN.text + ';';
  return absaetze.map(function (a) {
    const zeilen = a.split('\n');
    if (zeilen.length > 1 && /:$/.test(zeilen[0].trim())) {
      const reihen = zeilen.slice(1).map(function (z, i) {
        const t = i === 0 ? zelle.replace('border-top:1px solid ' + FARBEN.linie + ';', '') : zelle;
        const m = /^(.*\S)\s{2,}(\S.*)$/.exec(z);
        if (m) return '<tr><td style="' + t + '">' + verlinke(escapeHtml(m[1])) + '</td><td align="right" style="' + t + 'white-space:nowrap;font-weight:700;padding-left:8px;">' + escapeHtml(m[2]) + '</td></tr>';
        return '<tr><td colspan="2" style="' + t + '">' + verlinke(escapeHtml(z)) + '</td></tr>';
      });
      return '<p style="margin:18px 0 8px;font-family:' + SCHRIFT + ';font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:' + FARBEN.muted + ';">' + escapeHtml(zeilen[0].trim().replace(/:$/, '')) + '</p>' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ' + FARBEN.linie + ';border-radius:12px;background:' + FARBEN.bg + ';border-collapse:separate;margin:0 0 16px;">' + reihen.join('') + '</table>';
    }
    return '<p style="margin:0 0 16px;font-family:' + SCHRIFT + ';font-size:17px;line-height:1.5;color:' + FARBEN.text + ';">' + zeilen.map(function (z) { return verlinke(escapeHtml(z)); }).join('<br>') + '</p>';
  }).join('');
}

/* b: { titel, kicker, text, knopf: { text, url } | null, vorschau, logoUrl, fuss } */
export function htmlBrief(b) {
  const logo = b.logoUrl ? '<img src="' + escapeHtml(b.logoUrl) + '" width="48" height="48" alt="" style="display:block;width:48px;height:48px;border-radius:50%;border:0;">' : '';
  const knopf = b.knopf && b.knopf.url ?
    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 8px;"><tr><td style="border-radius:999px;background:' + FARBEN.primaer + ';">' +
    '<a href="' + escapeHtml(b.knopf.url) + '" style="display:inline-block;padding:13px 24px;font-family:' + SCHRIFT + ';font-size:16px;font-weight:700;letter-spacing:.02em;color:' + FARBEN.aufPrimaer + ';text-decoration:none;border-radius:999px;">' + escapeHtml(b.knopf.text || 'Zur Dart-App') + ' &rarr;</a></td></tr></table>' : '';
  const fuss = b.fuss == null ? 'Diese Mail kommt aus der Dart-App von Blink 180. Welche Mitteilungen du bekommst, stellst du in der App ein: Profil &rarr; Konto &rarr; Benachrichtigungen.' : escapeHtml(b.fuss);
  return '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">' +
    '<link href="https://fonts.googleapis.com/css2?family=Anton&family=Barlow+Condensed:wght@500;700&display=swap" rel="stylesheet">' +
    '<title>' + escapeHtml(b.titel) + '</title></head>' +
    '<body style="margin:0;padding:0;background:' + FARBEN.bg + ';">' +
    (b.vorschau ? '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:' + FARBEN.bg + ';">' + escapeHtml(b.vorschau) + '</div>' : '') +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + FARBEN.bg + ';"><tr><td align="center" style="padding:24px 12px 32px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">' +
    '<tr><td style="padding:0 6px 14px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>' +
    (logo ? '<td width="48" valign="middle">' + logo + '</td>' : '') +
    '<td valign="middle" style="padding-left:' + (logo ? 12 : 0) + 'px;font-family:' + TITELSCHRIFT + ';font-size:18px;line-height:1.1;letter-spacing:.08em;text-transform:uppercase;color:' + FARBEN.text + ';">Blink <span style="color:' + FARBEN.akzent + ';">180</span>' +
    '<br><span style="font-family:' + SCHRIFT + ';font-size:12px;font-weight:700;letter-spacing:.14em;color:' + FARBEN.muted + ';">Dart-App</span></td></tr></table></td></tr>' +
    '<tr><td style="background:' + FARBEN.karte + ';border:1px solid ' + FARBEN.linie + ';border-radius:18px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    '<tr><td style="height:4px;background:' + FARBEN.akzent + ';border-radius:18px 18px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>' +
    '<tr><td style="padding:24px 24px 14px;">' +
    (b.kicker ? '<p style="margin:0 0 8px;font-family:' + SCHRIFT + ';font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:' + FARBEN.akzent + ';">' + escapeHtml(b.kicker) + '</p>' : '') +
    '<h1 style="margin:0 0 18px;font-family:' + TITELSCHRIFT + ';font-size:26px;line-height:1.15;font-weight:400;letter-spacing:.01em;color:' + FARBEN.text + ';">' + escapeHtml(b.titel) + '</h1>' +
    textZuHtml(b.text) + knopf +
    '</td></tr></table></td></tr>' +
    '<tr><td style="padding:16px 10px 0;font-family:' + SCHRIFT + ';font-size:13px;line-height:1.5;color:' + FARBEN.muted + ';">' + fuss + '</td></tr>' +
    '</table></td></tr></table></body></html>';
}

/* ---------- MIME ---------- */

/* Immer multipart/mixed: Text (UTF-8, Base64) - bei m.html als
   multipart/alternative zusammen mit dem HTML - plus Anhaenge. */
export function mimeBauen(m) {
  const grenze = '=_blink180_' + Date.now().toString(36) + '_' + randomBytes(6).toString('hex');
  const von = adresse(m.von);
  const kopf = [
    'From: ' + kopfAdresse(m.von),
    'To: ' + m.an.map(kopfAdresse).join(', ')
  ];
  if (m.cc && m.cc.length) kopf.push('Cc: ' + m.cc.map(kopfAdresse).join(', '));
  if (m.antwortAn) kopf.push('Reply-To: ' + kopfAdresse(m.antwortAn));
  kopf.push(
    'Subject: ' + kodiereKopf(m.betreff),
    'Date: ' + new Date(m.zeit || Date.now()).toUTCString(),
    'Message-ID: <' + (m.id || randomBytes(8).toString('hex')) + '@' + (von.adresse.split('@')[1] || 'localhost') + '>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="' + grenze + '"'
  );
  const textTeil = 'Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
    zeilen76(Buffer.from(String(m.text || ''), 'utf8').toString('base64'));
  let koerper = textTeil;
  if (m.html) {
    const g2 = '=_alt_' + randomBytes(8).toString('hex');
    koerper = 'Content-Type: multipart/alternative; boundary="' + g2 + '"\r\n\r\n' +
      '--' + g2 + '\r\n' + textTeil + '\r\n' +
      '--' + g2 + '\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
      zeilen76(Buffer.from(String(m.html), 'utf8').toString('base64')) + '\r\n' +
      '--' + g2 + '--';
  }
  const teile = [koerper];
  (m.anhaenge || []).forEach(function (a) {
    const name = dateiName(a.name);
    teile.push(
      'Content-Type: ' + (a.typ || 'application/octet-stream') + '; name="' + name + '"\r\n' +
      'Content-Transfer-Encoding: base64\r\n' +
      'Content-Disposition: attachment; filename="' + name + '"\r\n\r\n' +
      zeilen76(Buffer.from(a.inhalt).toString('base64'))
    );
  });
  return kopf.join('\r\n') + '\r\n\r\n' +
    teile.map(function (t) { return '--' + grenze + '\r\n' + t + '\r\n'; }).join('') +
    '--' + grenze + '--\r\n';
}

/* ---------- SMTP ---------- */

/*
 * Ein kompletter SMTP-Dialog: EHLO, STARTTLS (Pflicht, ausser starttls:
 * false fuer den Test gegen einen eigenen Server auf localhost), AUTH LOGIN,
 * MAIL FROM, RCPT TO, DATA, QUIT. Antworten koennen mehrzeilig sein
 * ("250-..." bis "250 ..."). Liefert die Antwort auf DATA (Brevo nennt dort
 * die Message-Kennung).
 */
export function smtpSenden(opt) {
  return new Promise(function (resolve, reject) {
    let sock = net.connect({ host: opt.host, port: opt.port });
    let puffer = '';
    let warten = null;
    let fertig = false;
    const timer = setTimeout(function () { ende(new Error('SMTP: Zeitueberschreitung (' + opt.host + ')')); }, opt.timeoutMs || 25000);
    function ende(err, wert) {
      if (fertig) return;
      fertig = true;
      clearTimeout(timer);
      try { sock.end(); } catch (e) { /* egal */ }
      if (err) reject(err); else resolve(wert);
    }
    function pruefe() {
      if (!warten) return;
      const zeilen = puffer.split('\r\n');
      for (let i = 0; i < zeilen.length - 1; i++) {
        if (/^\d{3}(?: |$)/.test(zeilen[i])) {
          const block = zeilen.slice(0, i + 1);
          puffer = zeilen.slice(i + 1).join('\r\n');
          const w = warten;
          warten = null;
          w.res({ code: Number(block[i].slice(0, 3)), zeilen: block });
          return;
        }
      }
    }
    function anhaengen(s) {
      s.on('data', function (d) { puffer += d.toString('utf8'); pruefe(); });
      s.on('error', function (e) { ende(e); });
      s.on('close', function () { if (!fertig) ende(new Error('SMTP: Verbindung vorzeitig beendet')); });
    }
    function antwort() {
      return new Promise(function (res, rej) { warten = { res: res, rej: rej }; pruefe(); });
    }
    async function befehl(text, erwartet, nenn) {
      sock.write(text + '\r\n');
      const a = await antwort();
      if (erwartet.indexOf(a.code) < 0) {
        throw new Error('SMTP ' + a.code + ' auf ' + (nenn || text.split(' ')[0]) + ': ' + a.zeilen.join(' ').slice(0, 300));
      }
      return a;
    }
    const helo = opt.name || 'darts.wirtschaftln.de';
    (async function () {
      anhaengen(sock);
      await new Promise(function (r, j) { sock.once('connect', r); sock.once('error', j); });
      const gruss = await antwort();
      if (gruss.code !== 220) throw new Error('SMTP: unerwarteter Gruss ' + gruss.zeilen.join(' '));
      let ehlo = await befehl('EHLO ' + helo, [250]);
      if (opt.starttls !== false) {
        if (!ehlo.zeilen.some(function (z) { return /STARTTLS/i.test(z); })) throw new Error('SMTP: Server bietet kein STARTTLS');
        await befehl('STARTTLS', [220]);
        sock.removeAllListeners('data'); sock.removeAllListeners('close'); sock.removeAllListeners('error');
        const roh = sock;
        sock = await new Promise(function (r, j) {
          const t = tls.connect({ socket: roh, servername: opt.host }, function () { r(t); });
          t.once('error', j);
        });
        puffer = '';
        anhaengen(sock);
        ehlo = await befehl('EHLO ' + helo, [250]);
      }
      if (opt.user) {
        await befehl('AUTH LOGIN', [334]);
        await befehl(Buffer.from(String(opt.user), 'utf8').toString('base64'), [334], 'AUTH (Benutzer)');
        await befehl(Buffer.from(String(opt.pass), 'utf8').toString('base64'), [235], 'AUTH (Schluessel)');
      }
      await befehl('MAIL FROM:<' + opt.von + '>', [250]);
      for (const an of opt.an) await befehl('RCPT TO:<' + an + '>', [250, 251]);
      await befehl('DATA', [354]);
      /* Zeilen, die mit einem Punkt beginnen, bekommen einen zweiten (Dot-Stuffing). */
      let daten = String(opt.daten).replace(/\r?\n/g, '\r\n').replace(/^\./mg, '..');
      if (!daten.endsWith('\r\n')) daten += '\r\n';
      sock.write(daten);
      const d = await befehl('.', [250], 'DATA-Ende');
      try { await befehl('QUIT', [221]); } catch (e) { /* schon gesendet */ }
      ende(null, { antwort: d.zeilen.join(' ') });
    })().catch(function (e) { ende(e); });
  });
}

/* ---------- Der Mailer der App ---------- */

export function erstelleMailer(cfg) {
  cfg = cfg || {};
  const bereit = !!(cfg.user && cfg.key);
  const absender = {
    liga: cfg.absenderLiga || 'Blink 180 <blink180@wirtschaftln.de>',
    app: cfg.absenderApp || 'Dart-App <dart@wirtschaftln.de>'
  };
  const appUrl = String(cfg.appUrl || 'https://darts.wirtschaftln.de').replace(/\/+$/, '');
  const logoUrl = cfg.logoUrl === undefined ? appUrl + '/icons/apple-touch-icon.png' : cfg.logoUrl;
  /* m: { von: 'liga'|'app', an: [], cc: [], antwortAn, betreff, text, anhaenge: [{ name, typ, inhalt }],
          titel (Ueberschrift, sonst Betreff), kicker, knopf: { text, url }, vorschau, fuss, html (fertig oder false = nur Text) } */
  async function sende(m) {
    const von = absender[m.von] || absender.app;
    const html = m.html === undefined ? htmlBrief({ titel: m.titel || m.betreff, kicker: m.kicker, text: m.text, knopf: m.knopf, vorschau: m.vorschau, fuss: m.fuss, logoUrl: logoUrl }) : m.html;
    const an = (m.an || []).map(function (a) { return adresse(a).adresse; }).filter(istAdresse);
    const cc = (m.cc || []).map(function (a) { return adresse(a).adresse; }).filter(istAdresse);
    if (!an.length) throw new Error('Mail ohne Empfaenger');
    const id = Date.now().toString(36) + '.' + randomBytes(6).toString('hex');
    const daten = mimeBauen({ von: von, an: m.an, cc: m.cc, antwortAn: m.antwortAn || von, betreff: m.betreff, text: m.text, html: html, anhaenge: m.anhaenge, id: id });
    if (!bereit) {
      console.log('[mail] nicht eingerichtet - verworfen: "' + kopfWert(m.betreff) + '" an ' + an.join(', '));
      return { gesendet: false, id: id };
    }
    const r = await smtpSenden({
      host: cfg.host || BREVO_HOST, port: cfg.port || BREVO_PORT, starttls: cfg.starttls !== false, name: cfg.heloName,
      user: cfg.user, pass: cfg.key, von: adresse(von).adresse, an: an.concat(cc), daten: daten
    });
    console.log('[mail] gesendet: "' + kopfWert(m.betreff) + '" an ' + an.join(', ') + ' (' + r.antwort.slice(0, 80) + ')');
    return { gesendet: true, id: id };
  }
  return { bereit: bereit, sende: sende, absender: absender };
}
