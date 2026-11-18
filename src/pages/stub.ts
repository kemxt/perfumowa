import { categories, formatPrice, fromPrice, products, productUrl, type Product } from '../data/products';
import { esc } from '../lib/dom';
import type { Page } from '../router';

const listMarkup = (items: Product[]) => `
  <ul class="product-list">
    ${items
      .map(
        (p) => `
      <li>
        <a href="${productUrl(p)}">
          <span class="product-list__name">${esc(p.name)}</span>
          <span class="product-list__meta">${esc(p.concentration)} · ${esc(p.tagline)}</span>
          <span class="product-list__price">od ${formatPrice(fromPrice(p))}</span>
        </a>
      </li>`,
      )
      .join('')}
  </ul>`;

/** Lista wszystkich zapachów pogrupowana według kategorii z panelu (siatka z flakonami dojdzie w etapie 2). */
export function stubPage(): Page {
  const groups = categories
    .map((c) => ({ title: c.name, items: products.filter((p) => p.category === c.slug) }))
    .filter((g) => g.items.length);
  const uncategorized = products.filter((p) => !categories.some((c) => c.slug === p.category));
  if (uncategorized.length) groups.push({ title: groups.length ? 'Pozostałe' : '', items: uncategorized });

  return {
    title: 'Perfumy | Perfumowa Aura',
    mount(view) {
      view.innerHTML = `
      <main id="main" class="simple-page grid surface-dark" tabindex="-1">
        <div class="simple-page__inner">
          <h1 class="t-display">Perfumy</h1>
          <p class="simple-page__text">Kompozycje komponowane i rozlewane w Krakowie, w partiach po kilkaset flakonów.</p>
          ${groups
            .map((g) => (g.title ? `<section class="product-group"><h2 class="label">${esc(g.title)}</h2>${listMarkup(g.items)}</section>` : listMarkup(g.items)))
            .join('')}
        </div>
      </main>`;
    },
    unmount() {},
  };
}
