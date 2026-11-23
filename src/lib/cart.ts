import { MAX_QTY, type CheckoutItem } from '../../shared/orders';
import { formatPrice, getProduct, pages } from '../data/products';
import { SHOP } from '../data/shop';
import { track, type AnalyticsItem } from './analytics';
import { esc } from './dom';
import { lockScroll, unlockScroll } from './smooth-scroll';

/**
 * Koszyk: stan w sessionStorage. Pełny widok na /koszyk, mini-koszyk (panel boczny) po dodaniu
 * produktu, płatność na /kasa. Lista pozycji i podsumowanie to wspólny kod panelu i strony.
 */
export interface CartLine {
  /** Unikalny klucz pozycji, np. "figowy-sad-50". */
  key: string;
  slug: string;
  /** Pojemność w ml albo próbka – po tym kasa rozpoznaje wariant. */
  size: number | 'sample';
  name: string;
  variant: string;
  price: number;
  qty: number;
  image?: string;
}

const STORAGE_KEY = 'aura-cart';
const ICON_CLOSE = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="m3 3 10 10M13 3 3 13" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`;

let lines: CartLine[] = load();
let root: HTMLElement | null = null;
let returnFocus: HTMLElement | null = null;
const listeners = new Set<() => void>();

function load(): CartLine[] {
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]') as CartLine[];
    // Pozycje sprzed kasy (bez pojemności) nie dadzą się zamówić – pomijamy je.
    return Array.isArray(stored) ? stored.filter((l) => l && (l.size === 'sample' || typeof l.size === 'number')) : [];
  } catch {
    return [];
  }
}

function save(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // tryb prywatny / zablokowany storage – koszyk działa do odświeżenia strony
  }
}

/** Zapis + odświeżenie licznika, panelu i strony koszyka. */
function commit(): void {
  save();
  render();
  listeners.forEach((fn) => fn());
}

export const cartLines = (): readonly CartLine[] => lines;
const count = () => lines.reduce((sum, l) => sum + l.qty, 0);
export const cartSubtotal = () => lines.reduce((sum, l) => sum + l.price * l.qty, 0);

/** Subskrypcja zmian koszyka (strona /koszyk); zwraca funkcję wypisania. */
export function onCartChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const checkoutItems = (): CheckoutItem[] => lines.map((l) => ({ slug: l.slug, size: l.size, qty: l.qty }));

export function cartItems(): AnalyticsItem[] {
  return lines.map((l) => ({
    item_id: l.key,
    item_name: l.name,
    item_brand: 'Perfumowa Aura',
    item_category: 'Perfumy',
    item_variant: l.variant,
    price: l.price,
    quantity: l.qty,
  }));
}

export function addToCart(line: Omit<CartLine, 'qty'>, qty = 1): void {
  const existing = lines.find((l) => l.key === line.key);
  if (existing) existing.qty = Math.min(MAX_QTY, existing.qty + qty);
  else lines.push({ ...line, qty });
  commit();
  announce(`Dodano do koszyka: ${line.name}, ${line.variant}. W koszyku: ${count()} szt.`);
  openCart();
}

/** Po opłaconym zamówieniu (strona podziękowania). */
export function clearCart(): void {
  lines = [];
  commit();
}

/**
 * Kliknięcie w liście pozycji (+, −, Usuń) – w panelu i na stronie koszyka.
 * Zwraca true, gdy kliknięcie zmieniło koszyk.
 */
export function handleLineClick(target: Element): boolean {
  const line = lines.find((l) => l.key === target.closest<HTMLElement>('[data-line]')?.dataset.line);
  if (!line) return false;
  const step = target.closest<HTMLElement>('[data-step]');
  if (step) {
    line.qty = Math.max(1, Math.min(MAX_QTY, line.qty + Number(step.dataset.step)));
  } else if (target.closest('[data-remove]')) {
    lines = lines.filter((l) => l !== line);
    announce(`Usunięto z koszyka: ${line.name}, ${line.variant}.`);
  } else {
    return false;
  }
  commit();
  return true;
}

/** Ceny z bieżącego katalogu – koszyk mógł powstać przed zmianą ceny w panelu. */
function refreshPrices(): void {
  for (const line of lines) {
    const price = line.size === 'sample' ? SHOP.sample.price : getProduct(line.slug)?.sizes.find((s) => s.ml === line.size)?.price;
    if (price !== undefined) line.price = price;
  }
  save();
}

// ---------------------------------------------------------------------------
// Wspólne fragmenty (panel i /koszyk)
// ---------------------------------------------------------------------------

export function linesMarkup(): string {
  return `<ul class="cart-lines">${lines
    .map(
      (l) => `
      <li class="cart-line" data-line="${esc(l.key)}">
        ${l.image ? `<img class="cart-line__img" src="${esc(l.image)}" alt="" width="56" height="84" loading="lazy" />` : '<span class="cart-line__img"></span>'}
        <div class="cart-line__info">
          <p class="cart-line__name"><a href="/perfumy/${esc(l.slug)}" data-drawer-close>${esc(l.name)}</a></p>
          <p class="cart-line__variant">${esc(l.variant)} · ${formatPrice(l.price)}</p>
          <div class="cart-line__actions">
            <div class="stepper" role="group" aria-label="Ilość: ${esc(l.name)}, ${esc(l.variant)}">
              <button type="button" data-step="-1" aria-label="Zmniejsz ilość"${l.qty <= 1 ? ' disabled' : ''}>−</button>
              <span aria-live="polite">${l.qty}</span>
              <button type="button" data-step="1" aria-label="Zwiększ ilość"${l.qty >= MAX_QTY ? ' disabled' : ''}>+</button>
            </div>
            <button type="button" class="cart-line__remove" data-remove>Usuń</button>
          </div>
        </div>
        <p class="cart-line__total">${formatPrice(l.price * l.qty)}</p>
      </li>`,
    )
    .join('')}</ul>`;
}

/** Pasek darmowej dostawy, gratis i suma. */
export function summaryMarkup(): string {
  const total = cartSubtotal();
  const freeFrom = SHOP.freeShippingFrom;
  const missing = freeFrom === null ? 0 : Math.max(0, freeFrom - total);
  const progress = freeFrom ? Math.min(1, total / freeFrom) : 1;
  return `
    ${
      freeFrom === null
        ? ''
        : `<div class="shipping">
      <p>${missing ? `Do darmowej dostawy brakuje <strong>${formatPrice(missing)}</strong>` : 'Masz darmową dostawę'}</p>
      <div class="shipping__bar" aria-hidden="true"><span style="transform:scaleX(${progress.toFixed(3)})"></span></div>
    </div>`
    }
    <p class="drawer__gift">Gratisowe próbki do każdego zamówienia</p>
    <p class="drawer__total"><span>Razem</span><strong>${formatPrice(total)}</strong></p>`;
}

export function legalMarkup(): string {
  const terms = pages.some((p) => p.slug === 'regulamin') ? ' Zamawiając, akceptujesz <a href="/regulamin" data-drawer-close>regulamin sklepu</a>.' : '';
  return `<p class="drawer__legal">Adres, dostawę i sposób płatności podasz w kasie.${terms}</p>`;
}

// ---------------------------------------------------------------------------
// Panel boczny (mini-koszyk po dodaniu produktu)
// ---------------------------------------------------------------------------

/** Wywołać po loadCatalog() – korzysta z cen i listy stron. */
export function initCart(): void {
  root = document.createElement('div');
  root.className = 'drawer';
  root.hidden = true;
  root.innerHTML = `
    <div class="drawer__overlay" data-drawer-close></div>
    <div class="drawer__panel surface-dark" role="dialog" aria-modal="true" aria-labelledby="cart-title" tabindex="-1" data-lenis-prevent>
      <div class="drawer__head">
        <h2 id="cart-title" class="drawer__title">Koszyk</h2>
        <button type="button" class="drawer__close" data-drawer-close aria-label="Zamknij koszyk">${ICON_CLOSE}</button>
      </div>
      <div class="drawer__body" data-cart-body></div>
      <div class="drawer__foot" data-cart-foot></div>
    </div>
    <p class="visually-hidden" role="status" data-cart-live></p>`;
  document.body.append(root);

  root.addEventListener('click', (event) => {
    const target = event.target as Element;
    if (target.closest('[data-drawer-close]')) closeCart();
    else handleLineClick(target);
  });
  root.addEventListener('keydown', onKeydown);
  refreshPrices();
  render();
}

export function openCart(trigger?: HTMLElement): void {
  if (!root || !root.hidden) return;
  // Na stronie koszyka i w kasie panel byłby zbędny – licznik w nagłówku wystarczy.
  if (/^\/(koszyk|kasa)\/?$/.test(window.location.pathname)) return;
  returnFocus = trigger ?? (document.activeElement as HTMLElement | null);
  root.hidden = false;
  lockScroll();
  requestAnimationFrame(() => root?.classList.add('is-open'));
  root.querySelector<HTMLElement>('.drawer__close')?.focus();
  track('open_cart', cartItems());
}

export function closeCart(): void {
  if (!root || root.hidden) return;
  const el = root;
  el.classList.remove('is-open');
  const done = () => {
    el.hidden = true;
    unlockScroll();
  };
  const panel = el.querySelector('.drawer__panel');
  const duration = panel ? parseFloat(getComputedStyle(panel).transitionDuration) * 1000 : 0;
  if (duration > 0) window.setTimeout(done, duration);
  else done();
  returnFocus?.focus({ preventScroll: true });
  returnFocus = null;
}

function announce(message: string): void {
  const live = root?.querySelector('[data-cart-live]');
  if (live) live.textContent = message;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeCart();
    return;
  }
  if (event.key !== 'Tab' || !root) return;
  // Pułapka fokusu w panelu.
  const focusable = [...root.querySelectorAll<HTMLElement>('.drawer__panel button, .drawer__panel a[href]')].filter((el) => !el.hasAttribute('disabled'));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function render(): void {
  document.querySelectorAll('[data-cart-count]').forEach((el) => (el.textContent = String(count())));
  if (!root) return;
  const body = root.querySelector<HTMLElement>('[data-cart-body]')!;
  const foot = root.querySelector<HTMLElement>('[data-cart-foot]')!;

  if (!lines.length) {
    body.innerHTML = `<p class="drawer__empty">Koszyk jest pusty.</p>`;
    foot.innerHTML = `<a class="btn btn--quiet btn--block" href="/perfumy" data-drawer-close>Zobacz perfumy</a>`;
    return;
  }

  body.innerHTML = linesMarkup();
  foot.innerHTML = `
    ${summaryMarkup()}
    <a class="btn btn--primary btn--block" href="/kasa" data-drawer-close>Przejdź do kasy</a>
    <a class="btn btn--link btn--block" href="/koszyk" data-drawer-close>Zobacz koszyk</a>`;
}
