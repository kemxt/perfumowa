-- Katalog sklepu: kategorie, produkty, pojemności z cenami, zdjęcia.
-- Ceny w groszach (INTEGER), żeby uniknąć błędów zaokrągleń.
-- Pola złożone, edytowane w panelu jako całość (nuty, opisy warstw, profil, paleta,
-- kalibracja etykiety 3D), trzymamy jako JSON w kolumnach TEXT.

CREATE TABLE categories (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE products (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  position      INTEGER NOT NULL DEFAULT 0,
  tagline       TEXT NOT NULL DEFAULT '',
  mood          TEXT NOT NULL DEFAULT '',
  family        TEXT NOT NULL DEFAULT '',
  concentration TEXT NOT NULL DEFAULT 'Eau de Parfum',
  year          INTEGER,
  perfumer      TEXT NOT NULL DEFAULT '',
  -- Akapity rozdzielone pustą linią.
  description   TEXT NOT NULL DEFAULT '',
  -- {"top": "...", "heart": "...", "base": "..."}
  story         TEXT NOT NULL DEFAULT '{}',
  -- {"top": ["..."], "heart": [...], "base": [...]}
  notes         TEXT NOT NULL DEFAULT '{}',
  -- {"longevity": "...", "sillage": "...", "season": "...", "occasion": "..."}
  specs         TEXT NOT NULL DEFAULT '{}',
  -- {"bg": "#...", "fg": ..., "liquid", "paper", "ink", "cap"}
  palette       TEXT NOT NULL DEFAULT '{}',
  -- {"value": 4.8, "count": 127, "demo": true} albo NULL
  rating        TEXT,
  bottle_image  TEXT NOT NULL DEFAULT '',
  label_image   TEXT NOT NULL DEFAULT '',
  -- Kalibracja etykiety 3D (nadpisuje src/lib/bottle-label/defaults.json) albo NULL
  label_config  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX products_category ON products (category_id);
CREATE INDEX products_listing ON products (status, position);

CREATE TABLE product_sizes (
  id          INTEGER PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ml          INTEGER NOT NULL CHECK (ml > 0),
  price       INTEGER NOT NULL CHECK (price >= 0),
  position    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (product_id, ml)
);

CREATE TABLE product_photos (
  id          INTEGER PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- Ścieżka bez sufiksu; pliki to `${src}-{600,1200}.{format}`.
  src         TEXT NOT NULL,
  -- Dostępne formaty, po przecinku, od najlepszego, np. 'avif,webp'.
  formats     TEXT NOT NULL DEFAULT 'webp',
  alt         TEXT NOT NULL DEFAULT '',
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  cutout      INTEGER NOT NULL DEFAULT 0,
  position    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX product_sizes_product ON product_sizes (product_id, position);
CREATE INDEX product_photos_product ON product_photos (product_id, position);

-- Nieudane logowania do panelu (ograniczanie prób z jednego IP).
CREATE TABLE login_attempts (
  ip  TEXT NOT NULL,
  at  INTEGER NOT NULL
);

CREATE INDEX login_attempts_ip ON login_attempts (ip, at);
