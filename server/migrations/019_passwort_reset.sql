-- Passwort vergessen (Nov. 2026): der Server schickt einen Link per Mail,
-- der eine Stunde gilt und nur einmal benutzt werden kann. Gespeichert ist
-- nur der SHA-256 des Tokens - wer die Datenbank liest, kann damit nichts
-- anfangen. Je Konto hoechstens ein offener Link (ein neuer loescht den alten).
CREATE TABLE passwort_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);
CREATE INDEX passwort_resets_user ON passwort_resets(user_id);
