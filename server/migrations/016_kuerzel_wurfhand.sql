-- Profil bearbeiten (Entwurf Okt. 2026): selbst gewaehltes Kuerzel im
-- Avatar (bis drei Zeichen, NULL = aus dem Namen) und die Wurfhand
-- ('R' oder 'L', NULL = nicht angegeben).
ALTER TABLE users ADD COLUMN kuerzel TEXT;
ALTER TABLE users ADD COLUMN wurfhand TEXT;
