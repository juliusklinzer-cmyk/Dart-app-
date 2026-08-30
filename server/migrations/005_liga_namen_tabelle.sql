-- Buergerlicher Name fuer den Liga-Betrieb: die SWO verlangt auf dem
-- Spielberichtsbogen buergerliche Namen, keine Kuenstlernamen. Optional,
-- gepflegt vom Nutzer selbst.
ALTER TABLE users ADD COLUMN real_name TEXT;

-- Die manuell gepflegte Ligatabelle: ein JSON-Blob, den der Client baut und
-- anzeigt. Der Server verwahrt nur den letzten Stand (letzter Schreiber
-- gewinnt) -- wie immer ohne jede Dart-Logik.
CREATE TABLE liga_tabelle (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  daten      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id)
);
