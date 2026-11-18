import { PHOTO_MIME, PHOTO_WIDTHS, photoUrl } from '../../shared/catalog';
import type { Product, ProductPhoto } from '../data/products';
import { esc, pad2 } from '../lib/dom';

const CHEVRON = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`;

/** <picture> z wariantami 600/1200 w każdym formacie; ostatni format to fallback w <img>. */
function pictureMarkup(photo: ProductPhoto, alt: string, sizes: string): string {
  const srcset = (format: ProductPhoto['formats'][number]) => PHOTO_WIDTHS.map((w) => `${esc(photoUrl(photo, w, format))} ${w}w`).join(', ');
  const fallback = photo.formats[photo.formats.length - 1] ?? 'webp';
  return `<picture>
    ${photo.formats
      .slice(0, -1)
      .map((f) => `<source type="${PHOTO_MIME[f]}" srcset="${srcset(f)}" sizes="${sizes}" />`)
      .join('')}
    <img src="${esc(photoUrl(photo, PHOTO_WIDTHS[PHOTO_WIDTHS.length - 1], fallback))}" srcset="${srcset(fallback)}" sizes="${sizes}"
      alt="${esc(alt)}" width="${photo.width}" height="${photo.height}" loading="lazy" decoding="async" />
  </picture>`;
}

export function galleryMarkup(product: Product, titleId: string): string {
  const images = product.media.photos;
  if (!images.length) return '';
  const total = pad2(images.length);
  return `
    <div class="gallery grid" data-gallery tabindex="0" role="region" aria-roledescription="karuzela" aria-labelledby="${titleId}">
      <div class="gallery__frame">
        ${images
          .map(
            (img, i) => `
          <figure class="gallery__slide${i === 0 ? ' is-active' : ''}${img.cutout ? ' gallery__slide--cutout' : ''}" role="group" aria-roledescription="slajd" aria-label="${i + 1} z ${images.length}" data-slide>
            ${pictureMarkup(img, img.alt, '(min-width: 48rem) 60vw, 100vw')}
          </figure>`,
          )
          .join('')}
      </div>
      <div class="gallery__aside">
        <h2 id="${titleId}" class="label">Galeria</h2>
        <p class="gallery__caption" data-caption>${esc(images[0]?.alt ?? '')}</p>
        <div class="gallery__controls">
          <button type="button" class="icon-btn icon-btn--prev" data-prev aria-label="Poprzednie zdjęcie">${CHEVRON}</button>
          <p class="gallery__count" aria-hidden="true"><span data-current>01</span><span class="gallery__total"> / ${total}</span></p>
          <button type="button" class="icon-btn" data-next aria-label="Następne zdjęcie">${CHEVRON}</button>
        </div>
        <div class="gallery__thumbs" role="group" aria-label="Miniatury">
          ${images
            .map(
              (img, i) => `
            <button type="button" class="gallery__thumb" data-thumb="${i}" aria-label="Pokaż zdjęcie ${i + 1}"${i === 0 ? ' aria-current="true"' : ''}>
              ${pictureMarkup(img, '', '120px')}
            </button>`,
            )
            .join('')}
        </div>
        <p class="gallery__hint">Zdjęcia możesz też przełączać strzałkami <kbd>←</kbd> <kbd>→</kbd></p>
      </div>
      <p class="visually-hidden" aria-live="polite" data-live></p>
    </div>`;
}

function isEditable(el: Element | null): boolean {
  return !!el && (el.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]') || !!el.closest('.lil-gui'));
}

/**
 * Galeria ze strzałkami: działają, gdy galeria ma fokus, oraz globalnie, gdy jest
 * w widoku (i fokus nie stoi w polu formularza). Zwraca funkcję sprzątającą.
 */
export function mountGallery(root: HTMLElement): () => void {
  const slides = [...root.querySelectorAll<HTMLElement>('[data-slide]')];
  const thumbs = [...root.querySelectorAll<HTMLButtonElement>('[data-thumb]')];
  const current = root.querySelector<HTMLElement>('[data-current]')!;
  const caption = root.querySelector<HTMLElement>('[data-caption]')!;
  const live = root.querySelector<HTMLElement>('[data-live]')!;
  let index = 0;
  let inView = false;

  const show = (next: number, announce = true) => {
    const count = slides.length;
    index = ((next % count) + count) % count;
    slides.forEach((s, i) => {
      s.classList.toggle('is-active', i === index);
      s.setAttribute('aria-hidden', String(i !== index));
    });
    thumbs.forEach((t, i) => (i === index ? t.setAttribute('aria-current', 'true') : t.removeAttribute('aria-current')));
    const alt = slides[index].querySelector('img')?.alt ?? '';
    current.textContent = pad2(index + 1);
    caption.textContent = alt;
    if (announce) live.textContent = `Zdjęcie ${index + 1} z ${count}: ${alt}`;
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const focusedInside = root.contains(document.activeElement);
    if (!focusedInside && (!inView || isEditable(document.activeElement))) return;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => show(index - 1),
      ArrowRight: () => show(index + 1),
      ...(focusedInside ? { Home: () => show(0), End: () => show(slides.length - 1) } : {}),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  const onClick = (event: MouseEvent) => {
    const target = event.target as Element;
    if (target.closest('[data-prev]')) show(index - 1);
    else if (target.closest('[data-next]')) show(index + 1);
    else {
      const thumb = target.closest<HTMLElement>('[data-thumb]');
      if (thumb) show(Number(thumb.dataset.thumb));
    }
  };

  const observer = new IntersectionObserver(([entry]) => (inView = entry.isIntersecting), { threshold: 0.4 });
  observer.observe(root.querySelector('.gallery__frame') ?? root);
  root.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  show(0, false);

  return () => {
    observer.disconnect();
    root.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
  };
}
