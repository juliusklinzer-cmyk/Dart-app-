-- Liga-Zusagen: wer bei welchem Spieltag dabei ist.
--
-- Die Termine selbst stehen im Client (LIGA in js/app.js) -- der Server
-- kennt wie immer keine Dart-Welt, er verwahrt nur, wer sich zu welcher
-- Termin-Kennung eingetragen hat.
CREATE TABLE liga_zusagen (
  termin_id  TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (termin_id, user_id)
);
CREATE INDEX liga_zusagen_termin ON liga_zusagen(termin_id);
