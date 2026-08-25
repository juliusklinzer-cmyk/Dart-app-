-- Lieblingsdoppel je Account. NULL heisst "egal" -- dann gilt die allgemeine
-- Rangfolge aus js/checkout.js. Der Wert ist die Feldzahl (20 = D20, 25 =
-- Bull); die Regel selbst steht wie immer nur im Client.
ALTER TABLE users ADD COLUMN dbl INTEGER;
