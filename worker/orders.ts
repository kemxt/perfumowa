import { SLUG_PATTERN, type ShopSettings } from '../shared/catalog';
import {
  MAX_QTY,
  MAX_SHIPPING_OPTIONS,
  SAMPLE,
  isManualStatus,
  orderNumber,
  type AdminOrder,
  type AdminOrderInput,
  type AdminOrderList,
  type AdminOrderSummary,
  type CheckoutItem,
  type CheckoutResponse,
  type CheckoutResult,
  type OrderAddress,
  type OrderItem,
  type OrderStatus,
} from '../shared/orders';
import { getSettings } from './db';
import { HttpError, json, readJson } from './http';
import {
  idOf,
  stripe,
  stripeConfigured,
  stripeMode,
  verifyWebhook,
  webhookConfigured,
  type CheckoutSession,
  type StripeAddress,
  type StripeEvent,
} from './stripe';

/**
 * Zamówienia i płatności (Stripe Checkout):
 *
 * 1. POST /api/checkout – ceny i dostępność liczymy z bazy (nie z koszyka), zapisujemy zamówienie
 *    'pending' i tworzymy sesję Checkout (embedded). Strona /kasa osadza formularz Stripe.
 * 2. W formularzu klient podaje adres, wybiera dostawę i płaci metodą włączoną w panelu Stripe
 *    (BLIK, karta, Przelewy24, Google Pay, Apple Pay…).
 * 3. Stripe wysyła webhook na POST /admin/completed → zamówienie 'paid' z adresem i dostawą.
 *    Strona podziękowania (GET /api/checkout/:session) sprawdza sesję też sama, gdyby webhook
 *    się spóźnił albo nie był skonfigurowany.
 */

const MAX_LINES = 20;
/** Sesja kasy wygasa po godzinie (minimum Stripe: 30 min) – potem zamówienie jest 'expired'. */
const SESSION_TTL = 60 * 60;
const SESSION_ID = /^cs_(live|test)_[A-Za-z0-9]{10,200}$/;

const zl = (grosze: number) => grosze / 100;
const nullableZl = (grosze: number | null) => (grosze === null ? null : zl(grosze));

// ---------------------------------------------------------------------------
// Wiersze
// ---------------------------------------------------------------------------

interface OrderRow {
  id: number;
  status: OrderStatus;
  stripe_session_id: string | null;
  stripe_payment_id: string;
  subtotal: number;
  shipping_price: number | null;
  total: number | null;
  shipping_options: string;
  shipping_method: string;
  email: string;
  phone: string;
  name: string;
  address: string | null;
  parcel_locker: string;
  nip: string;
  tracking: string;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
  item_count?: number;
}

interface ItemRow {
  slug: string;
  name: string;
  variant: string;
  unit_price: number;
  qty: number;
}

/** Sposób dostawy zaproponowany w kasie (cena w groszach, po uwzględnieniu darmowej dostawy). */
interface OfferedShipping {
  name: string;
  time: string;
  price: number;
}

/** Pozycja z ceną z bazy (w groszach). */
interface PricedLine {
  productId: number;
  slug: string;
  name: string;
  variant: string;
  unitPrice: number;
  qty: number;
}

const toItem = (row: ItemRow): OrderItem => ({ slug: row.slug, name: row.name, variant: row.variant, price: zl(row.unit_price), qty: row.qty });

function parseJson<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

async function findOrder(db: D1Database, where: 'id' | 'stripe_session_id', value: number | string): Promise<{ order: OrderRow; items: OrderItem[] } | null> {
  const [orders, items] = await db.batch([
    db.prepare(`SELECT * FROM orders WHERE ${where} = ?`).bind(value),
    db.prepare(`SELECT slug, name, variant, unit_price, qty FROM order_items WHERE order_id = (SELECT id FROM orders WHERE ${where} = ?) ORDER BY id`).bind(value),
  ]);
  const order = orders.results[0] as OrderRow | undefined;
  return order ? { order, items: (items.results as ItemRow[]).map(toItem) } : null;
}

// ---------------------------------------------------------------------------
// Kasa
// ---------------------------------------------------------------------------

function validateCheckout(raw: unknown): CheckoutItem[] {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const list: unknown[] = Array.isArray(input.items) ? input.items : [];
  if (!list.length) throw new HttpError(422, 'Koszyk jest pusty.');
  if (list.length > MAX_LINES) throw new HttpError(422, `W jednym zamówieniu może być najwyżej ${MAX_LINES} pozycji.`);

  const seen = new Set<string>();
  const items = list.map((item): CheckoutItem => {
    const { slug, size, qty } = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const valid =
      typeof slug === 'string' &&
      SLUG_PATTERN.test(slug) &&
      (size === 'sample' || (typeof size === 'number' && Number.isInteger(size) && size > 0)) &&
      typeof qty === 'number' &&
      Number.isInteger(qty) &&
      qty >= 1 &&
      qty <= MAX_QTY &&
      !seen.has(`${slug}:${size}`);
    if (!valid) throw new HttpError(422, 'Nieprawidłowa zawartość koszyka. Odśwież stronę i spróbuj ponownie.');
    seen.add(`${slug}:${size}`);
    return { slug, size, qty };
  });
  return items;
}

/** Ceny i dostępność z bazy – ceny z koszyka w przeglądarce nie mają znaczenia. */
async function priceLines(db: D1Database, items: CheckoutItem[]): Promise<PricedLine[]> {
  const slugs = [...new Set(items.map((i) => i.slug))];
  const marks = slugs.map(() => '?').join(', ');
  const [products, sizes] = await db.batch([
    db.prepare(`SELECT id, slug, name FROM products WHERE status = 'published' AND slug IN (${marks})`).bind(...slugs),
    db
      .prepare(
        `SELECT s.product_id, s.ml, s.price, s.availability FROM product_sizes s JOIN products p ON p.id = s.product_id
         WHERE p.status = 'published' AND p.slug IN (${marks})`,
      )
      .bind(...slugs),
  ]);
  const bySlug = new Map((products.results as { id: number; slug: string; name: string }[]).map((p) => [p.slug, p]));
  const sizeRows = sizes.results as { product_id: number; ml: number; price: number; availability: string }[];

  return items.map((item) => {
    const product = bySlug.get(item.slug);
    if (!product) throw new HttpError(409, 'Jednego z zapachów z koszyka nie ma już w sklepie. Usuń go z koszyka i spróbuj ponownie.');
    const base = { productId: product.id, slug: product.slug, name: product.name, qty: item.qty };
    if (item.size === 'sample') return { ...base, variant: `próbka ${SAMPLE.ml} ml`, unitPrice: SAMPLE.price * 100 };
    const size = sizeRows.find((s) => s.product_id === product.id && s.ml === item.size);
    if (!size || size.availability === 'unavailable') {
      throw new HttpError(409, `${product.name}, ${item.size} ml – chwilowo niedostępne. Usuń tę pozycję z koszyka i spróbuj ponownie.`);
    }
    return { ...base, variant: `${size.ml} ml`, unitPrice: size.price };
  });
}

function shippingOptions(settings: ShopSettings, subtotal: number): OfferedShipping[] {
  const { freeFrom, methods } = settings.shipping;
  const free = freeFrom !== null && subtotal >= Math.round(freeFrom * 100);
  return methods.slice(0, MAX_SHIPPING_OPTIONS).map((m) => ({ name: m.name, time: m.time, price: free ? 0 : Math.round(m.price * 100) }));
}

function sessionParams(orderId: number, lines: PricedLine[], shipping: OfferedShipping[], origin: string): Record<string, unknown> {
  const number = orderNumber(orderId);
  const metadata = { order_id: String(orderId), order_number: number };
  const customFields: Record<string, unknown>[] = [];
  // Paczkomat wymaga kodu automatu – Stripe nie ma mapy InPost, więc pytamy o kod w kasie.
  if (shipping.some((s) => /paczkomat/i.test(s.name))) {
    customFields.push({
      key: 'paczkomat',
      label: { type: 'custom', custom: 'Kod paczkomatu (przy dostawie do paczkomatu)' },
      type: 'text',
      optional: true,
      text: { maximum_length: 20 },
    });
  }
  customFields.push({ key: 'nip', label: { type: 'custom', custom: 'NIP – jeśli chcesz fakturę' }, type: 'text', optional: true, text: { maximum_length: 20 } });

  return {
    mode: 'payment',
    // Formularz Stripe osadzony na /kasa – klient nie opuszcza sklepu.
    ui_mode: 'embedded_page',
    locale: 'pl',
    submit_type: 'pay',
    client_reference_id: String(orderId),
    metadata,
    payment_intent_data: { description: `Zamówienie ${number}`, metadata },
    line_items: lines.map((l) => ({
      quantity: l.qty,
      price_data: { currency: 'pln', unit_amount: l.unitPrice, product_data: { name: `${l.name} · ${l.variant}` } },
    })),
    shipping_address_collection: { allowed_countries: ['PL'] },
    shipping_options: shipping.map((s) => ({
      shipping_rate_data: { type: 'fixed_amount', display_name: s.time ? `${s.name} · ${s.time}` : s.name, fixed_amount: { amount: s.price, currency: 'pln' } },
    })),
    phone_number_collection: { enabled: true },
    custom_fields: customFields,
    expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL,
    return_url: `${origin}/kasa/dziekujemy?session_id={CHECKOUT_SESSION_ID}`,
  };
}

/** POST /api/checkout */
export async function createCheckout(request: Request, env: Env): Promise<Response> {
  // Formularz z innej strony nie wyśle JSON-a bez CORS – nie da się zakładać zamówień cudzymi rękami.
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) throw new HttpError(415, 'Oczekiwano JSON.');
  const items = validateCheckout(await readJson(request));
  if (!stripeConfigured(env)) throw new HttpError(503, 'Płatności nie są jeszcze włączone. Spróbuj później albo napisz do nas.');

  const db = env.DB;
  const [lines, settings] = await Promise.all([priceLines(db, items), getSettings(db)]);
  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0);
  const shipping = shippingOptions(settings, subtotal);
  if (!shipping.length) throw new HttpError(503, 'Sklep nie ma jeszcze ustawionych sposobów dostawy. Spróbuj później albo napisz do nas.');

  // Batch to jedna transakcja, a D1 wykonuje zapisy po kolei – MAX(id) to właśnie dodane zamówienie.
  const [inserted] = await db.batch([
    db.prepare('INSERT INTO orders (subtotal, shipping_options) VALUES (?, ?) RETURNING id').bind(subtotal, JSON.stringify(shipping)),
    ...lines.map((l) =>
      db
        .prepare('INSERT INTO order_items (order_id, product_id, slug, name, variant, unit_price, qty) VALUES ((SELECT MAX(id) FROM orders), ?, ?, ?, ?, ?, ?)')
        .bind(l.productId, l.slug, l.name, l.variant, l.unitPrice, l.qty),
    ),
  ]);
  const orderId = (inserted.results[0] as { id: number }).id;

  let session: CheckoutSession;
  try {
    session = await stripe<CheckoutSession>(env, 'POST', 'checkout/sessions', sessionParams(orderId, lines, shipping, new URL(request.url).origin), `order-${orderId}`);
  } catch (error) {
    // Bez sesji zamówienie nie ma jak zostać opłacone – nie zaśmiecamy nim panelu.
    await db.batch([db.prepare('DELETE FROM order_items WHERE order_id = ?').bind(orderId), db.prepare('DELETE FROM orders WHERE id = ?').bind(orderId)]);
    throw error;
  }
  if (!session.client_secret) throw new HttpError(502, 'Nie udało się otworzyć kasy. Spróbuj ponownie.');
  await db.prepare('UPDATE orders SET stripe_session_id = ? WHERE id = ?').bind(session.id, orderId).run();
  // stripeConfigured() sprawdził, że klucz publiczny jest ustawiony.
  return json({ clientSecret: session.client_secret, publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? '' } satisfies CheckoutResponse);
}

// ---------------------------------------------------------------------------
// Synchronizacja ze Stripe (webhook i strona podziękowania)
// ---------------------------------------------------------------------------

const clean = (value: string | null | undefined, max = 200) => (value ?? '').trim().slice(0, max);

function toAddress(name: string | null | undefined, address: StripeAddress): OrderAddress {
  return {
    name: clean(name),
    line1: clean(address.line1),
    line2: clean(address.line2),
    postalCode: clean(address.postal_code, 20),
    city: clean(address.city),
    country: clean(address.country, 2),
  };
}

/** Wybrany w kasie sposób dostawy: po id stawki, a gdyby go zabrakło – po jednoznacznej cenie. */
function chosenShipping(session: CheckoutSession, offered: OfferedShipping[]): OfferedShipping | undefined {
  const rate = idOf(session.shipping_cost?.shipping_rate);
  const index = session.shipping_options?.findIndex((o) => idOf(o.shipping_rate) === rate) ?? -1;
  if (offered[index]) return offered[index];
  const sameAmount = offered.filter((o) => o.price === session.shipping_cost?.amount_total);
  return sameAmount.length === 1 ? sameAmount[0] : undefined;
}

/**
 * Przenosi stan sesji Checkout do zamówienia. Bezpieczne przy powtórkach i zdarzeniach
 * w złej kolejności: status zmienia się tylko z dozwolonych stanów (opłacone nie wraca do 'pending').
 */
async function syncSession(db: D1Database, session: CheckoutSession, failed = false): Promise<void> {
  const order = await db.prepare('SELECT id, shipping_options FROM orders WHERE stripe_session_id = ?').bind(session.id).first<Pick<OrderRow, 'id' | 'shipping_options'>>();
  if (!order) {
    console.warn(`Stripe: sesja ${session.id} nie należy do żadnego zamówienia – pomijam.`);
    return;
  }
  const statements: D1PreparedStatement[] = [];

  // Dane klienta są w sesji od chwili jej zakończenia – także przy płatności odroczonej.
  if (session.status === 'complete') {
    const customer = session.customer_details;
    const shippingDetails = session.collected_information?.shipping_details ?? session.shipping_details ?? null;
    const address = shippingDetails?.address ? toAddress(shippingDetails.name, shippingDetails.address) : null;
    const method = chosenShipping(session, parseJson<OfferedShipping[]>(order.shipping_options, []));
    const field = (key: string) => clean(session.custom_fields?.find((f) => f.key === key)?.text?.value, 40);
    statements.push(
      db
        .prepare(
          `UPDATE orders SET email = ?, phone = ?, name = ?, address = ?, shipping_method = ?, shipping_price = ?, total = ?,
             parcel_locker = ?, nip = ?, stripe_payment_id = ?, updated_at = datetime('now') WHERE id = ?`,
        )
        .bind(
          clean(customer?.email),
          clean(customer?.phone, 40),
          clean(customer?.name ?? shippingDetails?.name),
          address ? JSON.stringify(address) : null,
          method?.name ?? '',
          session.shipping_cost?.amount_total ?? null,
          session.amount_total,
          field('paczkomat').toUpperCase(),
          field('nip'),
          idOf(session.payment_intent) ?? '',
          order.id,
        ),
    );
  }

  const status: OrderStatus | null = failed
    ? 'failed'
    : session.status === 'expired'
      ? 'expired'
      : session.status === 'complete' && session.payment_status !== 'unpaid'
        ? 'paid'
        : null;
  if (status) {
    const from = status === 'paid' ? ['pending', 'failed'] : ['pending'];
    statements.push(
      db
        .prepare(
          `UPDATE orders SET status = ?1, paid_at = CASE WHEN ?1 = 'paid' THEN datetime('now') ELSE paid_at END, updated_at = datetime('now')
           WHERE id = ?2 AND status IN (${from.map((s) => `'${s}'`).join(', ')})`,
        )
        .bind(status, order.id),
    );
  }

  if (statements.length) await db.batch(statements);
}

/** POST /admin/completed – adres webhooka ustawiony w panelu Stripe. */
export async function handleWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') throw new HttpError(405, 'Niedozwolona metoda.');
  if (!webhookConfigured(env)) throw new HttpError(503, 'Webhook nie jest skonfigurowany: ustaw sekret STRIPE_WEBHOOK_SECRET.');
  const payload = await request.text();
  if (!(await verifyWebhook(payload, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET))) {
    throw new HttpError(400, 'Nieprawidłowy podpis webhooka.');
  }

  const event = JSON.parse(payload) as StripeEvent;
  const session = event.data.object as CheckoutSession;
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.expired':
      await syncSession(env.DB, session);
      break;
    case 'checkout.session.async_payment_failed':
      await syncSession(env.DB, session, true);
      break;
    default:
    // Inne zdarzenia (jeśli włączone w panelu Stripe) potwierdzamy bez działania.
  }
  return json({ received: true });
}

/** GET /api/checkout/:sessionId – identyfikator sesji zna tylko klient, który przeszedł przez kasę. */
export async function getCheckoutResult(env: Env, sessionId: string): Promise<CheckoutResult> {
  if (!SESSION_ID.test(sessionId)) throw new HttpError(404, 'Nie znaleziono zamówienia.');
  let found = await findOrder(env.DB, 'stripe_session_id', sessionId);
  if (!found) throw new HttpError(404, 'Nie znaleziono zamówienia.');

  if (found.order.status === 'pending' && stripeConfigured(env)) {
    try {
      await syncSession(env.DB, await stripe<CheckoutSession>(env, 'GET', `checkout/sessions/${sessionId}`));
      found = (await findOrder(env.DB, 'stripe_session_id', sessionId)) ?? found;
    } catch {
      // Stripe chwilowo niedostępny – zostaje stan z bazy, webhook go uzupełni.
    }
  }

  const { order, items } = found;
  return {
    number: orderNumber(order.id),
    status: order.status,
    email: order.email,
    items,
    subtotal: zl(order.subtotal),
    shipping: nullableZl(order.shipping_price),
    total: nullableZl(order.total),
  };
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

const toSummary = (row: OrderRow, itemCount: number): AdminOrderSummary => ({
  id: row.id,
  number: orderNumber(row.id),
  status: row.status,
  name: row.name,
  email: row.email,
  itemCount,
  subtotal: zl(row.subtotal),
  total: nullableZl(row.total),
  createdAt: row.created_at,
  paidAt: row.paid_at,
});

export async function listOrders(env: Env): Promise<AdminOrderList> {
  const { results } = await env.DB.prepare(
    `SELECT o.*, (SELECT COALESCE(SUM(qty), 0) FROM order_items i WHERE i.order_id = o.id) AS item_count
     FROM orders o ORDER BY o.id DESC LIMIT 1000`,
  ).all<OrderRow>();
  return {
    orders: results.map((row) => toSummary(row, row.item_count ?? 0)),
    payments: { ready: stripeConfigured(env), mode: stripeMode(env), webhook: webhookConfigured(env) },
  };
}

export async function getOrder(db: D1Database, id: number): Promise<AdminOrder> {
  const found = await findOrder(db, 'id', id);
  if (!found) throw new HttpError(404, 'Nie ma takiego zamówienia.');
  const { order, items } = found;
  const test = order.stripe_session_id?.startsWith('cs_test_');
  return {
    ...toSummary(
      order,
      items.reduce((sum, i) => sum + i.qty, 0),
    ),
    phone: order.phone,
    address: parseJson<OrderAddress | null>(order.address, null),
    shippingMethod: order.shipping_method,
    shippingPrice: nullableZl(order.shipping_price),
    parcelLocker: order.parcel_locker,
    nip: order.nip,
    tracking: order.tracking,
    items,
    stripeUrl: order.stripe_payment_id ? `https://dashboard.stripe.com/${test ? 'test/' : ''}payments/${order.stripe_payment_id}` : null,
    updatedAt: order.updated_at,
  };
}

/** Sprzedawca zmienia tylko zamówienia opłacone: do wysłania ↔ wysłane ↔ anulowane. */
export async function updateOrder(db: D1Database, id: number, input: AdminOrderInput): Promise<void> {
  const current = await db.prepare('SELECT status FROM orders WHERE id = ?').bind(id).first<OrderStatus>('status');
  if (!current) throw new HttpError(404, 'Nie ma takiego zamówienia.');
  if (!isManualStatus(current)) throw new HttpError(409, 'Status nieopłaconego zamówienia ustawia system płatności.');
  await db.prepare(`UPDATE orders SET status = ?, tracking = ?, updated_at = datetime('now') WHERE id = ?`).bind(input.status, input.tracking, id).run();
}
