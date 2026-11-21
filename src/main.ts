import './styles/main.css';
import { categories, loadCatalog, pages, productUrl, products, settings } from './data/products';
import { esc } from './lib/dom';
import { initCart, openCartWithNote } from './lib/cart';
import { initSmoothScroll } from './lib/smooth-scroll';
import { catalogPage } from './pages/catalog';
import { checkoutResultPage } from './pages/checkout';
import { contentPage } from './pages/content';
import { notFoundPage } from './pages/not-found';
import { productPage } from './pages/product';
import { Router } from './router';

initSmoothScroll();

const view = document.getElementById('view');
if (!view) throw new Error('Brak #view w index.html');

try {
  await loadCatalog();
} catch (error) {
  console.error(error);
  view.innerHTML = `
    <main id="main" class="simple-page grid surface-dark" tabindex="-1">
      <div class="simple-page__inner">
        <h1 class="t-display">Chwilowa przerwa</h1>
        <p class="simple-page__text">Nie udało się wczytać listy zapachów. Odśwież stronę za chwilę.</p>
      </div>
    </main>`;
  throw error;
}

/** Stopka z danych z panelu: kategorie, opublikowane strony, kontakt. */
function renderFooter(): void {
  const list = (selector: string, items: string[]) => {
    const el = document.querySelector(selector);
    if (el) el.innerHTML = items.map((item) => `<li>${item}</li>`).join('');
  };
  const link = (href: string, label: string) => `<a href="${esc(href)}">${esc(label)}</a>`;

  list('[data-footer-catalog]', [
    link('/perfumy', 'Wszystkie perfumy'),
    ...categories.filter((c) => products.some((p) => p.category === c.slug)).map((c) => link(`/perfumy?kategoria=${c.slug}`, c.name)),
    ...(products.some((p) => p.isNew) ? [link('/perfumy?nowosci', 'Nowości')] : []),
  ]);
  list(
    '[data-footer-pages]',
    pages.map((p) => link(`/${p.slug}`, p.title)),
  );

  const { contact } = settings;
  list('[data-footer-contact]', [
    contact.email ? `<a href="mailto:${esc(contact.email)}" data-external>${esc(contact.email)}</a>` : '',
    contact.phone ? `<a href="tel:${esc(contact.phone.replace(/[^\d+]/g, ''))}" data-external>${esc(contact.phone)}</a>` : '',
    ...contact.hours
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => `<span class="site-footer__hours">${esc(l.trim())}</span>`),
  ].filter(Boolean));

  document.querySelectorAll<HTMLElement>('[data-hide-without-page]').forEach((el) => {
    el.hidden = !pages.some((p) => p.slug === el.dataset.hideWithoutPage);
  });
}

renderFooter();
initCart();

// Powrót z kasy Stripe bez płatności (cancel_url): czyścimy adres i pokazujemy koszyk.
const search = new URLSearchParams(window.location.search);
const paymentCancelled = search.get('platnosc') === 'anulowana';
if (paymentCancelled) {
  search.delete('platnosc');
  const query = search.toString();
  history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
}

new Router(
  view,
  [
    { path: /^\/perfumy\/([a-z0-9-]+)\/?$/, page: ([slug]) => productPage(slug) },
    // Etap 1: bez strony głównej – start od pierwszego zapachu. Do podmiany w etapie 2.
    { path: /^\/$/, page: () => (products[0] ? productUrl(products[0]) : '/perfumy') },
    { path: /^\/perfumy\/?$/, page: () => catalogPage() },
    { path: /^\/kasa\/dziekujemy\/?$/, page: () => checkoutResultPage() },
    // Strony z panelu: /regulamin, /kontakt, /dostawa-i-platnosci…
    { path: /^\/([a-z0-9-]+)\/?$/, page: ([slug]) => (pages.some((p) => p.slug === slug) ? contentPage(slug) : notFoundPage()) },
  ],
  notFoundPage,
).start();

if (paymentCancelled) openCartWithNote('Płatność została przerwana – nic nie pobraliśmy. Możesz spróbować ponownie.');
