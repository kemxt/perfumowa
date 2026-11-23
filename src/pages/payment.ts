import type { ApiError } from '../../shared/catalog';
import type { CheckoutRequest, CheckoutResponse } from '../../shared/orders';
import { formatPrice } from '../data/products';
import { track } from '../lib/analytics';
import { cartItems, cartLines, cartSubtotal, checkoutItems } from '../lib/cart';
import { esc } from '../lib/dom';
import { loadStripe, type EmbeddedCheckout } from '../lib/stripe';
import type { Page } from '../router';

/**
 * /kasa – formularz płatności Stripe osadzony w sklepie (Embedded Checkout).
 * Worker zakłada zamówienie z cenami z bazy (POST /api/checkout) i zwraca client secret;
 * po płatności Stripe przenosi klienta na /kasa/dziekujemy.
 */

async function createSession(): Promise<CheckoutResponse> {
  const request: CheckoutRequest = { items: checkoutItems() };
  let response: Response;
  try {
    response = await fetch('/api/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
  } catch {
    throw new Error('Brak połączenia z internetem. Sprawdź połączenie i odśwież stronę.');
  }
  const data = (await response.json().catch(() => null)) as Partial<CheckoutResponse & ApiError> | null;
  if (!response.ok || !data?.clientSecret || !data.publishableKey) throw new Error(data?.error ?? 'Nie udało się otworzyć płatności. Spróbuj ponownie.');
  return { clientSecret: data.clientSecret, publishableKey: data.publishableKey };
}

export function paymentPage(): Page {
  let alive = true;
  let checkout: EmbeddedCheckout | null = null;

  return {
    title: 'Kasa | Perfumowa Aura',
    async mount(view) {
      const lines = cartLines();
      const n = lines.length;
      const positions = `${n} ${n === 1 ? 'pozycja' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'pozycje' : 'pozycji'}`;
      view.innerHTML = `
      <main id="main" class="shop-page grid surface-dark" tabindex="-1">
        <div class="shop-page__inner">
          <a class="shop-page__back" href="/koszyk">← Wróć do koszyka</a>
          <h1 class="t-h2 shop-page__title">Kasa</h1>
          ${
            lines.length
              ? `<p class="shop-page__text">${positions} · ${formatPrice(cartSubtotal())} bez dostawy. Podaj adres, wybierz dostawę i zapłać.</p>
                 <div class="payment" data-payment><p class="payment__status">Wczytywanie formularza płatności…</p></div>`
              : `<p class="shop-page__text">Koszyk jest pusty.</p><a class="btn btn--quiet" href="/perfumy">Zobacz perfumy</a>`
          }
        </div>
      </main>`;
      const frame = view.querySelector<HTMLElement>('[data-payment]');
      if (!frame) return;

      track('begin_checkout', cartItems());
      try {
        const [session, Stripe] = await Promise.all([createSession(), loadStripe()]);
        if (!alive) return;
        const embedded = await Stripe(session.publishableKey).initEmbeddedCheckout({ fetchClientSecret: () => Promise.resolve(session.clientSecret) });
        // Klient zdążył wyjść z kasy – Stripe pozwala na jeden formularz naraz, więc sprzątamy.
        if (!alive) return embedded.destroy();
        checkout = embedded;
        frame.replaceChildren();
        embedded.mount(frame);
      } catch (error) {
        if (!alive) return;
        frame.classList.add('payment--error');
        frame.innerHTML = `
          <p class="payment__status" role="alert">${esc(error instanceof Error ? error.message : String(error))}</p>
          <a class="btn btn--quiet" href="/koszyk">Wróć do koszyka</a>`;
      }
    },
    unmount() {
      alive = false;
      checkout?.destroy();
      checkout = null;
    },
  };
}
