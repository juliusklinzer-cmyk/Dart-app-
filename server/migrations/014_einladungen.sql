-- Einladungs-Links: ein Mitglied laedt einen Gast (Gast-Konto) oder ein
-- neues Vereinsmitglied ein. Der Link traegt nur das Token, nie den
-- Einladungscode selbst; er gilt sieben Tage und fuer genau ein Konto.
CREATE TABLE einladungen (
  token      TEXT PRIMARY KEY,
  art        TEXT NOT NULL,              -- 'gast' | 'mitglied'
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_by    TEXT REFERENCES users(id),
  used_at    TEXT
);
CREATE INDEX einladungen_ersteller ON einladungen(created_by, created_at);
