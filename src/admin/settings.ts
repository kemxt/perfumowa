import { PAYMENT_METHODS, type ShopSettings } from '../../shared/catalog';
import { RequestError, api } from './api';
import { esc, loadingMarkup, parseNumber, toast, type View } from './ui';

/** Ustawienia sklepu: kontakt, dane firmy, dostawa, płatności, zwroty. */
export function settingsView(): View {
  let state: ShopSettings;
  let dirty = false;
  let root: HTMLElement;

  const field = (path: string, label: string, control: string, hint = '') => `
    <div class="field" data-field="${path}">
      <label for="s-${path}">${label}</label>
      ${control}
      ${hint ? `<p class="field__hint">${hint}</p>` : ''}
      <p class="field__error" data-error></p>
    </div>`;
  const input = (path: string, value: string, attrs = '') => `<input id="s-${path}" type="text" data-path="${path}" value="${esc(value)}" ${attrs} />`;
  const area = (path: string, value: string, rows = 3) => `<textarea id="s-${path}" data-path="${path}" rows="${rows}">${esc(value)}</textarea>`;
  const money = (value: number | null) => (value === null || !Number.isFinite(value) ? '' : String(value).replace('.', ','));

  /** Dane, bez których dokumenty prawne mają puste [pola]. */
  const missing = () =>
    [
      ['Nazwa firmy', state.company.name],
      ['Adres firmy', state.company.address],
      ['NIP', state.company.nip],
      ['E-mail', state.contact.email],
    ]
      .filter(([, v]) => !v.trim())
      .map(([k]) => k);

  const methodsMarkup = () => `
    ${state.shipping.methods
      .map(
        (m, i) => `
      <div class="method-row">
        <div class="field" data-field="shipping.methods.${i}.name">
          <label for="s-method-${i}-name">Sposób dostawy</label>
          <input id="s-method-${i}-name" type="text" data-method="${i}" data-key="name" value="${esc(m.name)}" maxlength="80" />
          <p class="field__error" data-error></p>
        </div>
        <div class="field" data-field="shipping.methods.${i}.price">
          <label for="s-method-${i}-price">Koszt</label>
          <div class="input-unit"><input id="s-method-${i}-price" type="text" inputmode="decimal" data-method="${i}" data-key="price" value="${money(m.price)}" /><span>zł</span></div>
          <p class="field__error" data-error></p>
        </div>
        <div class="field" data-field="shipping.methods.${i}.time">
          <label for="s-method-${i}-time">Czas dostawy</label>
          <input id="s-method-${i}-time" type="text" data-method="${i}" data-key="time" value="${esc(m.time)}" maxlength="60" placeholder="np. 1–2 dni robocze" />
          <p class="field__error" data-error></p>
        </div>
        <button type="button" class="icon-btn" data-remove-method="${i}" aria-label="Usuń ${esc(m.name || 'sposób dostawy')}">✕</button>
      </div>`,
      )
      .join('')}
    <button type="button" class="btn btn--quiet btn--small" data-add-method>+ Dodaj sposób dostawy</button>`;

  const paymentsMarkup = () => {
    const all = [...PAYMENT_METHODS, ...state.payments.methods.filter((m) => !PAYMENT_METHODS.includes(m))];
    return `
      <div class="check-grid">
        ${all.map((m) => `<label class="check"><input type="checkbox" data-payment="${esc(m)}"${state.payments.methods.includes(m) ? ' checked' : ''} /> ${esc(m)}</label>`).join('')}
      </div>
      <div class="inline-add">
        <label class="visually-hidden" for="s-payment-new">Inna metoda płatności</label>
        <input id="s-payment-new" type="text" placeholder="Inna metoda, np. PayPo" maxlength="60" data-payment-new />
        <button type="button" class="btn btn--quiet btn--small" data-add-payment>Dodaj</button>
      </div>`;
  };

  const template = () => {
    const gaps = missing();
    return `
    <form class="editor" data-editor novalidate>
      <div class="editor__bar">
        <div class="editor__heading">
          <h1 class="page-title">Ustawienia</h1>
          <p class="muted small">Dane sklepu używane na stronach Kontakt, Dostawa i płatności, w stopce i w dokumentach.</p>
        </div>
        <div class="editor__actions">
          <span class="dirty muted small" data-dirty hidden>Niezapisane zmiany</span>
          <button type="submit" class="btn btn--primary" data-save>Zapisz</button>
        </div>
      </div>

      <div class="error-summary" data-summary hidden role="alert"></div>
      ${gaps.length ? `<p class="note note--warn">Uzupełnij przed publikacją dokumentów prawnych: ${esc(gaps.join(', '))}.</p>` : ''}

      <div class="settings-grid">
        <section class="card">
          <h2 class="card__title">Kontakt</h2>
          ${field('contact.email', 'E-mail', input('contact.email', state.contact.email, 'inputmode="email" autocomplete="off" maxlength="120"'))}
          ${field('contact.phone', 'Telefon', input('contact.phone', state.contact.phone, 'inputmode="tel" maxlength="40"'))}
          ${field('contact.hours', 'Godziny obsługi klienta', area('contact.hours', state.contact.hours, 3), 'Każdy dzień lub zakres w osobnej linii, np. „Poniedziałek–piątek: 9:00–17:00”.')}
        </section>

        <section class="card">
          <h2 class="card__title">Dane firmy</h2>
          <p class="muted small card__intro">Trafiają do regulaminu, polityki prywatności i formularza odstąpienia (pola {{firma}}, {{adres}}, {{nip}}).</p>
          ${field('company.name', 'Nazwa firmy', input('company.name', state.company.name, 'maxlength="160" placeholder="np. Perfumowa Aura Jan Kowalski"'))}
          ${field('company.address', 'Adres', input('company.address', state.company.address, 'maxlength="300" placeholder="ul. Przykładowa 1, 30-001 Kraków"'))}
          <div class="row row--2">
            ${field('company.nip', 'NIP', input('company.nip', state.company.nip, 'maxlength="20" inputmode="numeric"'))}
            ${field('company.regon', 'REGON', input('company.regon', state.company.regon, 'maxlength="20" inputmode="numeric"'))}
          </div>
        </section>

        <section class="card settings-grid__wide">
          <h2 class="card__title">Dostawa</h2>
          <div class="methods" data-field="shipping.methods">
            <p class="field__error" data-error></p>
            <div data-methods>${methodsMarkup()}</div>
          </div>
          <div class="row row--3">
            ${field(
              'shipping.freeFrom',
              'Darmowa dostawa od',
              `<div class="input-unit"><input id="s-shipping.freeFrom" type="text" inputmode="decimal" data-path="shipping.freeFrom" data-kind="money" value="${money(state.shipping.freeFrom)}" /><span>zł</span></div>`,
              'Puste pole = bez darmowej dostawy.',
            )}
            ${field('shipping.processingTime', 'Czas realizacji zamówienia', input('shipping.processingTime', state.shipping.processingTime, 'maxlength="80" placeholder="np. 1–2 dni robocze"'), 'Ile trwa przygotowanie paczki do wysyłki.')}
          </div>
          ${field('shipping.tracking', 'Śledzenie przesyłki', area('shipping.tracking', state.shipping.tracking, 2), 'Jak klient dostaje numer przesyłki i gdzie ją śledzi.')}
        </section>

        <section class="card">
          <h2 class="card__title">Płatności</h2>
          <div data-field="payments.methods"><p class="field__error" data-error></p><div data-payments>${paymentsMarkup()}</div></div>
          ${field('payments.note', 'Dodatkowe informacje', area('payments.note', state.payments.note, 3), 'np. operator płatności, termin zapłaty przy przelewie tradycyjnym.')}
        </section>

        <section class="card">
          <h2 class="card__title">Zwroty</h2>
          ${field(
            'returns.days',
            'Dni na zwrot',
            input('returns.days', String(state.returns.days), 'inputmode="numeric" data-kind="int" maxlength="3"'),
            'Ustawowo co najmniej 14 dni od otrzymania przesyłki. Pokazywane przy produkcie i w dokumentach ({{dni_na_zwrot}}).',
          )}
        </section>
      </div>
    </form>`;
  };

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

  const onInput = (event: Event) => {
    const el = event.target as HTMLInputElement | HTMLTextAreaElement;
    if (el.dataset.path) {
      const kind = el.dataset.kind;
      const value = kind === 'money' ? (el.value.trim() ? parseNumber(el.value) : null) : kind === 'int' ? parseNumber(el.value) : el.value;
      setPath(el.dataset.path, value);
    } else if (el.dataset.method !== undefined) {
      const method = state.shipping.methods[Number(el.dataset.method)];
      if (el.dataset.key === 'price') method.price = parseNumber(el.value);
      else method[el.dataset.key as 'name' | 'time'] = el.value;
    } else if (el.dataset.payment !== undefined) {
      const name = el.dataset.payment;
      const on = (el as HTMLInputElement).checked;
      state.payments.methods = on ? [...new Set([...state.payments.methods, name])] : state.payments.methods.filter((m) => m !== name);
    } else {
      return;
    }
    el.closest('.is-invalid')?.classList.remove('is-invalid');
    markDirty();
  };

  const onClick = (event: MouseEvent) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.matches('[data-add-method]')) {
      state.shipping.methods.push({ name: '', price: NaN, time: '' });
      root.querySelector('[data-methods]')!.innerHTML = methodsMarkup();
      root.querySelector<HTMLInputElement>(`[data-method="${state.shipping.methods.length - 1}"][data-key="name"]`)?.focus();
    } else if (button.dataset.removeMethod !== undefined) {
      state.shipping.methods.splice(Number(button.dataset.removeMethod), 1);
      root.querySelector('[data-methods]')!.innerHTML = methodsMarkup();
    } else if (button.matches('[data-add-payment]')) {
      const field = root.querySelector<HTMLInputElement>('[data-payment-new]')!;
      const name = field.value.trim();
      if (!name) return field.focus();
      state.payments.methods = [...new Set([...state.payments.methods, name])];
      root.querySelector('[data-payments]')!.innerHTML = paymentsMarkup();
    } else {
      return;
    }
    markDirty();
  };

  const showErrors = (error: unknown) => {
    root.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
    root.querySelectorAll<HTMLElement>('[data-error]').forEach((el) => (el.textContent = ''));
    const summary = root.querySelector<HTMLElement>('[data-summary]')!;
    if (!(error instanceof RequestError) || !Object.keys(error.fields).length) {
      toast(error instanceof Error ? error.message : 'Nie udało się zapisać.', 'error');
      return;
    }
    let first: HTMLElement | null = null;
    for (const [path, message] of Object.entries(error.fields)) {
      // Pole albo najbliższy rodzic z miejscem na błąd.
      for (let parts = path.split('.'); parts.length; parts = parts.slice(0, -1)) {
        const wrapper = root.querySelector<HTMLElement>(`[data-field="${parts.join('.')}"]`);
        const slot = wrapper && [...wrapper.querySelectorAll<HTMLElement>('[data-error]')].find((s) => s.closest('[data-field]') === wrapper);
        if (wrapper && slot) {
          wrapper.classList.add('is-invalid');
          slot.textContent ||= message;
          first ??= wrapper;
          break;
        }
      }
    }
    summary.innerHTML = `<p><strong>${esc(error.message)}</strong></p>`;
    summary.hidden = false;
    (first ?? summary).scrollIntoView({ behavior: 'smooth', block: 'center' });
    first?.querySelector<HTMLElement>('input, textarea')?.focus({ preventScroll: true });
  };

  const save = async () => {
    const button = root.querySelector<HTMLButtonElement>('[data-save]')!;
    button.disabled = true;
    try {
      state = await api<ShopSettings>('PUT', 'settings', state);
      dirty = false;
      toast('Zapisano ustawienia. Zmiany są już w sklepie.');
      root.innerHTML = template();
    } catch (error) {
      showErrors(error);
    } finally {
      const current = root.querySelector<HTMLButtonElement>('[data-save]');
      if (current) current.disabled = false;
    }
  };

  const onKeydown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void save();
    }
  };

  return {
    title: 'Ustawienia',
    async mount(container) {
      root = container;
      container.innerHTML = loadingMarkup;
      state = await api<ShopSettings>('GET', 'settings');
      container.innerHTML = template();
      container.addEventListener('input', onInput);
      container.addEventListener('change', onInput);
      container.addEventListener('click', onClick);
      container.addEventListener('submit', (e) => {
        e.preventDefault();
        void save();
      });
      // Enter w polu „Inna metoda” dodaje metodę zamiast wysyłać formularz.
      container.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.target as Element).matches('[data-payment-new]')) {
          e.preventDefault();
          root.querySelector<HTMLButtonElement>('[data-add-payment]')!.click();
        }
      });
      document.addEventListener('keydown', onKeydown);
    },
    unmount() {
      document.removeEventListener('keydown', onKeydown);
    },
    canLeave: () => !dirty,
  };
}
