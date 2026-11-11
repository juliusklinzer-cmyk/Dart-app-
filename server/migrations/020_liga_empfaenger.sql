-- Feste Empfaenger des Spielberichts (beide Teamcaptains, Ligaleitung) und
-- die Adressen der gegnerischen Teamcaptains, je Team - einmal eingetippt,
-- stehen sie beim naechsten Spiel gegen dasselbe Team schon im Dialog
-- (Julius, 11.11.2026). Schluessel: 'fest' (JSON-Liste mit drei Adressen)
-- und 'gegner:<Teamname>' (eine Adresse).
CREATE TABLE IF NOT EXISTS liga_empfaenger (
  schluessel  TEXT PRIMARY KEY,
  wert        TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);
