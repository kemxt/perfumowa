import './styles/main.css';
import { loadCatalog, productUrl, products } from './data/products';
import { esc } from './lib/dom';
import { initSmoothScroll } from './lib/smooth-scroll';
import { notFoundPage } from './pages/not-found';
import { productPage } from './pages/product';
import { stubPage } from './pages/stub';
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

const footerList = document.querySelector('[data-footer-products]');
if (footerList) {
  footerList.innerHTML = products.map((p) => `<li><a href="${productUrl(p)}">${esc(p.name)}</a></li>`).join('');
}

new Router(
  view,
  [
    { path: /^\/perfumy\/([a-z0-9-]+)\/?$/, page: ([slug]) => productPage(slug) },
    // Etap 1: bez strony głównej – start od pierwszego zapachu. Do podmiany w etapie 2.
    { path: /^\/$/, page: () => (products[0] ? productUrl(products[0]) : '/perfumy') },
    { path: /^\/perfumy\/?$/, page: () => stubPage() },
  ],
  notFoundPage,
).start();
