-- Jeder Spieler eine eigene Farbe.
--
-- Bei der Registrierung schickte das Geraet immer den ersten freien Farbton
-- seiner (noch leeren) Spielerliste -- also bei allen denselben (145). Im
-- Verlaufsdiagramm sahen dadurch alle Linien gleich aus. Die Palette ist
-- die des Clients (ohne 0: eine 0 gaelte dort als "keine Farbe"); vergeben
-- wird in Reihenfolge der Registrierung, also bekommt jeder aktive Spieler
-- einen anderen Ton, solange es hoechstens zwoelf sind.
WITH pal(n, hue) AS (VALUES (0,145),(1,210),(2,40),(3,355),(4,275),(5,175),(6,320),(7,90),(8,25),(9,250),(10,120),(11,300)),
     nr AS (SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) - 1 AS n FROM users WHERE status = 'aktiv')
UPDATE users
   SET hue = (SELECT pal.hue FROM pal JOIN nr ON nr.id = users.id WHERE pal.n = nr.n % 12)
 WHERE id IN (SELECT id FROM nr);
