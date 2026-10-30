-- Mails aus der App (Okt. 2026): Erinnerung vor dem Spieltag an alle, die
-- noch nicht abgestimmt haben - abschaltbar je Konto. mail_log merkt sich,
-- wer zu welchem Spieltag welche Stufe (7 bzw. 2 Tage vorher) schon
-- bekommen hat, damit niemand zweimal dieselbe Erinnerung erhaelt.
ALTER TABLE users ADD COLUMN mail_erinnerung INTEGER NOT NULL DEFAULT 1;

CREATE TABLE mail_log (
  termin_id TEXT NOT NULL,
  stufe     TEXT NOT NULL,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sent_at   TEXT NOT NULL,
  PRIMARY KEY (termin_id, stufe, user_id)
);
