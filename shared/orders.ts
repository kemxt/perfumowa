/**
 * Kasa (Stripe Checkout) i zamówienia – kontrakt API między Workerem, sklepem i panelem.
 * Kwoty w API są w złotych (w bazie w groszach).
 */

/** Próbka każdego zapachu: stała pojemność i cena – liczy ją i sklep, i kasa. */
export const SAMPLE = { ml: 2, price: 19 } as const;

/** Najwyżej tyle sztuk jednej pozycji w koszyku. */
export const MAX_QTY = 9;

/** Stripe pokazuje w kasie najwyżej 5 sposobów dostawy. */
export const MAX_SHIPPING_OPTIONS = 5;

/** Pozycja koszyka wysyłana do kasy; cenę i dostępność Worker sprawdza w bazie. */
export interface CheckoutItem {
  slug: string;
  /** Pojemność w ml albo próbka. */
  size: number | 'sample';
  qty: number;
}

/** POST /api/checkout */
export interface CheckoutRequest {
  items: CheckoutItem[];
  /** Ścieżka, na którą Stripe wraca po przerwaniu płatności, np. /perfumy/figowy-sad. */
  returnTo?: string;
}

/** Adres kasy Stripe, na który sklep przekierowuje klienta. */
export interface CheckoutResponse {
  url: string;
}

export const ORDER_STATUSES = ['pending', 'paid', 'shipped', 'cancelled', 'failed', 'expired'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Czeka na płatność',
  paid: 'Do wysłania',
  shipped: 'Wysłane',
  cancelled: 'Anulowane',
  failed: 'Płatność nieudana',
  expired: 'Nieopłacone',
};

/** Statusy, które sprzedawca ustawia w panelu. Pozostałe przychodzą ze Stripe. */
export const MANUAL_STATUSES = ['paid', 'shipped', 'cancelled'] as const satisfies readonly OrderStatus[];
export type ManualStatus = (typeof MANUAL_STATUSES)[number];

export const isManualStatus = (status: string): status is ManualStatus => (MANUAL_STATUSES as readonly string[]).includes(status);

export interface OrderItem {
  slug: string;
  name: string;
  /** „50 ml” albo „próbka 2 ml” */
  variant: string;
  /** Cena jednostkowa. */
  price: number;
  qty: number;
}

export interface OrderAddress {
  name: string;
  line1: string;
  line2: string;
  postalCode: string;
  city: string;
  country: string;
}

/** GET /api/checkout/:sessionId – strona podziękowania po powrocie ze Stripe. */
export interface CheckoutResult {
  number: string;
  status: OrderStatus;
  email: string;
  items: OrderItem[];
  subtotal: number;
  /** null, dopóki klient nie zapłacił (dostawę wybiera w kasie Stripe). */
  shipping: number | null;
  total: number | null;
}

export interface AdminOrderSummary {
  id: number;
  number: string;
  status: OrderStatus;
  name: string;
  email: string;
  itemCount: number;
  subtotal: number;
  total: number | null;
  createdAt: string;
  paidAt: string | null;
}

export interface AdminOrder extends AdminOrderSummary {
  phone: string;
  address: OrderAddress | null;
  shippingMethod: string;
  shippingPrice: number | null;
  parcelLocker: string;
  nip: string;
  tracking: string;
  items: OrderItem[];
  /** Płatność w panelu Stripe (po opłaceniu). */
  stripeUrl: string | null;
  updatedAt: string;
}

/** PUT /api/admin/orders/:id */
export interface AdminOrderInput {
  status: ManualStatus;
  /** Numer przesyłki. */
  tracking: string;
}

/** Czy Worker ma klucze Stripe – panel ostrzega, gdy kasa nie zadziała. */
export interface PaymentsStatus {
  ready: boolean;
  mode: 'live' | 'test' | null;
  webhook: boolean;
}

/** GET /api/admin/orders */
export interface AdminOrderList {
  orders: AdminOrderSummary[];
  payments: PaymentsStatus;
}

/** 12 → „PA-00012” */
export const orderNumber = (id: number) => `PA-${String(id).padStart(5, '0')}`;
