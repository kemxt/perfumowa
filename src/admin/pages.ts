import { DEFAULT_SETTINGS, slugify, type AdminPage, type AdminPageInput, type ShopSettings } from '../../shared/catalog';
import { CONTENT_FIELDS, renderContent } from '../../shared/content';
import { RequestError, api } from './api';
import { esc, formatDate, loadingMarkup, toast, type View } from './ui';

/** Strony informacyjne: lista i edytor z podglądem (Markdown + pola z ustawień). */

const STRUCTURED_NOTE: Record<string, string> = {
  kontakt: 'Nad treścią strona pokazuje automatycznie e-mail, telefon, godziny obsługi i dane firmy z zakładki Ustawienia.',
  'dostawa-i-platnosci': 'Nad treścią strona pokazuje automatycznie tabelę dostaw, darmową dostawę, czas realizacji, śledzenie przesyłki i metody płatności z zakładki Ustawienia.',
};

/** Pola z ustawień, które wciąż są puste – podpowiedź w edytorze. */
function missingFields(body: string, settings: ShopSettings): string[] {
  return CONTENT_FIELDS.filter((f) => body.includes(`{{${f.key}}}`) && !f.value(settings, location.host).trim()).map((f) => f.label);
}

export function pagesListView(): View {
  return {
    title: 'Strony',
    async mount(container) {
      container.innerHTML = loadingMarkup;
      const pages = await api<AdminPage[]>('GET', 'pages');
      container.innerHTML = `
        <div class="page-head">
          <div>
            <h1 class="page-title">Strony</h1>
            <p class="muted">Kontakt, dostawa i dokumenty sklepu. Opublikowane strony są w stopce sklepu.</p>
          </div>
          <a class="btn btn--primary" href="#/strony/nowa">Dodaj stronę</a>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th scope="col">Tytuł</th><th scope="col">Adres</th><th scope="col">Ostatnia zmiana</th><th scope="col">Status</th></tr></thead>
            <tbody>
              ${pages
                .map(
                  (p) => `
                <tr>
                  <td><a class="table__name" href="#/strony/${p.id}">${esc(p.title)}</a></td>
                  <td class="muted small">/${esc(p.slug)}</td>
                  <td class="muted small nowrap">${esc(formatDate(p.updatedAt))}</td>
                  <td><span class="badge badge--${p.published ? 'published' : 'draft'}">${p.published ? 'Opublikowana' : 'Szkic'}</span></td>
                </tr>`,
                )
                .join('')}
            </tbody>
          </table>
        </div>`;
    },
  };
}

export function pageEditorView(id: number | null): View {
  let state: AdminPageInput = { title: '', slug: '', body: '', published: false };
  let saved: AdminPage | null = null;
  let settings: ShopSettings = DEFAULT_SETTINGS;
  let dirty = false;
  let slugTouched = id !== null;
  let previewTimer = 0;
  let root: HTMLElement;

  const template = () => {
    const system = saved?.system ?? false;
    const missing = missingFields(state.body, settings);
    return `
    <form class="editor" data-editor novalidate>
      <div class="editor__bar">
        <div class="editor__heading">
          <a class="back" href="#/strony">← Strony</a>
          <h1 class="page-title" data-title>${esc(state.title || 'Nowa strona')}</h1>
          <p class="muted small">${saved ? `Zapisano ${esc(formatDate(saved.updatedAt))}` : 'Jeszcze niezapisana'}</p>
        </div>
        <div class="editor__actions">
          <span class="dirty muted small" data-dirty hidden>Niezapisane zmiany</span>
          ${saved?.published ? `<a class="btn btn--quiet" href="/${esc(saved.slug)}" target="_blank" rel="noopener">Zobacz w sklepie ↗</a>` : ''}
          <button type="submit" class="btn btn--primary" data-save>Zapisz</button>
        </div>
      </div>

      <div class="error-summary" data-summary hidden role="alert"></div>

      <div class="page-editor">
        <section class="card">
          <div class="field" data-field="title">
            <label for="f-title">Tytuł</label>
            <input id="f-title" type="text" name="title" value="${esc(state.title)}" maxlength="120" required />
            <p class="field__error" data-error></p>
          </div>
          <div class="field" data-field="slug">
            <label for="f-slug">Adres w sklepie</label>
            <div class="input-prefix"><span>/</span><input id="f-slug" type="text" name="slug" value="${esc(state.slug)}" maxlength="80" spellcheck="false"${system ? ' readonly' : ''} /></div>
            ${system ? '<p class="field__hint">Strona wbudowana – adres jest stały, bo linkują do niej sklep i inne dokumenty.</p>' : ''}
            <p class="field__error" data-error></p>
          </div>
          <div class="segmented" role="radiogroup" aria-label="Status">
            <label><input type="radio" name="published" value="0"${state.published ? '' : ' checked'} /><span>Szkic</span></label>
            <label><input type="radio" name="published" value="1"${state.published ? ' checked' : ''} /><span>Opublikowana</span></label>
          </div>
          ${STRUCTURED_NOTE[state.slug] ? `<p class="note">${STRUCTURED_NOTE[state.slug]}</p>` : ''}
          <div class="field" data-field="body">
            <label for="f-body">Treść</label>
            <textarea id="f-body" name="body" rows="22" class="mono">${esc(state.body)}</textarea>
            <p class="field__error" data-error></p>
          </div>
          <details class="advanced">
            <summary>Formatowanie i pola automatyczne</summary>
            <div class="help">
              <p><code>## Nagłówek</code>, <code>### Podtytuł</code>, <code>**pogrubienie**</code>, <code>[tekst linku](/regulamin)</code>, listy: <code>- punkt</code> lub <code>1. punkt</code>, linia: <code>---</code>. Pusta linia zaczyna nowy akapit.</p>
              <p>Pola wstawiane z zakładki <a href="#/ustawienia">Ustawienia</a>:</p>
              <ul class="help__fields">${CONTENT_FIELDS.map((f) => `<li><code>{{${f.key}}}</code> ${esc(f.label)}</li>`).join('')}</ul>
            </div>
          </details>
          ${
            id !== null && !system
              ? '<div class="danger-row"><button type="button" class="btn btn--danger btn--small" data-delete>Usuń stronę</button></div>'
              : ''
          }
        </section>

        <section class="card preview" aria-labelledby="preview-title">
          <h2 class="card__title" id="preview-title">Podgląd</h2>
          <p class="note note--warn" data-missing${missing.length ? '' : ' hidden'}>Brakuje danych w Ustawieniach: <span data-missing-list>${esc(missing.join(', '))}</span>. Na stronie widać je jako [nawiasy].</p>
          <div class="prose" data-preview>${renderContent(state.body, settings, location.host)}</div>
        </section>
      </div>
    </form>`;
  };

  const markDirty = () => {
    dirty = true;
    root.querySelector<HTMLElement>('[data-dirty]')!.hidden = false;
  };

  const updatePreview = () => {
    root.querySelector('[data-preview]')!.innerHTML = renderContent(state.body, settings, location.host);
    const missing = missingFields(state.body, settings);
    root.querySelector<HTMLElement>('[data-missing]')!.hidden = !missing.length;
    root.querySelector('[data-missing-list]')!.textContent = missing.join(', ');
  };

  const showErrors = (error: unknown) => {
    root.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
    root.querySelectorAll<HTMLElement>('[data-error]').forEach((el) => (el.textContent = ''));
    const summary = root.querySelector<HTMLElement>('[data-summary]')!;
    if (error instanceof RequestError && Object.keys(error.fields).length) {
      for (const [name, message] of Object.entries(error.fields)) {
        const wrapper = root.querySelector<HTMLElement>(`[data-field="${name}"]`);
        wrapper?.classList.add('is-invalid');
        const slot = wrapper?.querySelector('[data-error]');
        if (slot) slot.textContent = message;
      }
      summary.innerHTML = `<p><strong>${esc(error.message)}</strong></p>`;
      summary.hidden = false;
      root.querySelector<HTMLElement>('.is-invalid input, .is-invalid textarea')?.focus();
    } else {
      toast(error instanceof Error ? error.message : 'Nie udało się zapisać.', 'error');
    }
  };

  const save = async () => {
    const button = root.querySelector<HTMLButtonElement>('[data-save]')!;
    button.disabled = true;
    try {
      const result = id === null ? await api<AdminPage>('POST', 'pages', state) : await api<AdminPage>('PUT', `pages/${id}`, state);
      dirty = false;
      toast(result.published ? 'Zapisano. Strona jest w sklepie.' : 'Zapisano szkic.');
      if (id === null) {
        location.hash = `#/strony/${result.id}`;
        return;
      }
      saved = result;
      state = { title: result.title, slug: result.slug, body: result.body, published: result.published };
      root.innerHTML = template();
    } catch (error) {
      showErrors(error);
    } finally {
      const current = root.querySelector<HTMLButtonElement>('[data-save]');
      if (current) current.disabled = false;
    }
  };

  const onInput = (event: Event) => {
    const el = event.target as HTMLInputElement | HTMLTextAreaElement;
    if (el.name === 'title') {
      state.title = el.value;
      root.querySelector('[data-title]')!.textContent = el.value || 'Nowa strona';
      if (!slugTouched) {
        state.slug = slugify(el.value);
        root.querySelector<HTMLInputElement>('[name="slug"]')!.value = state.slug;
      }
    } else if (el.name === 'slug') {
      slugTouched = true;
      state.slug = el.value;
    } else if (el.name === 'published') {
      if (!(el as HTMLInputElement).checked) return;
      state.published = el.value === '1';
    } else if (el.name === 'body') {
      state.body = el.value;
      window.clearTimeout(previewTimer);
      previewTimer = window.setTimeout(updatePreview, 150);
    } else {
      return;
    }
    el.closest('.is-invalid')?.classList.remove('is-invalid');
    markDirty();
  };

  const onClick = async (event: MouseEvent) => {
    if (!(event.target as Element).closest('[data-delete]') || id === null) return;
    if (!confirm(`Usunąć stronę „${saved?.title ?? state.title}”?`)) return;
    try {
      await api('DELETE', `pages/${id}`);
      dirty = false;
      toast('Strona usunięta.');
      location.hash = '#/strony';
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Nie udało się usunąć.', 'error');
    }
  };

  const onKeydown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void save();
    }
  };

  return {
    title: id === null ? 'Nowa strona' : 'Strona',
    async mount(container) {
      root = container;
      container.innerHTML = loadingMarkup;
      const [shopSettings, page] = await Promise.all([api<ShopSettings>('GET', 'settings'), id === null ? Promise.resolve(null) : api<AdminPage>('GET', `pages/${id}`)]);
      settings = shopSettings;
      if (page) {
        saved = page;
        state = { title: page.title, slug: page.slug, body: page.body, published: page.published };
        document.title = `${page.title} · Panel · Perfumowa Aura`;
      }
      container.innerHTML = template();
      container.addEventListener('input', onInput);
      container.addEventListener('change', onInput);
      container.addEventListener('click', (e) => void onClick(e));
      container.addEventListener('submit', (e) => {
        e.preventDefault();
        void save();
      });
      document.addEventListener('keydown', onKeydown);
      if (id === null) container.querySelector<HTMLInputElement>('[name="title"]')?.focus();
    },
    unmount() {
      window.clearTimeout(previewTimer);
      document.removeEventListener('keydown', onKeydown);
    },
    canLeave: () => !dirty,
  };
}
