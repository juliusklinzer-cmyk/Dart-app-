-- Finish-Profil je Account (Checkout-Engine, Phase 2): Lieblingsgruppen,
-- Average, Wurftests, Spielweise und die daraus gerechnete eigene Tabelle
-- als JSON. NULL heisst "Standardtabelle". Die Regeln stehen im Client,
-- der Server prueft nur Form und Groesse.
ALTER TABLE users ADD COLUMN finish TEXT;
