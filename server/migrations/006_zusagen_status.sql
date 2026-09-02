-- Zusagen bekommen einen Status: fuer das Dienstags-Training (DiensDarts)
-- gibt es neben "dabei" auch "unsicher" und eine ausdrueckliche Absage.
-- Bestehende Zeilen sind allesamt Zusagen.
ALTER TABLE liga_zusagen ADD COLUMN status TEXT NOT NULL DEFAULT 'dabei';
