-- Die Vereinskasse: ein simples Kassenbuch. Positive Betraege sind
-- Einzahlungen, negative Ausgaben; der Bestand ist die Summe.
CREATE TABLE kasse (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id),
  betrag     INTEGER NOT NULL,               -- in Cent
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
