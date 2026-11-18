import type { Page as PageData } from '../../shared/catalog';
import { renderContent } from '../../shared/content';
import { formatPrice, pages, settings } from '../data/products';
import { esc } from '../lib/dom';
import { scrollToElement } from '../lib/smooth-scroll';
import type { Page } from '../router';

/**
 * Strony informacyjne z panelu (regulamin, polityki, formularz…). Kontakt oraz Dostawa
 * i płatności mają dodatkowo część budowaną z ustawień sklepu – treść z panelu idzie pod nią.
 */

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map(esc)
    .join('<br />');

function contactMarkup(): string {
  const { contact, company } = settings;
  const items: [string, string][] = [];
  if (contact.email) items.push(['E-mail', `<a href="mailto:${esc(contact.email)}" data-external>${esc(contact.email)}</a>`]);
  if (contact.phone) items.push(['Telefon', `<a href="tel:${esc(contact.phone.replace(/[^\d+]/g, ''))}" data-external>${esc(contact.phone)}</a>`]);
  if (contact.hours) items.push(['Godziny obsługi klienta', lines(contact.hours)]);
  const companyLines = [company.name, company.address, company.nip && `NIP ${company.nip}`, company.regon && `REGON ${company.regon}`].filter(Boolean).join('\n');
  if (companyLines) items.push(['Dane firmy', lines(companyLines)]);
  if (!items.length) return '';
  return `<dl class="facts">${items.map(([k, v]) => `<div><dt class="label">${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
}

function deliveryMarkup(): string {
  const { shipping, payments } = settings;
  const cost = (price: number) => (price === 0 ? 'Bezpłatnie' : formatPrice(price));
  const delivery = [
    shipping.methods.length
      ? `<div class="table-scroll"><table class="ship-table">
          <thead><tr><th scope="col">Sposób dostawy</th><th scope="col">Koszt</th><th scope="col">Czas dostawy</th></tr></thead>
          <tbody>${shipping.methods.map((m) => `<tr><th scope="row">${esc(m.name)}</th><td>${cost(m.price)}</td><td>${esc(m.time)}</td></tr>`).join('')}</tbody>
        </table></div>`
      : '',
    shipping.freeFrom === null ? '' : `<p class="doc__highlight">Darmowa dostawa przy zamówieniu od ${formatPrice(shipping.freeFrom)}.</p>`,
    `<dl class="facts">${[
      shipping.processingTime ? ['Czas realizacji zamówienia', `${esc(shipping.processingTime)} od zaksięgowania płatności.`] : null,
      shipping.tracking ? ['Śledzenie przesyłki', esc(shipping.tracking)] : null,
    ]
      .filter((x): x is string[] => !!x)
      .map(([k, v]) => `<div><dt class="label">${k}</dt><dd>${v}</dd></div>`)
      .join('')}</dl>`,
  ].join('');

  const payment = [
    payments.methods.length ? `<ul class="pay-list">${payments.methods.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : '',
    payments.note ? `<p>${esc(payments.note)}</p>` : '',
  ].join('');

  return `
    <section class="doc__section" id="dostawa" aria-labelledby="h-dostawa"><h2 id="h-dostawa">Dostawa</h2>${delivery}</section>
    ${payment ? `<section class="doc__section" id="platnosci" aria-labelledby="h-platnosci"><h2 id="h-platnosci">Płatności</h2>${payment}</section>` : ''}`;
}

const STRUCTURED: Record<string, () => string> = {
  kontakt: contactMarkup,
  'dostawa-i-platnosci': deliveryMarkup,
};

const updated = (sqlite: string) => {
  const date = new Date(`${sqlite.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
};

export function contentPage(slug: string): Page {
  const title = pages.find((p) => p.slug === slug)?.title ?? '';
  let alive = true;

  return {
    title: `${title} | Perfumowa Aura`,
    async mount(view) {
      const structured = STRUCTURED[slug]?.() ?? '';
      view.innerHTML = `
      <main id="main" class="doc surface-light" tabindex="-1">
        <div class="grid">
          <article class="doc__inner">
            <p class="label">Informacje</p>
            <h1 class="doc__title">${esc(title)}</h1>
            ${structured}
            <div class="prose" data-body><p class="doc__loading">Wczytywanie…</p></div>
            <footer class="doc__footer" data-footer hidden>
              <p data-updated></p>
              <button type="button" class="btn btn--quiet btn--small" data-print>Drukuj lub zapisz PDF</button>
            </footer>
          </article>
        </div>
      </main>`;

      const main = view.querySelector('main')!;
      main.querySelector('[data-print]')!.addEventListener('click', () => window.print());

      let page: PageData | null = null;
      try {
        const response = await fetch(`/api/pages/${encodeURIComponent(slug)}`);
        if (response.ok) page = (await response.json()) as PageData;
      } catch {
        // brak sieci – zostaje część z ustawień albo komunikat poniżej
      }
      if (!alive) return;

      const body = main.querySelector<HTMLElement>('[data-body]')!;
      if (page?.body.trim()) body.innerHTML = renderContent(page.body, settings, window.location.host);
      else if (structured) body.remove();
      else body.innerHTML = '<p>Nie udało się wczytać treści. Odśwież stronę za chwilę.</p>';

      if (page) {
        const footer = main.querySelector<HTMLElement>('[data-footer]')!;
        footer.hidden = false;
        const date = updated(page.updatedAt);
        footer.querySelector('[data-updated]')!.textContent = date ? `Ostatnia aktualizacja: ${date}` : '';
      }

      // Kotwice (np. /dostawa-i-platnosci#platnosci) działają po wczytaniu treści.
      const target = window.location.hash && document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
      if (target) requestAnimationFrame(() => scrollToElement(target, -80));
    },
    unmount() {
      alive = false;
    },
  };
}
