-- Liga-Tag (Game Day, DRT-080): die Vorbereitung eines Ligaspiels an zwei
-- iPads - Aufstellungen, Status je Spieler, Unterschriften der Nachmeldungen,
-- welches iPad an welcher Scheibe steht und wer bereit ist. Schluessel ist
-- Spieltag + Datum ('st06-2026-12-09'). `felder` ist ein JSON-Objekt
-- { schluessel: { v: wert, s: stand } }, `plaetze` { S1: {...}, S2: {...} }.
-- Ist das Spiel gestartet, steht in turnier_id das geteilte Turnier.
-- Zeilen werden nach wenigen Tagen geloescht (Namen der Gegner).
CREATE TABLE IF NOT EXISTS liga_tage (
  id          TEXT PRIMARY KEY,
  stand       INTEGER NOT NULL DEFAULT 0,
  felder      TEXT NOT NULL DEFAULT '{}',
  plaetze     TEXT NOT NULL DEFAULT '{}',
  turnier_id  TEXT,
  updated_at  TEXT NOT NULL
);
