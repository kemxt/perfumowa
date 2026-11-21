import {
  MANUAL_STATUSES,
  ORDER_STATUS_LABEL,
  isManualStatus,
  type AdminOrder,
  type AdminOrderInput,
  type AdminOrderList,
  type AdminOrderSummary,
  type OrderStatus,
  type PaymentsStatus,
} from '../../shared/orders';
import { formatPrice } from '../data/products';
import { api } from './api';
import { esc, formatDate, loadingMarkup, plural, toast, type View } from './ui';

/** Zamówienia ze sklepu (Stripe Checkout): lista z filtrami i szczegóły ze zmianą statusu. */

const BADGE: Record<OrderStatus, string> = {
  pending: '',
  paid: 'badge--todo',
  shipped: 'badge--published',
  cancelled: '',
  failed: 'badge--out',
  expired: '',
};

const badge = (status: OrderStatus) => `<span class="badge ${BADGE[status]}">${ORDER_STATUS_LABEL[status]}</span>`;

const FILTERS: { value: string; label: string; statuses: OrderStatus[] }[] = [
  { value: '', label: 'Opłacone', statuses: ['paid', 'shipped', 'cancelled'] },
  { value: 'paid', label: 'Do wysłania', statuses: ['paid'] },
  { value: 'shipped', label: 'Wysłane', statuses: ['shipped'] },
  { value: 'cancelled', label: 'Anulowane', statuses: ['cancelled'] },
  { value: 'unpaid', label: 'Nieopłacone i porzucone', statuses: ['pending', 'failed', 'expired'] },
  { value: 'all', label: 'Wszystkie', statuses: ['pending', 'paid', 'shipped', 'cancelled', 'failed', 'expired'] },
];

function paymentsNote(payments: PaymentsStatus): string {
  if (!payments.ready) {
    return `<p class="note note--warn">Płatności są wyłączone: Worker nie ma klucza Stripe. Ustaw go poleceniem <code>npx wrangler secret put STRIPE_SECRET_KEY</code> – do tego czasu kasa w sklepie pokazuje „Płatności nie są jeszcze włączone”.</p>`;
  }
  const notes: string[] = [];
  if (!payments.webhook) {
    notes.push(
      `<p class="note note--warn">Brak sekretu webhooka (<code>STRIPE_WEBHOOK_SECRET</code>). Zamówienia oznaczą się jako opłacone dopiero, gdy klient wróci ze Stripe na stronę podziękowania – płatności odroczone i porzucone kasy nie zaktualizują się same.</p>`,
    );
  }
  if (payments.mode === 'test') notes.push('<p class="note">Stripe w trybie testowym – płatności nie są prawdziwe (karta testowa 4242 4242 4242 4242).</p>');
  return notes.join('');
}

export function ordersListView(): View {
  let orders: AdminOrderSummary[] = [];
  const filter = { q: '', status: '' };
  let root: HTMLElement;

  const visible = () => {
    const statuses = (FILTERS.find((f) => f.value === filter.status) ?? FILTERS[0]).statuses;
    const q = filter.q.trim().toLocaleLowerCase('pl');
    return orders.filter((o) => statuses.includes(o.status) && (!q || [o.number, o.name, o.email].some((v) => v.toLocaleLowerCase('pl').includes(q))));
  };

  const renderRows = () => {
    const rows = visible();
    const body = root.querySelector('[data-rows]')!;
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="6" class="table__empty">${orders.length ? 'Nic nie pasuje do filtrów.' : 'Nie ma jeszcze zamówień.'}</td></tr>`;
      return;
    }
    body.innerHTML = rows
      .map(
        (o) => `
        <tr>
          <td><a class="table__name" href="#/zamowienia/${o.id}">${esc(o.number)}</a></td>
          <td class="muted small nowrap">${esc(formatDate(o.paidAt ?? o.createdAt))}</td>
          <td>${o.name || o.email ? `${esc(o.name || '—')}<br /><span class="muted small">${esc(o.email)}</span>` : '<span class="muted">—</span>'}</td>
          <td class="nowrap">${plural(o.itemCount, ['sztuka', 'sztuki', 'sztuk'])}</td>
          <td class="nowrap">${formatPrice(o.total ?? o.subtotal)}</td>
          <td>${badge(o.status)}</td>
        </tr>`,
      )
      .join('');
  };

  const onInput = (event: Event) => {
    const el = event.target as HTMLInputElement | HTMLSelectElement;
    if (el.dataset.filter === 'q') filter.q = el.value;
    else if (el.dataset.filter === 'status') filter.status = el.value;
    else return;
    renderRows();
  };

  return {
    title: 'Zamówienia',
    async mount(container) {
      root = container;
      container.innerHTML = loadingMarkup;
      const list = await api<AdminOrderList>('GET', 'orders');
      orders = list.orders;
      const toShip = orders.filter((o) => o.status === 'paid').length;
      container.innerHTML = `
        <div class="page-head">
          <div>
            <h1 class="page-title">Zamówienia</h1>
            <p class="muted">${toShip ? `${plural(toShip, ['zamówienie', 'zamówienia', 'zamówień'])} do wysłania` : 'Nic nie czeka na wysyłkę'}</p>
          </div>
        </div>
        ${paymentsNote(list.payments)}
        <div class="toolbar">
          <label class="visually-hidden" for="filter-q">Szukaj</label>
          <input id="filter-q" type="search" placeholder="Numer, klient lub e-mail" data-filter="q" />
          <label class="visually-hidden" for="filter-status">Status</label>
          <select id="filter-status" data-filter="status">
            ${FILTERS.map((f) => `<option value="${f.value}">${f.label}</option>`).join('')}
          </select>
          <p class="muted small toolbar__hint">Płatności, zwroty pieniędzy i potwierdzenia e-mail – w panelu Stripe.</p>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th scope="col">Numer</th>
                <th scope="col">Data</th>
                <th scope="col">Klient</th>
                <th scope="col">Produkty</th>
                <th scope="col">Kwota</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody data-rows></tbody>
          </table>
        </div>`;
      renderRows();
      container.addEventListener('input', onInput);
      container.addEventListener('change', onInput);
    },
  };
}

const COUNTRY: Record<string, string> = { PL: 'Polska' };

function addressMarkup(order: AdminOrder): string {
  const a = order.address;
  if (!a) return '<p class="muted">Klient jeszcze nie podał adresu.</p>';
  return `<p>${[a.name, a.line1, a.line2, `${a.postalCode} ${a.city}`.trim(), COUNTRY[a.country] ?? a.country].filter(Boolean).map(esc).join('<br />')}</p>`;
}

const row = (label: string, value: string) => (value ? `<div><dt>${label}</dt><dd>${value}</dd></div>` : '');

export function orderDetailView(id: number): View {
  let order: AdminOrder;
  let state: AdminOrderInput = { status: 'paid', tracking: '' };
  let dirty = false;
  let root: HTMLElement;

  const statusControl = () => {
    if (!isManualStatus(order.status)) {
      const why: Partial<Record<OrderStatus, string>> = {
        pending: 'Klient jest w kasie albo bank jeszcze nie potwierdził płatności. Status zmieni się sam.',
        failed: 'Płatność odrzucona – nic nie zostało pobrane.',
        expired: 'Klient nie dokończył płatności, a sesja kasy wygasła. Nic nie zostało pobrane.',
      };
      return `<p class="muted small">${why[order.status] ?? ''}</p>`;
    }
    return `
      <div class="field">
        <label for="o-status">Status</label>
        <select id="o-status" name="status">
          ${MANUAL_STATUSES.map((s) => `<option value="${s}"${state.status === s ? ' selected' : ''}>${ORDER_STATUS_LABEL[s]}</option>`).join('')}
        </select>
        <p class="field__hint">Przy anulowaniu zwróć pieniądze w panelu Stripe (przycisk „Zwróć środki” przy płatności).</p>
      </div>
      <div class="field">
        <label for="o-tracking">Numer przesyłki</label>
        <input id="o-tracking" type="text" name="tracking" value="${esc(state.tracking)}" maxlength="100" spellcheck="false" />
      </div>
      <button type="submit" class="btn btn--primary" data-save>Zapisz</button>`;
  };

  const template = () => {
    const items = order.items
      .map(
        (i) => `
        <tr>
          <td><span class="table__name">${esc(i.name)}</span><span class="muted small">${esc(i.variant)}</span></td>
          <td class="nowrap">${i.qty} × ${formatPrice(i.price)}</td>
          <td class="nowrap num">${formatPrice(i.price * i.qty)}</td>
        </tr>`,
      )
      .join('');
    const shipping = order.shippingPrice === null ? '' : `<tr><td colspan="2">Dostawa${order.shippingMethod ? `: ${esc(order.shippingMethod)}` : ''}</td><td class="nowrap num">${order.shippingPrice ? formatPrice(order.shippingPrice) : 'bezpłatnie'}</td></tr>`;

    return `
    <form class="editor" data-editor novalidate>
      <div class="editor__bar">
        <div class="editor__heading">
          <a class="back" href="#/zamowienia">← Zamówienia</a>
          <h1 class="page-title">Zamówienie ${esc(order.number)} ${badge(order.status)}</h1>
          <p class="muted small">Złożone ${esc(formatDate(order.createdAt))}${order.paidAt ? ` · opłacone ${esc(formatDate(order.paidAt))}` : ''}</p>
        </div>
        <div class="editor__actions">
          <span class="dirty muted small" data-dirty hidden>Niezapisane zmiany</span>
          ${order.stripeUrl ? `<a class="btn btn--quiet" href="${esc(order.stripeUrl)}" target="_blank" rel="noopener">Płatność w Stripe ↗</a>` : ''}
        </div>
      </div>

      <div class="editor__grid">
        <div class="editor__main">
          <section class="card">
            <h2 class="card__title">Produkty</h2>
            <div class="table-wrap">
              <table class="table order-items">
                <tbody>${items}${shipping}</tbody>
                <tfoot><tr><th scope="row" colspan="2">${order.total === null ? 'Produkty' : 'Razem'}</th><td class="nowrap num">${formatPrice(order.total ?? order.subtotal)}</td></tr></tfoot>
              </table>
            </div>
          </section>

          <section class="card">
            <h2 class="card__title">Dostawa</h2>
            <dl class="kv">
              ${row('Sposób', esc(order.shippingMethod))}
              ${row('Kod paczkomatu', order.parcelLocker ? `<strong>${esc(order.parcelLocker)}</strong>` : '')}
            </dl>
            ${addressMarkup(order)}
            ${/paczkomat/i.test(order.shippingMethod) && !order.parcelLocker ? '<p class="note note--warn">Klient wybrał paczkomat, ale nie podał kodu – zapytaj go e-mailem lub telefonicznie.</p>' : ''}
          </section>
        </div>

        <aside class="editor__side">
          <section class="card">
            <h2 class="card__title">Realizacja</h2>
            ${statusControl()}
          </section>
          <section class="card">
            <h2 class="card__title">Klient</h2>
            <dl class="kv">
              ${row('Imię i nazwisko', esc(order.name))}
              ${row('E-mail', order.email ? `<a href="mailto:${esc(order.email)}">${esc(order.email)}</a>` : '')}
              ${row('Telefon', order.phone ? `<a href="tel:${esc(order.phone)}">${esc(order.phone)}</a>` : '')}
              ${row('NIP do faktury', esc(order.nip))}
            </dl>
            ${order.name || order.email ? '' : '<p class="muted small">Dane pojawią się po zakończeniu kasy.</p>'}
          </section>
        </aside>
      </div>
    </form>`;
  };

  const markDirty = () => {
    dirty = true;
    root.querySelector<HTMLElement>('[data-dirty]')!.hidden = false;
  };

  const onInput = (event: Event) => {
    const el = event.target as HTMLInputElement | HTMLSelectElement;
    if (el.name === 'status' && isManualStatus(el.value)) state.status = el.value;
    else if (el.name === 'tracking') state.tracking = el.value;
    else return;
    markDirty();
  };

  const save = async () => {
    const button = root.querySelector<HTMLButtonElement>('[data-save]');
    if (!button) return;
    button.disabled = true;
    try {
      order = await api<AdminOrder>('PUT', `orders/${id}`, state);
      dirty = false;
      toast(order.status === 'shipped' ? 'Zapisano – zamówienie wysłane.' : 'Zapisano.');
      root.innerHTML = template();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Nie udało się zapisać.', 'error');
    } finally {
      const current = root.querySelector<HTMLButtonElement>('[data-save]');
      if (current) current.disabled = false;
    }
  };

  return {
    title: 'Zamówienie',
    async mount(container) {
      root = container;
      container.innerHTML = loadingMarkup;
      order = await api<AdminOrder>('GET', `orders/${id}`);
      if (isManualStatus(order.status)) state = { status: order.status, tracking: order.tracking };
      document.title = `${order.number} · Panel · Perfumowa Aura`;
      container.innerHTML = template();
      container.addEventListener('input', onInput);
      container.addEventListener('change', onInput);
      container.addEventListener('submit', (e) => {
        e.preventDefault();
        void save();
      });
    },
    canLeave: () => !dirty,
  };
}
