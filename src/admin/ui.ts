import { photoUrl, type ProductPhoto } from '../../shared/catalog';

export { esc } from '../lib/dom';

export interface View {
  title: string;
  mount(container: HTMLElement): void | Promise<void>;
  unmount?(): void;
  /** false = niezapisane zmiany; router zapyta, czy na pewno wyjść. */
  canLeave?(): boolean;
}

let toastRoot: HTMLElement | null = null;

export function toast(message: string, kind: 'ok' | 'error' = 'ok'): void {
  if (!toastRoot) {
    toastRoot = document.createElement('div');
    toastRoot.className = 'toasts';
    toastRoot.setAttribute('role', 'status');
    toastRoot.setAttribute('aria-live', 'polite');
    document.body.append(toastRoot);
  }
  const el = document.createElement('p');
  el.className = `toast toast--${kind}`;
  el.textContent = message;
  toastRoot.append(el);
  window.setTimeout(() => el.remove(), kind === 'error' ? 7000 : 3500);
}

/** plural(3, ['produkt', 'produkty', 'produktów']) → „3 produkty” */
export function plural(n: number, [one, few, many]: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = n === 1 ? one : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
  return `${n} ${word}`;
}

/** Miniatura: wariant 600 px w formacie, który na pewno istnieje (ostatni na liście). */
export const thumbUrl = (photo: ProductPhoto) => photoUrl(photo, 600, photo.formats[photo.formats.length - 1] ?? 'webp');

/** Liczba z pola (przecinek też jako separator dziesiętny); puste pole → NaN. */
export const parseNumber = (value: string) => (value.trim() === '' ? NaN : Number(value.trim().replace(/\s/g, '').replace(',', '.')));

/** SQLite zapisuje czas w UTC jako „2026-11-18 15:03:05”. */
export function formatDate(sqlite: string): string {
  const date = new Date(`${sqlite.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? sqlite : date.toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });
}

export const loadingMarkup = `<p class="muted loading">Wczytywanie…</p>`;
