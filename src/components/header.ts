import { esc } from '../lib/dom';

export interface HeaderLink {
  href: string;
  label: string;
}

export interface HeaderContext {
  /** Druga część identyfikatora obok marki, np. nazwa zapachu. */
  sub?: string;
  links?: HeaderLink[];
  cta?: HeaderLink;
}

const DEFAULT_LINKS: HeaderLink[] = [
  { href: '/', label: 'Kolekcja' },
  { href: '/perfumy', label: 'Perfumy' },
];

/** Strony podmieniają zawartość pływającego nagłówka (np. kotwice sekcji produktu). */
export function setHeader({ sub, links = DEFAULT_LINKS, cta }: HeaderContext = {}): void {
  const subEl = document.querySelector<HTMLElement>('[data-header-sub]');
  const nav = document.querySelector<HTMLElement>('[data-header-nav]');
  const ctaEl = document.querySelector<HTMLAnchorElement>('[data-header-cta]');
  const ctaLabel = document.querySelector<HTMLElement>('[data-header-cta-label]');

  if (subEl) {
    subEl.textContent = sub ?? '';
    subEl.hidden = !sub;
  }
  if (nav) {
    nav.innerHTML = links.map((l) => `<li><a href="${esc(l.href)}" data-nav>${esc(l.label)}</a></li>`).join('');
  }
  if (ctaEl && ctaLabel) {
    ctaEl.hidden = !cta;
    if (cta) {
      ctaEl.href = cta.href;
      ctaLabel.textContent = cta.label;
    }
  }
}
