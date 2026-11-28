-- Admin der App (Julius, 28.11.2026): darf wie die Teamcaptains die
-- Liga-Daten auf Knopfdruck von der Ligaleitung holen (POST
-- /api/liga/aktualisieren, Knopf an der Liga-Tabelle). Gesetzt wie der
-- Kassenwart in 011.
ALTER TABLE users ADD COLUMN admin INTEGER NOT NULL DEFAULT 0;
UPDATE users SET admin = 1 WHERE email = 'julius.klinzer@outlook.de';
