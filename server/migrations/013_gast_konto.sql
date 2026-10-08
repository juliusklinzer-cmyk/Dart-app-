-- Gast mit eigenem Konto (eigener Einladungscode, DARTS_GAST_INVITE_HASH):
-- auf allen Geraeten sichtbar, eigene Statistik, Training ja - aber kein
-- Ligaspieler (keine Spieltags-Zusage, kein Ligaspiel anlegen).
ALTER TABLE users ADD COLUMN gast_konto INTEGER NOT NULL DEFAULT 0;
