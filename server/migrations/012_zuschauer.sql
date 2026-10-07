-- Live-Ticker fuer Zuschauer: jedes geteilte Turnier bekommt einen geheimen
-- Schluessel. Wer den Link kennt, sieht Stand, Ergebnisse und laufende
-- Einzel - ohne Konto, nur lesend. Aeltere Turniere bekommen ihn beim
-- naechsten Abruf.
ALTER TABLE tournaments ADD COLUMN zuschauer TEXT;
CREATE UNIQUE INDEX tournaments_zuschauer ON tournaments(zuschauer);
