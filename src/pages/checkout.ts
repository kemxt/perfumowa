import type { CheckoutResult } from '../../shared/orders';
import { formatPrice, settings } from '../data/products';
import { SHOP } from '../data/shop';
import { track } from '../lib/analytics';
import { clearCart } from '../lib/cart';
import { esc } from '../lib/dom';
import type { Page } from '../router';

/**
 * /kasa/dziekujemy?session_id=cs_… – tu Stripe wraca po płatności. Worker sprawdza sesję
 * (GET /api/checkout/:id); przy płatności w toku pytamy jeszcze kilka razy.
 */

const POLL_ATTEMPTS = 6;
const POLL_DELAY = 2500;

function summary(result: CheckoutResult): string {
  const rows = result.items
    .map((i) => `<tr><th scope="row">${esc(i.name)}<span>${esc(i.variant)}${i.qty > 1 ? ` × ${i.qty}` : ''}</span></th><td>${formatPrice(i.price * i.qty)}</td></tr>`)
    .join('');
  const shipping = result.shipping === null ? '' : `<tr><th scope="row">Dostawa</th><td>${result.shipping === 0 ? 'Bezpłatnie' : formatPrice(result.shipping)}</td></tr>`;
  const total = result.total ?? result.subtotal;
  return `
    <table class="order-summary">
      <caption class="visually-hidden">Podsumowanie zamówienia ${esc(result.number)}</caption>
      <tbody>${rows}${shipping}</tbody>
      <tfoot><tr><th scope="row">${result.total === null ? 'Produkty' : 'Razem'}</th><td>${formatPrice(total)}</td></tr></tfoot>
    </table>`;
}

function content(result: CheckoutResult, stillPending: boolean): { title: string; text: string; actions: string } {
  const email = settings.contact.email;
  const contact = email ? ` W razie pytań napisz na <a class="link" href="mailto:${esc(email)}" data-external>${esc(email)}</a> i podaj numer zamówienia.` : '';
  switch (result.status) {
    case 'paid':
    case 'shipped':
      return {
        title: 'Dziękujemy',
        text: `Płatność przyjęta – zamówienie przygotujemy do wysyłki. Czas realizacji: ${esc(SHOP.processingTime)}.${contact}`,
        actions: `<a class="btn btn--quiet" href="/perfumy">Wróć do sklepu</a>`,
      };
    case 'pending':
      return stillPending
        ? { title: 'Sprawdzamy płatność', text: 'To zwykle trwa kilka sekund – strona odświeży się sama.', actions: '' }
        : {
            title: 'Płatność w toku',
            text: `Czekamy, aż bank potwierdzi płatność. Gdy to nastąpi, zrealizujemy zamówienie ${esc(result.number)} – nie musisz płacić ponownie.${contact}`,
            actions: `<a class="btn btn--quiet" href="/perfumy">Wróć do sklepu</a>`,
          };
    case 'cancelled':
      return { title: 'Zamówienie anulowane', text: `Zamówienie ${esc(result.number)} zostało anulowane.${contact}`, actions: `<a class="btn btn--quiet" href="/perfumy">Wróć do sklepu</a>` };
    default:
      return {
        title: 'Płatność nie doszła do skutku',
        text: 'Zamówienie nie zostało opłacone. Produkty wciąż czekają w koszyku – możesz spróbować ponownie.',
        actions: `<button type="button" class="btn btn--primary" data-cart-open>Otwórz koszyk</button>`,
      };
  }
}

export function checkoutResultPage(): Page {
  let alive = true;
  let timer = 0;

  return {
    title: 'Zamówienie | Perfumowa Aura',
    mount(view) {
      view.innerHTML = `
      <main id="main" class="simple-page grid surface-dark" tabindex="-1">
        <div class="simple-page__inner order-result" data-result aria-live="polite">
          <p class="label">Zamówienie</p>
          <h1 class="t-display">Sprawdzamy płatność</h1>
        </div>
      </main>`;
      const box = view.querySelector<HTMLElement>('[data-result]')!;
      const sessionId = new URLSearchParams(window.location.search).get('session_id') ?? '';

      const render = (result: CheckoutResult, attempt: number) => {
        const stillPending = result.status === 'pending' && attempt < POLL_ATTEMPTS;
        const { title, text, actions } = content(result, stillPending);
        box.innerHTML = `
          <p class="label">Zamówienie ${esc(result.number)}</p>
          <h1 class="t-display">${title}</h1>
          <p class="simple-page__text">${text}</p>
          ${summary(result)}
          ${actions ? `<div class="order-result__actions">${actions}</div>` : ''}`;
      };

      const fail = (message: string) => {
        box.innerHTML = `
          <p class="label">Zamówienie</p>
          <h1 class="t-display">Nie znaleziono zamówienia</h1>
          <p class="simple-page__text">${message}</p>
          <div class="order-result__actions"><a class="btn btn--quiet" href="/perfumy">Wróć do sklepu</a></div>`;
      };

      const load = async (attempt: number): Promise<void> => {
        let response: Response | null = null;
        try {
          response = await fetch(`/api/checkout/${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
        } catch {
          // brak sieci – spróbujemy ponownie poniżej
        }
        if (!alive) return;
        if (response?.status === 404) return fail('Link jest nieprawidłowy albo wygasł. Jeśli płatność została pobrana, napisz do nas – sprawdzimy zamówienie.');
        const result = response?.ok ? ((await response.json()) as CheckoutResult) : null;
        if (!alive) return;
        if (!result) {
          if (attempt < POLL_ATTEMPTS) timer = window.setTimeout(() => void load(attempt + 1), POLL_DELAY);
          else fail('Nie udało się sprawdzić płatności. Odśwież stronę za chwilę.');
          return;
        }

        // Zakończona kasa (także płatność w toku) – koszyk już niepotrzebny.
        if (result.status === 'paid' || result.status === 'shipped' || result.status === 'pending') clearCart();
        if (result.status === 'paid') trackPurchase(result);
        render(result, attempt);
        if (result.status === 'pending' && attempt < POLL_ATTEMPTS) timer = window.setTimeout(() => void load(attempt + 1), POLL_DELAY);
      };

      void load(1);
    },
    unmount() {
      alive = false;
      window.clearTimeout(timer);
    },
  };
}

/** Zdarzenie purchase raz na zamówienie (odświeżenie strony go nie powtarza). */
function trackPurchase(result: CheckoutResult): void {
  const key = `aura-purchase-${result.number}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch {
    // bez storage zdarzenie może się powtórzyć po odświeżeniu – akceptowalne
  }
  const items = result.items.map((i) => ({
    // Ten sam identyfikator co w koszyku: figowy-sad-50 / figowy-sad-probka.
    item_id: `${i.slug}-${i.variant.startsWith('próbka') ? 'probka' : parseInt(i.variant, 10)}`,
    item_name: i.name,
    item_brand: 'Perfumowa Aura',
    item_category: 'Perfumy',
    item_variant: i.variant,
    price: i.price,
    quantity: i.qty,
  }));
  track('purchase', items, {}, { transaction_id: result.number, value: result.total ?? result.subtotal, shipping: result.shipping ?? 0 });
}
