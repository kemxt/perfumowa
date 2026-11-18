import { slugify, type AdminCategory, type AdminCategoryInput } from '../../shared/catalog';
import { RequestError, api } from './api';
import { esc, loadingMarkup, plural, toast, type View } from './ui';

/** Kategorie: dodawanie, edycja w wierszu, kolejność, usuwanie. */
export function categoriesView(): View {
  let categories: AdminCategory[] = [];
  let editing: number | null = null;
  let root: HTMLElement;

  const formFields = (prefix: string, c: AdminCategoryInput) => `
    <div class="field" data-field="name">
      <label for="${prefix}-name">Nazwa</label>
      <input id="${prefix}-name" name="name" type="text" value="${esc(c.name)}" required maxlength="80" autocomplete="off" />
      <p class="field__error" data-error></p>
    </div>
    <div class="field" data-field="slug">
      <label for="${prefix}-slug">Adres</label>
      <input id="${prefix}-slug" name="slug" type="text" value="${esc(c.slug)}" required maxlength="80" spellcheck="false" autocomplete="off" />
      <p class="field__error" data-error></p>
    </div>
    <div class="field field--wide" data-field="description">
      <label for="${prefix}-description">Opis <span class="muted">(opcjonalnie)</span></label>
      <input id="${prefix}-description" name="description" type="text" value="${esc(c.description)}" maxlength="500" />
      <p class="field__error" data-error></p>
    </div>`;

  const itemMarkup = (c: AdminCategory, i: number) => {
    if (editing === c.id) {
      return `
      <li class="cat cat--editing">
        <form class="cat__form" data-edit-form="${c.id}" novalidate>
          ${formFields(`cat-${c.id}`, c)}
          <div class="cat__form-actions">
            <button type="submit" class="btn btn--primary btn--small">Zapisz</button>
            <button type="button" class="btn btn--quiet btn--small" data-cancel>Anuluj</button>
          </div>
        </form>
      </li>`;
    }
    return `
      <li class="cat">
        <div class="cat__order">
          <button type="button" class="icon-btn" data-move="-1" data-id="${c.id}" aria-label="Przesuń ${esc(c.name)} wyżej"${i === 0 ? ' disabled' : ''}>↑</button>
          <button type="button" class="icon-btn" data-move="1" data-id="${c.id}" aria-label="Przesuń ${esc(c.name)} niżej"${i === categories.length - 1 ? ' disabled' : ''}>↓</button>
        </div>
        <div class="cat__body">
          <p class="cat__name">${esc(c.name)}</p>
          <p class="muted small">${esc(c.slug)} · ${plural(c.productCount, ['produkt', 'produkty', 'produktów'])}</p>
          ${c.description ? `<p class="cat__desc">${esc(c.description)}</p>` : ''}
        </div>
        <div class="cat__actions">
          <button type="button" class="btn btn--quiet btn--small" data-edit="${c.id}">Edytuj</button>
          <button type="button" class="link-btn link-btn--danger" data-delete="${c.id}">Usuń</button>
        </div>
      </li>`;
  };

  const renderList = () => {
    root.querySelector('[data-list]')!.innerHTML = categories.length
      ? categories.map(itemMarkup).join('')
      : `<li class="table__empty">Nie ma jeszcze kategorii.</li>`;
  };

  const readForm = (form: HTMLFormElement): AdminCategoryInput => {
    const data = new FormData(form);
    return { name: String(data.get('name') ?? ''), slug: String(data.get('slug') ?? ''), description: String(data.get('description') ?? '') };
  };

  const showErrors = (form: HTMLFormElement, error: unknown) => {
    form.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
    form.querySelectorAll<HTMLElement>('[data-error]').forEach((el) => (el.textContent = ''));
    if (error instanceof RequestError && Object.keys(error.fields).length) {
      for (const [name, message] of Object.entries(error.fields)) {
        const wrapper = form.querySelector<HTMLElement>(`[data-field="${name}"]`);
        wrapper?.classList.add('is-invalid');
        const slot = wrapper?.querySelector('[data-error]');
        if (slot) slot.textContent = message;
      }
      form.querySelector<HTMLElement>('.is-invalid input')?.focus();
    } else {
      toast(error instanceof Error ? error.message : 'Nie udało się zapisać.', 'error');
    }
  };

  const onSubmit = async (event: SubmitEvent) => {
    const form = event.target as HTMLFormElement;
    event.preventDefault();
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    button.disabled = true;
    try {
      if (form.matches('[data-new]')) {
        categories = await api<AdminCategory[]>('POST', 'categories', readForm(form));
        form.reset();
        newSlugTouched = false;
        toast('Dodano kategorię.');
      } else {
        categories = await api<AdminCategory[]>('PUT', `categories/${form.dataset.editForm}`, readForm(form));
        editing = null;
        toast('Zapisano kategorię.');
      }
      renderList();
    } catch (error) {
      showErrors(form, error);
    } finally {
      button.disabled = false;
    }
  };

  const onClick = async (event: MouseEvent) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.dataset.edit) {
      editing = Number(button.dataset.edit);
      renderList();
      root.querySelector<HTMLInputElement>('[data-edit-form] input')?.focus();
    } else if (button.matches('[data-cancel]')) {
      editing = null;
      renderList();
    } else if (button.dataset.delete) {
      const category = categories.find((c) => c.id === Number(button.dataset.delete));
      if (!category) return;
      const note = category.productCount ? ` ${plural(category.productCount, ['produkt zostanie', 'produkty zostaną', 'produktów zostanie'])} bez kategorii.` : '';
      if (!confirm(`Usunąć kategorię „${category.name}”?${note}`)) return;
      try {
        categories = await api<AdminCategory[]>('DELETE', `categories/${category.id}`);
        renderList();
        toast('Kategoria usunięta.');
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Nie udało się usunąć.', 'error');
      }
    } else if (button.dataset.move) {
      const index = categories.findIndex((c) => c.id === Number(button.dataset.id));
      const target = index + Number(button.dataset.move);
      if (index < 0 || target < 0 || target >= categories.length) return;
      const ids = categories.map((c) => c.id);
      [ids[index], ids[target]] = [ids[target], ids[index]];
      try {
        categories = await api<AdminCategory[]>('PUT', 'categories/order', { ids });
        renderList();
        root.querySelector<HTMLElement>(`[data-move="${button.dataset.move}"][data-id="${button.dataset.id}"]:not(:disabled)`)?.focus();
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Nie udało się zmienić kolejności.', 'error');
      }
    }
  };

  // Adres nowej kategorii tworzy się z nazwy, dopóki nie zostanie zmieniony ręcznie.
  let newSlugTouched = false;
  const onInput = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const form = input.form;
    input.closest('.is-invalid')?.classList.remove('is-invalid');
    if (!form?.matches('[data-new]')) return;
    if (input.name === 'slug') newSlugTouched = true;
    if (input.name === 'name' && !newSlugTouched) form.querySelector<HTMLInputElement>('[name="slug"]')!.value = slugify(input.value);
  };

  return {
    title: 'Kategorie',
    async mount(container) {
      root = container;
      container.innerHTML = loadingMarkup;
      categories = await api<AdminCategory[]>('GET', 'categories');
      container.innerHTML = `
        <div class="page-head">
          <div>
            <h1 class="page-title">Kategorie</h1>
            <p class="muted">Grupują zapachy na liście w sklepie. Kolejność tutaj = kolejność w sklepie.</p>
          </div>
        </div>
        <section class="card">
          <h2 class="card__title">Nowa kategoria</h2>
          <form class="cat__form" data-new novalidate>
            ${formFields('cat-new', { name: '', slug: '', description: '' })}
            <div class="cat__form-actions"><button type="submit" class="btn btn--primary btn--small">Dodaj kategorię</button></div>
          </form>
        </section>
        <ul class="cats" data-list></ul>`;
      renderList();
      container.addEventListener('submit', (e) => void onSubmit(e));
      container.addEventListener('click', (e) => void onClick(e));
      container.addEventListener('input', onInput);
    },
  };
}
