import { gsap } from 'gsap';
import { formatPrice, getProduct, productUrl, type Product } from '../data/products';
import type { BottleLabel } from '../lib/bottle-label';
import { esc } from '../lib/dom';
import { prefersReducedMotion } from '../lib/motion';
import { bottleMarkup, mountBottle } from './bottle';

export function productCardMarkup(product: Product, headingLevel: 2 | 3 = 3): string {
  const from = Math.min(...product.sizes.map((s) => s.price));
  const h = `h${headingLevel}`;
  return `
    <article class="card" data-card="${esc(product.slug)}">
      <a class="card__link" href="${productUrl(product)}">
        <div class="card__stage">
          ${bottleMarkup(product, { variant: 'card', alt: '' })}
        </div>
        <div class="card__body">
          <${h} class="card__title">${esc(product.name)}</${h}>
          <p class="card__meta">${esc(product.concentration)} · ${esc(product.family.toLocaleLowerCase('pl'))}</p>
          <p class="card__price">od ${formatPrice(from)}</p>
        </div>
      </a>
    </article>`;
}

const HOVER_SPIN = 0.16;

/**
 * Montuje etykiety 3D w kartach (leniwie, gdy karta zbliża się do viewportu)
 * i lekki spin etykiety na hover/focus. Zwraca funkcję sprzątającą.
 */
export function mountProductCards(root: ParentNode): () => void {
  const cards = [...root.querySelectorAll<HTMLElement>('[data-card]')];
  const labels = new Map<HTMLElement, BottleLabel>();
  const states = new Map<HTMLElement, { offset: number }>();
  const listeners: [EventTarget, string, EventListener][] = [];

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const card = entry.target as HTMLElement;
        observer.unobserve(card);
        const product = getProduct(card.dataset.card ?? '');
        const figure = card.querySelector<HTMLElement>('[data-bottle]');
        if (product && figure) labels.set(card, mountBottle(figure, product));
      }
    },
    { rootMargin: '300px 0px' },
  );

  const spinTo = (card: HTMLElement, value: number, duration: number) => {
    const label = labels.get(card);
    const state = states.get(card);
    if (!label || !state || prefersReducedMotion()) return;
    gsap.to(state, {
      offset: value,
      duration,
      ease: 'power3.out',
      overwrite: true,
      onUpdate: () => label.setOffset(state.offset),
    });
  };

  for (const card of cards) {
    observer.observe(card);
    states.set(card, { offset: 0 });
    const link = card.querySelector('a') ?? card;
    const on = (type: string, fn: EventListener) => {
      link.addEventListener(type, fn);
      listeners.push([link, type, fn]);
    };
    on('pointerenter', (e) => (e as PointerEvent).pointerType !== 'touch' && spinTo(card, HOVER_SPIN, 1.1));
    on('pointerleave', (e) => (e as PointerEvent).pointerType !== 'touch' && spinTo(card, 0, 1.4));
    on('focus', () => spinTo(card, HOVER_SPIN, 1.1));
    on('blur', () => spinTo(card, 0, 1.4));
  }

  return () => {
    observer.disconnect();
    listeners.forEach(([target, type, fn]) => target.removeEventListener(type, fn));
    states.forEach((state) => gsap.killTweensOf(state));
    labels.forEach((label) => label.dispose());
    labels.clear();
  };
}
