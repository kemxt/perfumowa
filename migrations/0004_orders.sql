-- Zamówienia opłacane przez Stripe Checkout. Kwoty w groszach.
-- Zamówienie powstaje przy przejściu do kasy (status 'pending') z cenami policzonymi z bazy;
-- webhook Stripe (POST /admin/completed) albo strona podziękowania uzupełniają dane klienta
-- i ustawiają 'paid' / 'failed' / 'expired'. 'shipped' i 'cancelled' ustawia sprzedawca w panelu.

-- AUTOINCREMENT: numer zamówienia (PA-00012) nigdy nie wraca, nawet po usunięciu wiersza.
CREATE TABLE orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'paid', 'shipped', 'cancelled', 'failed', 'expired')),
  stripe_session_id TEXT UNIQUE,
  -- PaymentIntent (pi_…) – link do płatności w panelu Stripe.
  stripe_payment_id TEXT NOT NULL DEFAULT '',
  subtotal          INTEGER NOT NULL,
  -- Znane po płatności (klient wybiera dostawę w kasie Stripe).
  shipping_price    INTEGER,
  total             INTEGER,
  -- Sposoby dostawy zaproponowane w kasie: [{"name", "time", "price"}], w kolejności ze Stripe.
  shipping_options  TEXT NOT NULL DEFAULT '[]',
  shipping_method   TEXT NOT NULL DEFAULT '',
  email             TEXT NOT NULL DEFAULT '',
  phone             TEXT NOT NULL DEFAULT '',
  -- Imię i nazwisko z danych płatnika.
  name              TEXT NOT NULL DEFAULT '',
  -- Adres dostawy: {"name", "line1", "line2", "postalCode", "city", "country"} albo NULL
  address           TEXT,
  parcel_locker     TEXT NOT NULL DEFAULT '',
  nip               TEXT NOT NULL DEFAULT '',
  tracking          TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at           TEXT
);

CREATE INDEX orders_listing ON orders (status, created_at);

-- Pozycje z nazwą i ceną z chwili zakupu – zmiana produktu w panelu nie zmienia zamówienia.
CREATE TABLE order_items (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  INTEGER REFERENCES products(id) ON DELETE SET NULL,
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  -- „50 ml” albo „próbka 2 ml”
  variant     TEXT NOT NULL,
  unit_price  INTEGER NOT NULL CHECK (unit_price >= 0),
  qty         INTEGER NOT NULL CHECK (qty > 0)
);

CREATE INDEX order_items_order ON order_items (order_id);
