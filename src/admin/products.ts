import { slugify, type AdminCategory, type AdminProduct, type AdminProductInput, type AdminProductSummary, type ProductSize } from '../../shared/catalog';
import { formatPrice } from '../data/products';
import { RequestError, api } from './api';
import { uploadFile, uploadPhoto } from './images';
import { esc, formatDate, loadingMarkup, parseNumber, plural, thumbUrl, toast, type View } from './ui';

const STATUS_LABEL = { draft: 'Szkic', published: 'Opublikowany' } as const;

// ===========================================================================
// Lista produktów
// ===========================================================================

export function productListView(): View {
  let products: AdminProductSummary[] = [];
  let categories: AdminCategory[] = [];
  const filter = { q: '', category: '' };
  let root: HTMLElement;

  const categoryName = (id: number | null) => categories.find((c) => c.id === id)?.name ?? '—';

  const visible = () =>
    products.filter((p) => {
      const q = filter.q.trim().toLocaleLowerCase('pl');
      if (q && !p.name.toLocaleLowerCase('pl').includes(q) && !p.slug.includes(q)) return false;
      if (filter.category === 'none') return p.categoryId === null;
      if (filter.category) return String(p.categoryId) === filter.category;
      return true;
    });

  const renderRows = () => {
    const rows = visible();
    const reorderable = !filter.q && !filter.category;
    const body = root.querySelector('[data-rows]')!;
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="7" class="table__empty">${products.length ? 'Nic nie pasuje do filtrów.' : 'Nie ma jeszcze produktów.'}</td></tr>`;
      return;
    }
    body.innerHTML = rows
      .map((p, i) => {
        const prices = p.sizes.map((s) => s.price);
        return `
        <tr>
          <td class="table__order">
            <button type="button" class="icon-btn" data-move="-1" data-id="${p.id}" aria-label="Przesuń ${esc(p.name)} wyżej"${!reorderable || i === 0 ? ' disabled' : ''}>↑</button>
            <button type="button" class="icon-btn" data-move="1" data-id="${p.id}" aria-label="Przesuń ${esc(p.name)} niżej"${!reorderable || i === rows.length - 1 ? ' disabled' : ''}>↓</button>
          </td>
          <td class="table__thumb">${p.thumb ? `<img src="${esc(thumbUrl(p.thumb))}" alt="" width="48" height="60" loading="lazy" />` : '<span class="thumb-empty"></span>'}</td>
          <td>
            <a class="table__name" href="#/produkty/${p.id}">${esc(p.name)}</a>
            <span class="muted small">/perfumy/${esc(p.slug)}</span>
          </td>
          <td>${esc(categoryName(p.categoryId))}</td>
          <td class="nowrap">${p.sizes.length ? `${p.sizes.map((s) => s.ml).join(' · ')} ml` : '<span class="muted">brak</span>'}</td>
          <td class="nowrap">${prices.length ? (prices.length > 1 ? `${formatPrice(Math.min(...prices))} – ${formatPrice(Math.max(...prices))}` : formatPrice(prices[0])) : '—'}</td>
          <td><span class="badge badge--${p.status}">${STATUS_LABEL[p.status]}</span></td>
        </tr>`;
      })
      .join('');
  };

  const onClick = async (event: MouseEvent) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-move]');
    if (!button) return;
    const index = products.findIndex((p) => p.id === Number(button.dataset.id));
    const target = index + Number(button.dataset.move);
    if (index < 0 || target < 0 || target >= products.length) return;
    const previous = products;
    products = [...products];
    [products[index], products[target]] = [products[target], products[index]];
    renderRows();
    root.querySelector<HTMLElement>(`[data-move="${button.dataset.move}"][data-id="${button.dataset.id}"]:not(:disabled)`)?.focus();
    try {
      await api('PUT', 'products/order', { ids: products.map((p) => p.id) });
    } catch (error) {
      products = previous;
      renderRows();
      toast(error instanceof Error ? error.message : 'Nie udało się zmienić kolejności.', 'error');
    }
  };

  const onInput = (event: Event) => {
    const el = event.target as HTMLInputElement | HTMLSelectElement;
    if (el.dataset.filter === 'q') filter.q = el.value;
    else if (el.dataset.filter === 'category') filter.category = el.value;
    else return;
    renderRows();
  };

  return {
    title: 'Produkty',
    async mount(container) {
      root = container;
      container.innerHTML = loadingMarkup;
      [products, categories] = await Promise.all([api<AdminProductSummary[]>('GET', 'products'), api<AdminCategory[]>('GET', 'categories')]);
      const published = products.filter((p) => p.status === 'published').length;
      container.innerHTML = `
        <div class="page-head">
          <div>
            <h1 class="page-title">Produkty</h1>
            <p class="muted">${plural(products.length, ['produkt', 'produkty', 'produktów'])} · ${published} w sklepie</p>
          </div>
          <a class="btn btn--primary" href="#/produkty/nowy">Dodaj produkt</a>
        </div>
        <div class="toolbar">
          <label class="visually-hidden" for="filter-q">Szukaj</label>
          <input id="filter-q" type="search" placeholder="Szukaj po nazwie" data-filter="q" />
          <label class="visually-hidden" for="filter-category">Kategoria</label>
          <select id="filter-category" data-filter="category">
            <option value="">Wszystkie kategorie</option>
            ${categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
            <option value="none">Bez kategorii</option>
          </select>
          <p class="muted small toolbar__hint">Kolejność na liście = kolejność w sklepie.</p>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th scope="col"><span class="visually-hidden">Kolejność</span></th>
                <th scope="col"><span class="visually-hidden">Zdjęcie</span></th>
                <th scope="col">Nazwa</th>
                <th scope="col">Kategoria</th>
                <th scope="col">Pojemności</th>
                <th scope="col">Ceny</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody data-rows></tbody>
          </table>
        </div>`;
      renderRows();
      container.addEventListener('click', (e) => void onClick(e));
      container.addEventListener('input', onInput);
    },
  };
}

// ===========================================================================
// Edytor produktu
// ===========================================================================

const CONCENTRATIONS = ['Eau de Parfum', 'Extrait de Parfum', 'Eau de Toilette', 'Eau de Cologne', 'Perfumy w olejku'];
const LAYERS = [
  ['top', 'Głowa'],
  ['heart', 'Serce'],
  ['base', 'Baza'],
] as const;
const SPECS = [
  ['longevity', 'Trwałość', 'np. 6–8 h'],
  ['sillage', 'Projekcja', 'np. umiarkowana'],
  ['season', 'Pora roku', 'np. wiosna · lato'],
  ['occasion', 'Okazja', 'np. dzień'],
] as const;
type FileKey = 'bottle' | 'label';
const FILE_FIELDS: Record<FileKey, [label: string, hint: string]> = {
  bottle: ['Flakon', 'Wymagany, żeby opublikować produkt.'],
  label: ['Etykieta', 'Cały obwód flakonu minus przerwa (GAP).'],
};
const PALETTE = [
  ['bg', 'Tło'],
  ['fg', 'Tekst'],
  ['liquid', 'Płyn'],
  ['paper', 'Etykieta'],
  ['ink', 'Druk'],
  ['cap', 'Zakrętka'],
] as const;

function emptyProduct(): AdminProductInput {
  return {
    name: '',
    slug: '',
    status: 'draft',
    categoryId: null,
    tagline: '',
    mood: '',
    family: '',
    concentration: 'Eau de Parfum',
    year: new Date().getFullYear(),
    perfumer: '',
    rating: null,
    description: [],
    story: { top: '', heart: '', base: '' },
    notes: { top: [], heart: [], base: [] },
    sizes: [
      { ml: 30, price: NaN },
      { ml: 50, price: NaN },
      { ml: 100, price: NaN },
    ],
    specs: { longevity: '', sillage: '', season: '', occasion: '' },
    palette: { bg: '#D9D4CB', fg: '#1A1A19', liquid: '#EFE9DC', paper: '#F6F2E6', ink: '#1A1A19', cap: '#2B2620' },
    media: { bottle: '', label: '', photos: [] },
  };
}

function toInput(p: AdminProduct): AdminProductInput {
  const { id: _id, position: _position, updatedAt: _updatedAt, ...input } = p;
  return structuredClone(input);
}

const unitPrice = (s: ProductSize) => (s.ml > 0 && Number.isFinite(s.price) ? `${(s.price / s.ml).toFixed(2).replace('.', ',')} zł / ml` : '');

export function productEditorView(id: number | null): View {
  let state = emptyProduct();
  let saved: AdminProduct | null = null;
  let categories: AdminCategory[] = [];
  let dirty = false;
  let saving = false;
  let uploading = 0;
  let slugTouched = id !== null;
  let labelConfigError = '';
  let root: HTMLElement;

  // --- Szablony pól --------------------------------------------------------

  const field = (path: string, label: string, control: string, hint = '') => `
    <div class="field" data-field="${path}">
      <label for="f-${path}">${label}</label>
      ${control}
      ${hint ? `<p class="field__hint">${hint}</p>` : ''}
      <p class="field__error" data-error></p>
    </div>`;

  const text = (path: string, value: string, attrs = '') => `<input id="f-${path}" type="text" data-path="${path}" value="${esc(value)}" ${attrs} />`;
  const area = (path: string, value: string, rows = 3, kind = '') =>
    `<textarea id="f-${path}" data-path="${path}" rows="${rows}"${kind ? ` data-kind="${kind}"` : ''}>${esc(value)}</textarea>`;

  const sizesMarkup = () => `
    ${state.sizes
      .map(
        (s, i) => `
      <div class="size-row" data-field="sizes.${i}">
        <div class="field" data-field="sizes.${i}.ml">
          <label for="f-size-${i}-ml">Pojemność</label>
          <div class="input-unit"><input id="f-size-${i}-ml" type="text" inputmode="numeric" data-size="${i}" data-key="ml" value="${Number.isFinite(s.ml) ? s.ml : ''}" /><span>ml</span></div>
          <p class="field__error" data-error></p>
        </div>
        <div class="field" data-field="sizes.${i}.price">
          <label for="f-size-${i}-price">Cena</label>
          <div class="input-unit"><input id="f-size-${i}-price" type="text" inputmode="decimal" data-size="${i}" data-key="price" value="${Number.isFinite(s.price) ? String(s.price).replace('.', ',') : ''}" /><span>zł</span></div>
          <p class="field__error" data-error></p>
        </div>
        <p class="size-row__unit muted small" data-unit="${i}">${unitPrice(s)}</p>
        <button type="button" class="icon-btn" data-remove-size="${i}" aria-label="Usuń pojemność ${Number.isFinite(s.ml) ? `${s.ml} ml` : ''}">✕</button>
      </div>`,
      )
      .join('')}
    <button type="button" class="btn btn--quiet btn--small" data-add-size>+ Dodaj pojemność</button>`;

  const photosMarkup = () => `
    <ul class="photos">
      ${state.media.photos
        .map(
          (p, i) => `
        <li class="photo" data-field="media.photos.${i}">
          <div class="photo__img${p.cutout ? ' photo__img--cutout' : ''}"><img src="${esc(thumbUrl(p))}" alt="" loading="lazy" /></div>
          ${i === 0 ? '<span class="badge photo__main">Główne</span>' : ''}
          <div class="field" data-field="media.photos.${i}.alt">
            <label for="f-photo-${i}-alt">Opis zdjęcia (alt)</label>
            <input id="f-photo-${i}-alt" type="text" data-photo="${i}" data-key="alt" value="${esc(p.alt)}" />
            <p class="field__error" data-error></p>
          </div>
          <label class="check"><input type="checkbox" data-photo="${i}" data-key="cutout"${p.cutout ? ' checked' : ''} /> Wycięty flakon (przezroczyste tło)</label>
          <div class="photo__actions">
            <button type="button" class="icon-btn" data-move-photo="-1" data-index="${i}" aria-label="Przesuń zdjęcie ${i + 1} w lewo"${i === 0 ? ' disabled' : ''}>←</button>
            <button type="button" class="icon-btn" data-move-photo="1" data-index="${i}" aria-label="Przesuń zdjęcie ${i + 1} w prawo"${i === state.media.photos.length - 1 ? ' disabled' : ''}>→</button>
            <button type="button" class="link-btn link-btn--danger" data-remove-photo="${i}">Usuń</button>
          </div>
        </li>`,
        )
        .join('')}
      ${Array.from({ length: uploading }, () => `<li class="photo photo--pending"><div class="photo__img"><span class="spinner"></span></div><p class="muted small">Wgrywanie…</p></li>`).join('')}
    </ul>
    <label class="dropzone" data-dropzone>
      <input type="file" accept="image/*" multiple data-upload-photos class="visually-hidden" />
      <span><strong>Wybierz zdjęcia</strong> albo upuść je tutaj</span>
      <span class="muted small">JPG, PNG lub WebP. Panel sam zrobi warianty 600 i 1200 px w WebP. Pierwsze zdjęcie jest główne.</span>
    </label>`;

  const fileMarkup = (key: FileKey) => {
    const [label, hint] = FILE_FIELDS[key];
    const value = state.media[key];
    return `
      <div class="file-field" data-field="media.${key}">
        <div class="file-field__preview">${value ? `<img src="${esc(value)}" alt="" />` : '<span class="muted small">brak</span>'}</div>
        <div class="file-field__body">
          <label for="f-media.${key}">${label}</label>
          <input id="f-media.${key}" type="text" data-path="media.${key}" value="${esc(value)}" placeholder="/media/files/…" />
          <p class="field__hint">${hint}</p>
          <p class="field__error" data-error></p>
          <div class="file-field__actions">
            <label class="btn btn--quiet btn--small">Wgraj plik<input type="file" accept="image/png,image/webp,image/svg+xml,image/avif,image/jpeg" class="visually-hidden" data-upload-file="${key}" /></label>
            ${value ? `<button type="button" class="link-btn link-btn--danger" data-clear-file="${key}">Usuń</button>` : ''}
          </div>
        </div>
      </div>`;
  };

  const template = () => {
    const isNew = id === null;
    return `
    <form class="editor" data-editor novalidate>
      <div class="editor__bar">
        <div class="editor__heading">
          <a class="back" href="#/produkty">← Produkty</a>
          <h1 class="page-title" data-title>${esc(state.name || 'Nowy produkt')}</h1>
          <p class="muted small" data-meta>${saved ? `Zapisano ${esc(formatDate(saved.updatedAt))}` : 'Jeszcze niezapisany'}</p>
        </div>
        <div class="editor__actions">
          <span class="dirty muted small" data-dirty hidden>Niezapisane zmiany</span>
          ${saved?.status === 'published' ? `<a class="btn btn--quiet" href="/perfumy/${esc(saved.slug)}" target="_blank" rel="noopener">Zobacz w sklepie ↗</a>` : ''}
          <button type="submit" class="btn btn--primary" data-save>Zapisz</button>
        </div>
      </div>

      <div class="error-summary" data-summary hidden role="alert"></div>

      <div class="editor__grid">
        <div class="editor__main">
          <section class="card">
            <h2 class="card__title">Podstawowe</h2>
            ${field('name', 'Nazwa', text('name', state.name, 'required maxlength="80" autocomplete="off"'))}
            ${field(
              'slug',
              'Adres w sklepie',
              `<div class="input-prefix"><span>/perfumy/</span>${text('slug', state.slug, 'required maxlength="80" autocomplete="off" spellcheck="false"')}</div>`,
              isNew ? 'Tworzy się z nazwy. Małe litery, cyfry i myślniki.' : 'Zmiana adresu zepsuje stare linki do produktu.',
            )}
            <div class="row">
              ${field(
                'tagline',
                'Krótki opis',
                text('tagline', state.tagline, 'maxlength="160"'),
                'Jedno zdanie pod nazwą, np. „Zielona figa na ciepłym, drzewnym tle.”',
              )}
            </div>
            ${field('mood', 'Nastrój', text('mood', state.mood, 'maxlength="200"'), 'np. „Jak popołudnie w śródziemnomorskim ogrodzie.”')}
            ${field(
              'description',
              'Opis',
              area('description', state.description.join('\n\n'), 8, 'paragraphs'),
              'Akapity oddziel pustą linią. Pierwszy akapit jest wyróżniony.',
            )}
          </section>

          <section class="card">
            <h2 class="card__title">Pojemności i ceny</h2>
            <div class="sizes" data-field="sizes">
              <p class="field__error" data-error></p>
              <div data-sizes>${sizesMarkup()}</div>
            </div>
          </section>

          <section class="card">
            <h2 class="card__title">Zdjęcia</h2>
            <div data-field="media.photos"><p class="field__error" data-error></p></div>
            <div data-photos>${photosMarkup()}</div>
          </section>

          <section class="card">
            <h2 class="card__title">Nuty i kompozycja</h2>
            <div class="layers">
              ${LAYERS.map(
                ([key, label]) => `
                <fieldset class="layer">
                  <legend>${label}</legend>
                  ${field(`notes.${key}`, 'Nuty', text(`notes.${key}`, state.notes[key].join(', '), 'data-kind="list"'), 'Po przecinku')}
                  ${field(`story.${key}`, 'Opis warstwy', area(`story.${key}`, state.story[key], 3))}
                </fieldset>`,
              ).join('')}
            </div>
          </section>

          <section class="card">
            <h2 class="card__title">Flakon i etykieta 3D</h2>
            <p class="muted small card__intro">Flakon bez etykiety na przezroczystym tle (PNG/WebP/SVG, najlepiej 800×1200) i rozwinięta etykieta – z nich strona składa obracany flakon.</p>
            ${fileMarkup('bottle')}
            ${fileMarkup('label')}
            <details class="advanced">
              <summary>Kalibracja etykiety (JSON)</summary>
              ${field(
                'labelConfig',
                'Parametry etykiety',
                `<textarea id="f-labelConfig" rows="5" spellcheck="false" class="mono" data-label-config>${esc(state.labelConfig ? JSON.stringify(state.labelConfig, null, 2) : '')}</textarea>`,
                'Skopiuj z panelu kalibracji na stronie produktu (dopisz <code>?debug</code> do adresu) przyciskiem „Kopiuj labelConfig”.',
              )}
            </details>
          </section>
        </div>

        <aside class="editor__side">
          <section class="card">
            <h2 class="card__title">Publikacja</h2>
            <div class="segmented" role="radiogroup" aria-label="Status" data-field="status">
              ${(['draft', 'published'] as const)
                .map(
                  (s) => `<label><input type="radio" name="status" value="${s}" data-path="status"${state.status === s ? ' checked' : ''} /><span>${STATUS_LABEL[s]}</span></label>`,
                )
                .join('')}
            </div>
            <p class="field__hint">Szkic nie jest widoczny w sklepie.</p>
            ${field(
              'categoryId',
              'Kategoria',
              `<select id="f-categoryId" data-path="categoryId" data-kind="id">
                <option value="">— bez kategorii —</option>
                ${categories.map((c) => `<option value="${c.id}"${c.id === state.categoryId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
              </select>`,
              categories.length ? '' : 'Najpierw <a href="#/kategorie">dodaj kategorie</a>.',
            )}
          </section>

          <section class="card">
            <h2 class="card__title">Profil</h2>
            ${field(
              'concentration',
              'Koncentracja',
              `${text('concentration', state.concentration, 'list="concentrations" maxlength="60"')}<datalist id="concentrations">${CONCENTRATIONS.map((c) => `<option value="${c}"></option>`).join('')}</datalist>`,
            )}
            ${field('family', 'Rodzina zapachowa', text('family', state.family, 'maxlength="80"'), 'np. Zielony · drzewny')}
            ${field('perfumer', 'Perfumiarz', text('perfumer', state.perfumer, 'maxlength="80"'))}
            ${field('year', 'Rok premiery', text('year', state.year === null ? '' : String(state.year), 'inputmode="numeric" data-kind="int" maxlength="4"'))}
            ${SPECS.map(([key, label, hint]) => field(`specs.${key}`, label, text(`specs.${key}`, state.specs[key], `maxlength="60" placeholder="${hint}"`))).join('')}
          </section>

          <section class="card">
            <h2 class="card__title">Ocena</h2>
            <label class="check"><input type="checkbox" data-rating-toggle${state.rating ? ' checked' : ''} /> Pokazuj ocenę</label>
            <div class="row row--2" data-rating${state.rating ? '' : ' hidden'}>
              ${field('rating.value', 'Średnia (0–5)', text('rating.value', state.rating ? String(state.rating.value).replace('.', ',') : '', 'inputmode="decimal" data-kind="number"'))}
              ${field('rating.count', 'Liczba opinii', text('rating.count', state.rating ? String(state.rating.count) : '', 'inputmode="numeric" data-kind="int"'))}
            </div>
            <label class="check" data-rating${state.rating ? '' : ' hidden'}><input type="checkbox" data-path="rating.demo" data-kind="bool"${state.rating?.demo ? ' checked' : ''} /> Dane przykładowe (demo)</label>
          </section>

          <section class="card">
            <h2 class="card__title">Kolory</h2>
            <p class="muted small card__intro">Kolory placeholderów flakonu, etykiety i galerii.</p>
            <div class="palette">
              ${PALETTE.map(
                ([key, label]) => `
                <div class="field swatch" data-field="palette.${key}">
                  <input id="f-palette.${key}" type="color" data-path="palette.${key}" value="${esc(state.palette[key].toLowerCase())}" />
                  <label for="f-palette.${key}">${label}</label>
                  <p class="field__error" data-error></p>
                </div>`,
              ).join('')}
            </div>
          </section>

          ${
            isNew
              ? ''
              : `<section class="card card--danger">
                  <h2 class="card__title">Usuwanie</h2>
                  <p class="muted small card__intro">Usuwa produkt, jego ceny i wgrane zdjęcia. Tego nie da się cofnąć.</p>
                  <button type="button" class="btn btn--danger btn--small" data-delete>Usuń produkt</button>
                </section>`
          }
        </aside>
      </div>
    </form>`;
  };

  // --- Stan ----------------------------------------------------------------

  const markDirty = () => {
    dirty = true;
    root.querySelector<HTMLElement>('[data-dirty]')!.hidden = false;
  };

  const setPath = (path: string, value: unknown) => {
    const keys = path.split('.');
    let target = state as unknown as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
    target[keys[keys.length - 1]] = value;
  };

  const readValue = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): unknown => {
    const kind = el.dataset.kind;
    if (kind === 'bool') return (el as HTMLInputElement).checked;
    if (kind === 'list')
      return el.value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    if (kind === 'paragraphs')
      return el.value
        .split(/\n\s*\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    if (kind === 'id') return el.value ? Number(el.value) : null;
    if (kind === 'int' || kind === 'number') {
      const n = parseNumber(el.value);
      return el.value.trim() === '' && el.dataset.path === 'year' ? null : n;
    }
    if (el instanceof HTMLInputElement && el.type === 'color') return el.value.toUpperCase();
    return el.value;
  };

  const rerender = (selector: string, markup: string) => {
    root.querySelector(selector)!.innerHTML = markup;
  };

  // --- Błędy ---------------------------------------------------------------

  const clearErrors = () => {
    root.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
    root.querySelectorAll<HTMLElement>('[data-error]').forEach((el) => (el.textContent = ''));
    root.querySelector<HTMLElement>('[data-summary]')!.hidden = true;
  };

  const showErrors = (message: string, fields: Record<string, string>) => {
    clearErrors();
    const unplaced: string[] = [];
    let first: HTMLElement | null = null;
    for (const [path, error] of Object.entries(fields)) {
      // Pole albo najbliższy rodzic z własnym miejscem na błąd (np. notes.top.3 → notes.top).
      let wrapper: HTMLElement | null = null;
      let slot: HTMLElement | null = null;
      for (let parts = path.split('.'); parts.length && !slot; parts = parts.slice(0, -1)) {
        wrapper = root.querySelector<HTMLElement>(`[data-field="${parts.join('.')}"]`);
        const candidate = wrapper ? [...wrapper.querySelectorAll<HTMLElement>('[data-error]')].find((el) => el.closest('[data-field]') === wrapper) : undefined;
        slot = candidate ?? null;
      }
      if (!wrapper || !slot) {
        unplaced.push(error);
        continue;
      }
      wrapper.classList.add('is-invalid');
      if (!slot.textContent) slot.textContent = error;
      first ??= wrapper;
    }
    // Pola w zwiniętym <details> muszą być widoczne.
    first?.closest('details')?.setAttribute('open', '');
    const summary = root.querySelector<HTMLElement>('[data-summary]')!;
    summary.innerHTML = `<p><strong>${esc(message)}</strong></p>${unplaced.length ? `<ul>${unplaced.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}`;
    summary.hidden = false;
    (first ?? summary).scrollIntoView({ behavior: 'smooth', block: 'center' });
    first?.querySelector<HTMLElement>('input, textarea, select')?.focus({ preventScroll: true });
  };

  // --- Akcje ---------------------------------------------------------------

  const save = async () => {
    if (saving) return;
    if (uploading) return toast('Poczekaj, aż skończy się wgrywanie zdjęć.', 'error');
    if (labelConfigError) return showErrors('Popraw zaznaczone pola.', { labelConfig: labelConfigError });
    saving = true;
    const button = root.querySelector<HTMLButtonElement>('[data-save]')!;
    button.disabled = true;
    button.textContent = 'Zapisywanie…';
    try {
      const result = id === null ? await api<AdminProduct>('POST', 'products', state) : await api<AdminProduct>('PUT', `products/${id}`, state);
      dirty = false;
      toast(result.status === 'published' ? 'Zapisano. Zmiany są już w sklepie.' : 'Zapisano szkic.');
      if (id === null) {
        location.hash = `#/produkty/${result.id}`;
        return;
      }
      saved = result;
      state = toInput(result);
      root.innerHTML = template();
    } catch (error) {
      if (error instanceof RequestError && Object.keys(error.fields).length) showErrors(error.message, error.fields);
      else toast(error instanceof Error ? error.message : 'Nie udało się zapisać.', 'error');
    } finally {
      saving = false;
      const current = root.querySelector<HTMLButtonElement>('[data-save]');
      if (current) {
        current.disabled = false;
        current.textContent = 'Zapisz';
      }
    }
  };

  const remove = async () => {
    if (id === null || !confirm(`Usunąć „${saved?.name ?? state.name}”? Tego nie da się cofnąć.`)) return;
    try {
      await api('DELETE', `products/${id}`);
      dirty = false;
      toast('Produkt usunięty.');
      location.hash = '#/produkty';
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Nie udało się usunąć.', 'error');
    }
  };

  const addPhotos = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    uploading += images.length;
    rerender('[data-photos]', photosMarkup());
    for (const file of images) {
      try {
        const photo = await uploadPhoto(file);
        state.media.photos.push({ ...photo, alt: state.name ? `${state.name} – zdjęcie ${state.media.photos.length + 1}` : '' });
        markDirty();
      } catch (error) {
        toast(error instanceof Error ? error.message : `Nie udało się wgrać ${file.name}.`, 'error');
      } finally {
        uploading--;
        if (root.isConnected) rerender('[data-photos]', photosMarkup());
      }
    }
  };

  const setFile = (key: FileKey, value: string) => {
    state.media[key] = value;
    root.querySelector(`[data-field="media.${key}"]`)!.outerHTML = fileMarkup(key);
    markDirty();
  };

  // --- Zdarzenia -----------------------------------------------------------

  const onInput = (event: Event) => {
    const el = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

    if (el.dataset.path) {
      if (el instanceof HTMLInputElement && el.type === 'radio' && !el.checked) return;
      setPath(el.dataset.path, readValue(el));
      if (el.dataset.path === 'name') {
        root.querySelector('[data-title]')!.textContent = state.name || 'Nowy produkt';
        if (!slugTouched) {
          state.slug = slugify(state.name);
          root.querySelector<HTMLInputElement>('[data-path="slug"]')!.value = state.slug;
        }
      }
      if (el.dataset.path === 'slug') slugTouched = true;
    } else if (el.dataset.size !== undefined) {
      const size = state.sizes[Number(el.dataset.size)];
      size[el.dataset.key as 'ml' | 'price'] = parseNumber(el.value);
      root.querySelector(`[data-unit="${el.dataset.size}"]`)!.textContent = unitPrice(size);
    } else if (el.dataset.photo !== undefined) {
      const photo = state.media.photos[Number(el.dataset.photo)];
      if (el.dataset.key === 'cutout') {
        if ((el as HTMLInputElement).checked) photo.cutout = true;
        else delete photo.cutout;
        el.closest('.photo')?.querySelector('.photo__img')?.classList.toggle('photo__img--cutout', !!photo.cutout);
      } else photo.alt = el.value;
    } else if (el.matches('[data-label-config]')) {
      labelConfigError = '';
      const raw = el.value.trim();
      try {
        const parsed: unknown = raw ? JSON.parse(raw) : undefined;
        if (parsed !== undefined && (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))) throw new Error();
        state.labelConfig = parsed as Record<string, number> | undefined;
      } catch {
        labelConfigError = 'Nieprawidłowy JSON – oczekiwano obiektu, np. { "CYL_TOP": 0.5 }.';
      }
    } else if (el.matches('[data-rating-toggle]')) {
      const on = (el as HTMLInputElement).checked;
      state.rating = on ? (state.rating ?? { value: 5, count: 0 }) : null;
      root.querySelectorAll<HTMLElement>('[data-rating]').forEach((r) => (r.hidden = !on));
      if (on) {
        root.querySelector<HTMLInputElement>('[data-path="rating.value"]')!.value = String(state.rating!.value).replace('.', ',');
        root.querySelector<HTMLInputElement>('[data-path="rating.count"]')!.value = String(state.rating!.count);
      }
    } else if (el.matches('[data-upload-photos]')) {
      const input = el as HTMLInputElement;
      void addPhotos([...(input.files ?? [])]);
      input.value = '';
      return;
    } else if (el.matches('[data-upload-file]')) {
      const input = el as HTMLInputElement;
      const file = input.files?.[0];
      const key = input.dataset.uploadFile as FileKey;
      input.value = '';
      if (!file) return;
      void uploadFile(file)
        .then((url) => setFile(key, url))
        .catch((error: unknown) => toast(error instanceof Error ? error.message : 'Nie udało się wgrać pliku.', 'error'));
      return;
    } else {
      return;
    }
    el.closest('.is-invalid')?.classList.remove('is-invalid');
    markDirty();
  };

  const onClick = (event: MouseEvent) => {
    const target = event.target as Element;
    const button = target.closest<HTMLElement>('button');
    if (!button) return;

    if (button.matches('[data-add-size]')) {
      const largest = Math.max(0, ...state.sizes.map((s) => s.ml).filter(Number.isFinite));
      state.sizes.push({ ml: largest ? largest * 2 : 50, price: NaN });
      rerender('[data-sizes]', sizesMarkup());
      root.querySelector<HTMLInputElement>(`[data-size="${state.sizes.length - 1}"][data-key="price"]`)?.focus();
    } else if (button.dataset.removeSize !== undefined) {
      state.sizes.splice(Number(button.dataset.removeSize), 1);
      rerender('[data-sizes]', sizesMarkup());
    } else if (button.dataset.movePhoto !== undefined) {
      const from = Number(button.dataset.index);
      const to = from + Number(button.dataset.movePhoto);
      const photos = state.media.photos;
      [photos[from], photos[to]] = [photos[to], photos[from]];
      rerender('[data-photos]', photosMarkup());
      root.querySelector<HTMLElement>(`[data-move-photo="${button.dataset.movePhoto}"][data-index="${to}"]:not(:disabled)`)?.focus();
    } else if (button.dataset.removePhoto !== undefined) {
      state.media.photos.splice(Number(button.dataset.removePhoto), 1);
      rerender('[data-photos]', photosMarkup());
    } else if (button.dataset.clearFile) {
      setFile(button.dataset.clearFile as FileKey, '');
      return;
    } else if (button.matches('[data-delete]')) {
      void remove();
      return;
    } else {
      return;
    }
    markDirty();
  };

  const onDrop = (event: DragEvent) => {
    const zone = (event.target as Element).closest('[data-dropzone]');
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove('is-over');
    void addPhotos([...(event.dataTransfer?.files ?? [])]);
  };
  const onDragOver = (event: DragEvent) => {
    const zone = (event.target as Element).closest('[data-dropzone]');
    if (!zone) return;
    event.preventDefault();
    zone.classList.add('is-over');
  };
  const onDragLeave = (event: DragEvent) => (event.target as Element).closest('[data-dropzone]')?.classList.remove('is-over');

  const onKeydown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void save();
    }
  };

  return {
    title: id === null ? 'Nowy produkt' : 'Produkt',
    async mount(container) {
      root = container;
      container.innerHTML = loadingMarkup;
      const [categoryList, product] = await Promise.all([
        api<AdminCategory[]>('GET', 'categories'),
        id === null ? Promise.resolve(null) : api<AdminProduct>('GET', `products/${id}`),
      ]);
      categories = categoryList;
      if (product) {
        saved = product;
        state = toInput(product);
        document.title = `${product.name} · Panel · Perfumowa Aura`;
      }
      container.innerHTML = template();

      container.addEventListener('input', onInput);
      container.addEventListener('change', onInput);
      container.addEventListener('click', onClick);
      container.addEventListener('dragover', onDragOver);
      container.addEventListener('dragleave', onDragLeave);
      container.addEventListener('drop', onDrop);
      container.addEventListener('submit', (event) => {
        event.preventDefault();
        void save();
      });
      document.addEventListener('keydown', onKeydown);
      if (id === null) container.querySelector<HTMLInputElement>('[data-path="name"]')?.focus();
    },
    unmount() {
      document.removeEventListener('keydown', onKeydown);
    },
    canLeave: () => !dirty && !uploading,
  };
}
