import { products, productUrl } from '../data/products';
import { esc } from '../lib/dom';
import type { Page } from '../router';

export function notFoundPage(): Page {
  return {
    title: 'Nie znaleziono | Perfumowa Aura',
    mount(view) {
      view.innerHTML = `
      <main id="main" class="simple-page grid" tabindex="-1">
        <div class="simple-page__inner">
          <p class="eyebrow">404</p>
          <h1 class="simple-page__title">Ten zapach się ulotnił</h1>
          <p class="simple-page__text">Nie znaleźliśmy tej strony. Może któryś z naszych zapachów?</p>
          <ul class="simple-page__list">
            ${products.map((p) => `<li><a href="${productUrl(p)}">${esc(p.name)}</a></li>`).join('')}
          </ul>
        </div>
      </main>`;
    },
    unmount() {},
  };
}
