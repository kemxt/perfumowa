import { track } from '../lib/analytics';
import { cartItems, cartLines, handleLineClick, legalMarkup, linesMarkup, onCartChange, summaryMarkup } from '../lib/cart';
import type { Page } from '../router';

/** /koszyk – pełny widok koszyka z podsumowaniem i przejściem do kasy. */
export function cartPage(): Page {
  let unsubscribe = () => {};

  return {
    title: 'Koszyk | Perfumowa Aura',
    mount(view) {
      view.innerHTML = `
      <main id="main" class="shop-page grid surface-dark" tabindex="-1">
        <div class="shop-page__inner">
          <h1 class="t-h2 shop-page__title">Koszyk</h1>
          <div data-cart-page></div>
        </div>
      </main>`;
      const box = view.querySelector<HTMLElement>('[data-cart-page]')!;

      const render = () => {
        if (!cartLines().length) {
          box.innerHTML = `
            <p class="shop-page__text">Koszyk jest pusty.</p>
            <a class="btn btn--quiet" href="/perfumy">Zobacz perfumy</a>`;
          return;
        }
        box.innerHTML = `
          <div class="cart-page">
            <section class="cart-page__lines" aria-label="Produkty w koszyku">${linesMarkup()}</section>
            <aside class="cart-page__summary" aria-label="Podsumowanie">
              ${summaryMarkup()}
              <a class="btn btn--primary btn--block" href="/kasa">Przejdź do kasy</a>
              ${legalMarkup()}
              <a class="btn btn--link btn--block" href="/perfumy">Kontynuuj zakupy</a>
            </aside>
          </div>`;
      };

      box.addEventListener('click', (event) => handleLineClick(event.target as Element));
      unsubscribe = onCartChange(render);
      render();
      track('view_cart', cartItems());
    },
    unmount() {
      unsubscribe();
    },
  };
}
