import type { Product } from '../data/products';
import { BottleLabel } from '../lib/bottle-label';
import { esc } from '../lib/dom';

interface BottleMarkupOptions {
  variant: 'hero' | 'card' | 'buy';
  alt?: string;
  eager?: boolean;
}

/** <figure> z <img> flakonu; canvas z etykietą dokłada BottleLabel przy montowaniu. */
export function bottleMarkup(product: Product, { variant, alt, eager = false }: BottleMarkupOptions): string {
  const altText = alt ?? `Flakon perfum ${product.name} – ${product.concentration}`;
  return `
    <figure class="bottle bottle--${variant}" data-bottle="${esc(product.slug)}">
      <img class="bottle__img" src="${esc(product.media.bottle)}" alt="${esc(altText)}" width="800" height="1200"
        decoding="async" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} />
    </figure>`;
}

export function mountBottle(figure: HTMLElement, product: Product): BottleLabel {
  const image = figure.querySelector('img');
  if (!image) throw new Error('Flakon bez <img>');
  return new BottleLabel({
    container: figure,
    image,
    labelSrc: product.media.label,
    config: product.labelConfig,
  });
}
