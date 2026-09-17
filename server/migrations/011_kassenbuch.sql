-- Das Kassenbuch des Vereins, wie die Excel-Vorlage der Kassenwartin:
-- Nr, Datum, Beschreibung, Kategorie, Einnahme/Ausgabe, laufender Saldo,
-- dazu Kassenjahr und Anfangsbestand. Buchen darf nur, wer Kassenwart ist.
ALTER TABLE kasse ADD COLUMN datum TEXT;                       -- YYYY-MM-DD, Buchungsdatum
ALTER TABLE kasse ADD COLUMN kategorie TEXT;
ALTER TABLE kasse ADD COLUMN mitglied TEXT REFERENCES users(id); -- bei Mitgliedsbeitraegen: wer gezahlt hat
ALTER TABLE users ADD COLUMN kassenwart INTEGER NOT NULL DEFAULT 0;

-- Bisherige Buchungen einsortieren: Datum aus dem Zeitstempel, Kategorie
-- nach Text geraten, Beitraege dem Buchenden zugeordnet (er hat fuer sich gebucht).
UPDATE kasse SET datum = substr(created_at, 1, 10) WHERE datum IS NULL;
UPDATE kasse SET kategorie = CASE
    WHEN betrag > 0 AND (lower(text) LIKE '%beitrag%' OR lower(text) LIKE '%beteil%') THEN 'Mitgliedsbeiträge'
    WHEN betrag > 0 THEN 'Sonstige Einnahmen'
    WHEN lower(text) LIKE '%equipment%' OR lower(text) LIKE '%ausr%' OR lower(text) LIKE '%pfeil%' OR lower(text) LIKE '%flight%' THEN 'Ausrüstung/Dartpfeile'
    ELSE 'Sonstige Ausgaben' END
 WHERE kategorie IS NULL;
UPDATE kasse SET mitglied = user_id WHERE kategorie = 'Mitgliedsbeiträge' AND mitglied IS NULL;

UPDATE users SET kassenwart = 1 WHERE email IN ('lenasbecker48@googlemail.com', 'julius.klinzer@outlook.de');

CREATE TABLE kasse_konfig (
  name TEXT PRIMARY KEY,
  wert TEXT NOT NULL
);
INSERT INTO kasse_konfig (name, wert) VALUES
  ('jahr', '2026'),
  ('anfangsbestand', '0'),
  ('beitrag', '5000'),
  ('paypal', 'https://www.paypal.com/pool/9sImGshd7Z?sr=ancr');
