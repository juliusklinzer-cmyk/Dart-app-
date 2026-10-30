-- Mitteilungen (Okt. 2026): je Thema und Konto ein Kanal (beide = Push und
-- Mail, push, aus; ohne Zeile gilt die Voreinstellung des Themas, siehe
-- server/lib/mitteilungen.mjs), die Push-Abos der Geraete und ein Log, das
-- jede Mitteilung je Konto nur einmal rausgehen laesst.
CREATE TABLE benachrichtigungen (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thema   TEXT NOT NULL,
  kanal   TEXT NOT NULL,
  PRIMARY KEY (user_id, thema)
);

CREATE TABLE push_abos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  geraet     TEXT,
  created_at TEXT NOT NULL,
  last_ok_at TEXT
);
CREATE INDEX push_abos_user ON push_abos(user_id);

CREATE TABLE mitteilung_log (
  schluessel TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sent_at    TEXT NOT NULL,
  PRIMARY KEY (schluessel, user_id)
);

-- Wer die Erinnerungs-Mail (017) abbestellt hatte, bekommt das Thema
-- "Zusage" weiter nur als Push.
INSERT INTO benachrichtigungen (user_id, thema, kanal)
  SELECT id, 'zusage', 'push' FROM users WHERE mail_erinnerung = 0;
