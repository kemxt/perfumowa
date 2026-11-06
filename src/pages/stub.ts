import { formatPrice, products, productUrl } from '../data/products';
import { esc } from '../lib/dom';
import type { Page } from '../router';

/** Lista wszystkich zapachów (wersja tekstowa; siatka z flakonami dojdzie w etapie 2). */
export function stubPage(): Page {
  return {
    title: 'Perfumy | Perfumowa Aura',
    mount(view) {
      view.innerHTML = `
      <main id="main" class="simple-page grid surface-dark" tabindex="-1">
        <div class="simple-page__inner">
          <h1 class="t-display">Perfumy</h1>
          <p class="simple-page__text">Sześć kompozycji komponowanych i rozlewanych w Krakowie. Każda dostępna w trzech pojemnościach.</p>
          <ul class="product-list">
            ${products
              .map(
                (p) => `
              <li>
                <a href="${productUrl(p)}">
                  <span class="product-list__name">${esc(p.name)}</span>
                  <span class="product-list__meta">${esc(p.concentration)} · ${esc(p.tagline)}</span>
                  <span class="product-list__price">od ${formatPrice(Math.min(...p.sizes.map((s) => s.price)))}</span>
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
