# Handoff: Blink 180 Rebranding der Dart-App

## Overview
Rebranding der bestehenden Dart-Turnier-App (Repo: `juliusklinzer-cmyk/Dart-app-`, Branch `claude/darts-tournament-app-i87r85`) auf den "BLINK 180"-Look: schwarz/rot/weiß, Punk-Poster-Typografie, dazu ein blauer Lichtschein wie das Bar-Licht der Location.

## About the Design Files
`Blink 180 Redesign v2.dc.html` ist eine **Design-Referenz in HTML** — ein Mockup der vier Haupt-Screens (Setup, Spiel, Turnier, Rangliste) im Tablet-Querformat. Sie ist NICHT zum direkten Übernehmen gedacht. Die Aufgabe ist, den Look in der echten App umzusetzen — die App ist reines HTML/CSS/JS, das Styling liegt zentral in `css/styles.css`. Die Struktur der App (index.html, js/app.js) bleibt unverändert; es ändern sich nur CSS-Werte, Fonts und das Icon/Logo.

## Fidelity
**High-fidelity**: Farben, Fonts und Effekte sind final und sollen exakt übernommen werden. Layout/Struktur der App bleibt wie sie ist.

## Umsetzung in css/styles.css

### 1. Farbvariablen (`:root`)
Die App ist bewusst über wenige Variablen theming-fähig (siehe Kommentar im CSS). Neue Werte:

```css
:root {
  --accent: #e5484d;
  --accent-dark: #8f2c30;
  --accent-soft: rgba(229, 72, 77, 0.16);
  --accent-faint: rgba(229, 72, 77, 0.09);
  --on-accent: #ffffff;

  --bg: #0d0a0b;      /* warmes Schwarz statt Blaugrau */
  --bg-2: #141011;
  --bg-3: #171213;
  --line: #241c1e;
  --text: #f2eeee;
  --muted: #9a8f90;
  --dead: #6f6465;
  --dead-bg: #120e0f;
}
```

**Wichtig — Rot sparsam einsetzen.** Im Design v2 sind aktive/selektierte Zustände WEISS, nicht rot. Ergänzend zu den Variablen:
- Aktive Borders (`.pcard.active`, `.roster-item.selected`, `.modes button.active`, `.options button.active`, `.match-row.next`, `.nav button.active`): `border-color: #f2eeee` statt `var(--accent)`; Hintergrund `#1a1516` bzw. `rgba(242,238,238,0.04)`.
- Primär-Buttons (`.btn.primary`, `.keypad button.ok`, aktive Segmente/Chips): `background: #f2eeee; color: #0d0a0b`.
- Rot bleibt für: Finish-Chip `.checkout-bar .chip.first` (background `#e5484d`, weißer Text), Siege-Spalte `.standings .wins`, Rekordwerte, `.match-row .go`, Score-Eingabe-Anzeige, 100+/Checkout-Hervorhebungen.

### 2. Blauer Schein (Bar-Licht)
Akzentlicht in Blau, Wert `rgba(70, 170, 215, …)`:
- `body`-Hintergrund: `radial-gradient(1000px 560px at 72% -5%, rgba(64,150,195,0.16), transparent 62%), radial-gradient(800px 500px at 15% 105%, rgba(64,150,195,0.08), transparent 60%), var(--bg)`
- `.pcard.active`: `box-shadow: 0 0 36px rgba(70,170,215,0.28)`
- `.btn.primary`: `box-shadow: 0 0 30px rgba(70,170,215,0.22)`
- Logo im Header (neu, s.u.): `box-shadow: 0 0 20px rgba(70,170,215,0.35)`

### 3. Typografie
Google Fonts in `index.html` einbinden (oder als Dateien lokal ablegen, damit die App offline bleibt — bevorzugt, da PWA):
- **Anton** — Überschriften/Titel: `h1`, Card-Überschriften `h2`, Primär-Buttons. Immer mit `text-transform: uppercase; letter-spacing: 0.05em–0.08em`.
- **Barlow Condensed** (600/700/800) — alle großen Zahlen: `.pcard .rest`, `.score-display`, Keypad-Tasten, `.checkout-bar .chip`, Ergebnis-Zahlen, `.rec .rv`. Weiterhin `font-variant-numeric: tabular-nums`.
- **Barlow** (400–700) — Fließtext/UI statt System-Font-Stack.

```css
h2 { font-family: 'Anton', sans-serif; letter-spacing: 0.08em; color: var(--text); }
h1 { font-family: 'Anton', sans-serif; letter-spacing: 0.05em; text-transform: uppercase; }
```

### 4. Logo & Branding
- `logo.jpeg` (in diesem Paket) als App-Logo: rund beschnitten (`border-radius: 50%`), Rahmen `2px solid #241c1e`, blauer Glow (s.o.).
- In den App-Header von Setup/Turnier/Rangliste links neben den Titel setzen (46–52 px).
- Titelzeile Setup: „BLINK **180**" (180 in `#e5484d`), darunter „DART TURNIER · EST. 2026" in 12px, `letter-spacing: 0.22em`, uppercase, `var(--muted)`.
- `icon.svg` durch eine Version aus dem Logo ersetzen; `theme-color` in `index.html` auf `#0d0a0b`.

## Screens
Alle vier Screens im Mockup entsprechen 1:1 den bestehenden Screens `screen-setup`, `screen-game`, `screen-tournament`, `screen-boards` — Layout unverändert, nur Umfärbung nach obigen Regeln.

## Design Tokens (Zusammenfassung)
- Schwarz: `#0a0708` (Seite), `#0d0a0b` (bg), `#141011` (Cards), `#171213` (Flächen), `#1a1516` (aktiv)
- Linien: `#241c1e`, `#2b2224`
- Text: `#f2eeee`, gedämpft `#9a8f90`, tot `#6f6465`
- Rot: `#e5484d` (Akzent), dunkel `#8f2c30`
- Blau-Glow: `rgba(70,170,215,0.22–0.35)`, Lichtquelle `rgba(64,150,195,0.08–0.16)`
- Radius: Cards 16px, Buttons 10–14px; Tap-Ziele ≥ 44px (Tablet 60px) beibehalten

## Assets
- `logo.jpeg` — BLINK-180-Logo (vom Nutzer)

## Files
- `Blink 180 Redesign v2.dc.html` — das Mockup (im Browser öffnen; Tabs oben wechseln die Screens)
- `logo.jpeg`
