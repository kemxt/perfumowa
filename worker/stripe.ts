import { HttpError } from './http';

/**
 * Minimalny klient Stripe na fetch i Web Crypto (bez SDK): sesje Checkout i podpis webhooków.
 * Sekrety Workera: STRIPE_SECRET_KEY (sk_… albo ograniczony rk_…) i STRIPE_WEBHOOK_SECRET (whsec_…).
 */

const API = 'https://api.stripe.com/v1';
/** Webhook starszy niż 5 minut odrzucamy (ochrona przed powtórzeniem przechwyconego zdarzenia). */
const WEBHOOK_TOLERANCE = 5 * 60;

const encoder = new TextEncoder();

export const PAYMENT_ERROR = 'Nie udało się połączyć z systemem płatności. Spróbuj ponownie za chwilę.';

export const stripeConfigured = (env: Env) => /^(sk|rk)_(live|test)_\w+$/.test(env.STRIPE_SECRET_KEY ?? '');
export const webhookConfigured = (env: Env) => (env.STRIPE_WEBHOOK_SECRET ?? '').startsWith('whsec_');
export const stripeMode = (env: Env) => (stripeConfigured(env) ? (env.STRIPE_SECRET_KEY.includes('_live_') ? 'live' : 'test') : null);

export interface StripeAddress {
  line1: string | null;
  line2: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
}

type Expandable = string | { id: string };

/** Pola sesji Checkout, z których korzysta sklep. */
export interface CheckoutSession {
  id: string;
  url: string | null;
  status: 'open' | 'complete' | 'expired' | null;
  payment_status: 'paid' | 'unpaid' | 'no_payment_required';
  amount_total: number | null;
  payment_intent: Expandable | null;
  customer_details: { email: string | null; name: string | null; phone: string | null; address: StripeAddress | null } | null;
  /** Adres dostawy od API 2025-03-31; starsze wersje mają shipping_details w głównym obiekcie. */
  collected_information?: { shipping_details?: { name: string | null; address: StripeAddress | null } | null } | null;
  shipping_details?: { name: string | null; address: StripeAddress | null } | null;
  shipping_cost: { amount_total: number; shipping_rate: Expandable | null } | null;
  /** Zaproponowane opcje dostawy, w kolejności z utworzenia sesji. */
  shipping_options?: { shipping_amount: number; shipping_rate: Expandable }[];
  custom_fields?: { key: string; text?: { value: string | null } | null }[];
}

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: unknown };
}

export const idOf = (value: Expandable | null | undefined) => (typeof value === 'string' ? value : (value?.id ?? null));

/** Parametry w formacie Stripe (application/x-www-form-urlencoded): line_items[0][price_data][currency]=pln */
function encode(params: Record<string, unknown>): URLSearchParams {
  const form = new URLSearchParams();
  const add = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((item, i) => add(`${key}[${i}]`, item));
    else if (typeof value === 'object') Object.entries(value).forEach(([k, v]) => add(`${key}[${k}]`, v));
    else form.append(key, String(value));
  };
  Object.entries(params).forEach(([key, value]) => add(key, value));
  return form;
}

export async function stripe<T>(env: Env, method: 'GET' | 'POST', path: string, params?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  if (!stripeConfigured(env)) throw new HttpError(503, 'Płatności nie są jeszcze włączone. Spróbuj później albo napisz do nas.');
  const headers: Record<string, string> = { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` };
  let url = `${API}/${path}`;
  let body: string | undefined;
  if (params && method === 'GET') url += `?${encode(params)}`;
  else if (params) {
    body = encode(params).toString();
    headers['content-type'] = 'application/x-www-form-urlencoded';
  }
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

  let response: Response;
  try {
    response = await fetch(url, { method, headers, body });
  } catch (error) {
    console.error(`Stripe ${method} /${path}: brak połączenia`, error);
    throw new HttpError(502, PAYMENT_ERROR);
  }
  const data = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!response.ok || !data) {
    // Komunikat Stripe (np. brak uprawnienia klucza rk_…) trafia do logów Workera, klient widzi ogólny.
    console.error(`Stripe ${method} /${path}: HTTP ${response.status}: ${data?.error?.message ?? 'brak treści'}`);
    throw new HttpError(502, PAYMENT_ERROR);
  }
  return data;
}

function fromHex(hex: string): Uint8Array | null {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return null;
  return Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16));
}

/**
 * Nagłówek Stripe-Signature: „t=1700000000,v1=<hex>,v1=<hex>”. Podpis to HMAC-SHA256
 * sekretu whsec_… z „{t}.{surowa treść}”. Kilka v1 = kilka aktywnych sekretów (rotacja).
 */
export async function verifyWebhook(payload: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  let timestamp = '';
  const signatures: Uint8Array[] = [];
  for (const part of header.split(',')) {
    const [key, value = ''] = part.trim().split('=');
    if (key === 't') timestamp = value;
    else if (key === 'v1') {
      const bytes = fromHex(value);
      if (bytes) signatures.push(bytes);
    }
  }
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!timestamp || !(age <= WEBHOOK_TOLERANCE) || !signatures.length) return false;

  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`)));
  return signatures.some((sig) => sig.length === expected.length && crypto.subtle.timingSafeEqual(sig, expected));
}
