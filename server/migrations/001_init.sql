-- Dart-Turnier: Accounts und geteilte Spielhistorie.
--
-- Grundsatz: der Server kennt KEINE Dart-Regeln. `games.payload` ist der
-- wortgleiche Archiv-Eintrag des Clients; alle Statistiken werden weiterhin
-- clientseitig aus den Wuerfen gerechnet. `game_players` ist reiner Index.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,          -- immer kleingeschrieben
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,                 -- scrypt$N$salt$hash
  avatar        TEXT,                          -- Data-URL, wie im Client
  hue           INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'aktiv', -- aktiv | gesperrt
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,                 -- 32 Zufallsbytes hex, opak
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expires ON sessions(expires_at);

-- Fortlaufende Zaehler. `game_seq` ist der Sync-Cursor: er steigt bei jedem
-- Einfuegen UND bei jedem Loeschen, damit geloeschte Spiele die Clients
-- ueberhaupt erreichen (sonst blieben sie dort fuer immer stehen).
CREATE TABLE counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO counters (name, value) VALUES ('game_seq', 0);

CREATE TABLE games (
  id          TEXT PRIMARY KEY,                -- vom Client vergeben -> idempotent
  seq         INTEGER NOT NULL,
  kind        TEXT NOT NULL,                   -- 501 | cricket | rtw | tournament
  payload     TEXT NOT NULL,                   -- JSON, unveraendert vom Client
  recorded_by TEXT NOT NULL REFERENCES users(id),
  client_at   INTEGER NOT NULL,                -- ms, Zeitpunkt beim Eintragenden
  created_at  TEXT NOT NULL,
  deleted_at  TEXT                             -- Grabstein statt hartem Loeschen
);
CREATE UNIQUE INDEX games_seq ON games(seq);
CREATE INDEX games_recorder ON games(recorded_by);

CREATE TABLE game_players (
  game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  pos        INTEGER NOT NULL,
  user_id    TEXT REFERENCES users(id),        -- NULL bei Gastspieler
  guest_name TEXT,                             -- nur bei Gastspieler gesetzt
  PRIMARY KEY (game_id, pos)
);
CREATE INDEX game_players_user ON game_players(user_id);
