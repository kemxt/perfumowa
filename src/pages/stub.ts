import { products, productUrl } from '../data/products';
import { esc } from '../lib/dom';
import type { Page } from '../router';

/** Etap 1: tymczasowy spis zapachów zamiast strony głównej i listy (dojdą w etapie 2). */
export function stubPage(): Page {
  return {
    title: 'Perfumowa Aura — perfumy niszowe',
    mount(view) {
      view.innerHTML = `
      <main id="main" class="simple-page grid" tabindex="-1">
        <div class="simple-page__inner">
          <p class="eyebrow">Etap 1 · podgląd</p>
          <h1 class="simple-page__title">Kolekcja</h1>
          <p class="simple-page__text">Strona główna i lista perfum powstaną w kolejnym etapie. Na razie wybierz zapach, żeby zobaczyć stronę produktu z etykietą 3D (dodaj <code>?debug</code> do adresu, by kalibrować etykietę).</p>
          <ul class="simple-page__list">
            ${products.map((p) => `<li><a href="${productUrl(p)}">${esc(p.name)}</a> <span>${esc(p.family)}</span></li>`).join('')}
          </ul>
        </div>
      </main>`;
    },
    unmount() {},
  };
}
