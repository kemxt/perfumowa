import { SEASONS, SEASON_LABEL, type Season } from '../../shared/catalog';
import { mountProductCards, productCardMarkup } from '../components/product-card';
import { categories, getCategory, products, type Product } from '../data/products';
import { esc } from '../lib/dom';
import type { Page } from '../router';

/**
 * Katalog: zakładki (wszystkie / kategorie z panelu / nowości), filtr pory roku
 * i wyszukiwanie po nazwie lub nucie. Stan filtrów żyje w adresie:
 *   /perfumy?kategoria=damskie&pora=zima&q=wanilia, /perfumy?nowosci
 */

interface Filters {
  category: string | null;
  isNew: boolean;
  season: Season | null;
  q: string;
}

const DEFAULT_LEAD = 'Kompozycje komponowane i rozlewane w Krakowie, w partiach po kilkaset flakonów.';

function readFilters(): Filters {
  const params = new URLSearchParams(window.location.search);
  const season = params.get('pora') as Season | null;
  const category = params.get('kategoria');
  return {
    category: category && getCategory(category) ? category : null,
    isNew: params.has('nowosci'),
    season: season && SEASONS.includes(season) ? season : null,
    q: params.get('q')?.trim() ?? '',
  };
}

function toSearch(f: Filters): string {
  const parts: string[] = [];
  if (f.category) parts.push(`kategoria=${encodeURIComponent(f.category)}`);
  if (f.isNew) parts.push('nowosci');
  if (f.season) parts.push(`pora=${f.season}`);
  if (f.q) parts.push(`q=${encodeURIComponent(f.q)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

/** Bez wielkości liter i polskich znaków: „jalowiec” znajdzie „Jałowiec”. */
const fold = (s: string) =>
  s
    .toLocaleLowerCase('pl')
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

function matches(p: Product, f: Filters): boolean {
  if (f.category && p.category !== f.category) return false;
  if (f.isNew && !p.isNew) return false;
  if (f.season && !p.seasons.includes(f.season)) return false;
  if (f.q) {
    const haystack = fold([p.name, p.family, p.tagline, ...p.notes.top, ...p.notes.heart, ...p.notes.base].join(' '));
    return fold(f.q)
      .split(/\s+/)
      .every((word) => haystack.includes(word));
  }
  return true;
}

/** 1 zapach, 2 zapachy, 5 zapachów */
function countLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = n === 1 ? 'zapach' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'zapachy' : 'zapachów';
  return `${n} ${word}`;
}

function heading(f: Filters): { title: string; lead: string } {
  if (f.isNew) return { title: 'Nowości', lead: 'Najnowsze kompozycje w naszej kolekcji.' };
  const category = getCategory(f.category);
  if (category) return { title: category.name, lead: category.description || DEFAULT_LEAD };
  return { title: 'Wszystkie', lead: DEFAULT_LEAD };
}

export function catalogPage(): Page {
  const filters = readFilters();
  const { title, lead } = heading(filters);
  let cleanupCards: () => void = () => {};
  let searchTimer = 0;
  let root: HTMLElement | null = null;

  // Zakładki zachowują porę roku i wyszukiwanie, zmieniają tylko kategorię.
  const tabs = [
    { label: 'Wszystkie', href: toSearch({ ...filters, category: null, isNew: false }), active: !filters.category && !filters.isNew },
    ...categories
      .filter((c) => products.some((p) => p.category === c.slug))
      .map((c) => ({ label: c.name, href: toSearch({ ...filters, category: c.slug, isNew: false }), active: filters.category === c.slug })),
    ...(products.some((p) => p.isNew) ? [{ label: 'Nowości', href: toSearch({ ...filters, category: null, isNew: true }), active: filters.isNew }] : []),
  ];

  const renderResults = () => {
    if (!root) return;
    const results = products.filter((p) => matches(p, filters));
    cleanupCards();
    const list = root.querySelector<HTMLElement>('[data-results]')!;
    list.innerHTML = results.length
      ? results.map((p) => productCardMarkup(p, 2)).join('')
      : `<div class="catalog__empty"><p>Nie znaleźliśmy zapachów dla wybranych filtrów.</p><a class="link" href="/perfumy">Pokaż wszystkie perfumy</a></div>`;
    cleanupCards = mountProductCards(list);
    root.querySelector('[data-count]')!.textContent = countLabel(results.length);
    root.querySelectorAll<HTMLButtonElement>('[data-season]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.season === filters.season)));
    // Filtry bez nowego wpisu w historii – Wstecz wraca do poprzedniej strony, nie do każdej litery.
    history.replaceState(null, '', `/perfumy${toSearch(filters)}`);
  };

  const onClick = (event: MouseEvent) => {
    const chip = (event.target as Element).closest<HTMLButtonElement>('[data-season]');
    if (!chip) return;
    const season = chip.dataset.season as Season;
    filters.season = filters.season === season ? null : season;
    renderResults();
  };

  const onInput = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (!input.matches('[data-q]')) return;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      filters.q = input.value.trim();
      renderResults();
    }, 200);
  };

  return {
    title: `${filters.isNew || filters.category ? `${title} – perfumy` : 'Perfumy'} | Perfumowa Aura`,
    mount(view) {
      view.innerHTML = `
      <main id="main" class="catalog surface-light" tabindex="-1">
        <div class="grid catalog__head">
          <div>
            <p class="label">Katalog</p>
            <h1 class="t-display">Perfumy</h1>
            <p class="catalog__lead">${esc(lead)}</p>
          </div>
        </div>

        <div class="grid catalog__bar">
          <nav class="tabs" aria-label="Kategorie">
            ${tabs.map((t) => `<a class="tabs__link" href="/perfumy${t.href}"${t.active ? ' aria-current="page"' : ''}>${esc(t.label)}</a>`).join('')}
          </nav>
          <div class="catalog__tools">
            <div class="chips" role="group" aria-labelledby="season-label">
              <span class="chips__label" id="season-label">Pora roku</span>
              ${SEASONS.map((s) => `<button type="button" class="chip" data-season="${s}" aria-pressed="${filters.season === s}">${SEASON_LABEL[s]}</button>`).join('')}
            </div>
            <label class="search">
              <span class="visually-hidden">Szukaj po nazwie lub nucie</span>
              <input type="search" data-q value="${esc(filters.q)}" placeholder="Szukaj nuty, np. bergamotka" autocomplete="off" />
            </label>
          </div>
        </div>

        <div class="grid">
          <p class="catalog__count" role="status" data-count></p>
        </div>
        <div class="cards grid catalog__cards" data-results></div>
      </main>`;
      root = view.querySelector<HTMLElement>('main');
      root!.addEventListener('click', onClick);
      root!.addEventListener('input', onInput);
      renderResults();
    },
    unmount() {
      window.clearTimeout(searchTimer);
      cleanupCards();
      root = null;
    },
  };
}
