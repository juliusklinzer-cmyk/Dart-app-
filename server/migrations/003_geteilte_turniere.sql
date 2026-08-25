-- Geteilte Turniere: ein Turnier, zwei Scheiben, zwei Geraete.
--
-- Auch hier kennt der Server keine Dart-Regeln. `plan` ist der Spielplan, wie
-- ihn der Client gebaut hat (Teilnehmer, Modus, Paarungen), und `result` ist
-- die fertige Partie -- beides opakes JSON. Der Server verwahrt nur und sorgt
-- dafuer, dass nicht zwei Geraete dieselbe Partie mitschreiben.

CREATE TABLE tournaments (
  id         TEXT PRIMARY KEY,                 -- vom Client vergeben -> idempotent
  plan       TEXT NOT NULL,                    -- JSON: {start, bestOf, players, matches}
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'offen',    -- offen | beendet
  ended_at   TEXT
);
CREATE INDEX tournaments_status ON tournaments(status);

-- Wer mitspielt, sieht das Turnier auf seinem Geraet. Gastspieler stehen im
-- Plan, aber nicht hier: sie haben kein Geraet, auf dem es auftauchen muesste.
CREATE TABLE tournament_players (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (tournament_id, user_id)
);
CREATE INDEX tournament_players_user ON tournament_players(user_id);

-- Eine Zeile je Partie, aber nur sobald sie jemand angefasst hat. Ohne Zeile
-- ist die Partie frei.
--
-- `claimed_by` ist die Absprache zwischen den Geraeten: wer eine Partie
-- beansprucht, schreibt sie mit, und die anderen sehen "laeuft bei X" statt
-- eines Start-Knopfes. `claimed_at` macht die Absprache wieder loesbar --
-- ein Geraet, das mitten im Spiel ausfaellt, darf keine Partie fuer immer
-- blockieren.
CREATE TABLE tournament_matches (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  match_id      TEXT NOT NULL,                 -- Kennung aus dem Spielplan
  claimed_by    TEXT REFERENCES users(id),
  claimed_at    INTEGER,                       -- ms
  result        TEXT,                          -- JSON der fertigen Partie
  seq           INTEGER NOT NULL,              -- Cursor je Turnier
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (tournament_id, match_id)
);
CREATE INDEX tournament_matches_seq ON tournament_matches(tournament_id, seq);

INSERT INTO counters (name, value) VALUES ('tournament_seq', 0);
