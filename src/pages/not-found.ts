import { products, productUrl } from '../data/products';
import { esc } from '../lib/dom';
import type { Page } from '../router';

export function notFoundPage(): Page {
  return {
    title: 'Nie znaleziono strony | Perfumowa Aura',
    mount(view) {
      view.innerHTML = `
      <main id="main" class="simple-page grid surface-dark" tabindex="-1">
        <div class="simple-page__inner">
          <p class="label">Błąd 404</p>
          <h1 class="t-display">Nie znaleziono strony</h1>
          <p class="simple-page__text">Adres mógł się zmienić albo strona została usunięta. Wybierz jeden z zapachów poniżej.</p>
          <ul class="product-list">
            ${products
              .map(
                (p) => `
              <li>
                <a href="${productUrl(p)}">
                  <span class="product-list__name">${esc(p.name)}</span>
                  <span class="product-list__meta">${esc(p.tagline)}</span>
                </a>
              </li>`,
              )
              .join('')}
          </ul>
        </div>
      </main>`;
    },
    unmount() {},
  };
}
