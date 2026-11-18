import type { ShopSettings } from './catalog';

/**
 * Treść stron informacyjnych: prosty Markdown + pola {{…}} uzupełniane z ustawień sklepu.
 * Dane firmy wpisuje się raz w panelu (Ustawienia), a regulamin i polityki same się aktualizują.
 * Wspólne dla sklepu i podglądu w panelu.
 */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value: string) => value.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

const money = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 2, minimumFractionDigits: 0 });

/** Pola dostępne w treści stron – opis pokazuje panel. */
export const CONTENT_FIELDS: { key: string; label: string; value: (s: ShopSettings, host: string) => string }[] = [
  { key: 'firma', label: 'Nazwa firmy', value: (s) => s.company.name },
  { key: 'adres', label: 'Adres firmy', value: (s) => s.company.address },
  { key: 'nip', label: 'NIP', value: (s) => s.company.nip },
  { key: 'regon', label: 'REGON', value: (s) => s.company.regon },
  { key: 'email', label: 'E-mail', value: (s) => s.contact.email },
  { key: 'telefon', label: 'Telefon', value: (s) => s.contact.phone },
  { key: 'godziny', label: 'Godziny obsługi', value: (s) => s.contact.hours.split('\n').filter(Boolean).join(', ') },
  { key: 'dni_na_zwrot', label: 'Dni na zwrot', value: (s) => String(s.returns.days) },
  { key: 'czas_realizacji', label: 'Czas realizacji zamówienia', value: (s) => s.shipping.processingTime },
  { key: 'darmowa_dostawa_od', label: 'Darmowa dostawa od', value: (s) => (s.shipping.freeFrom === null ? '' : money.format(s.shipping.freeFrom)) },
  { key: 'strona', label: 'Adres sklepu', value: (_s, host) => host },
];

/** Puste pole zostaje widoczne jako [nazwa], żeby było widać, czego brakuje. */
export function fillFields(text: string, settings: ShopSettings, host: string): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) => {
    const field = CONTENT_FIELDS.find((f) => f.key === key);
    if (!field) return match;
    return field.value(settings, host).trim() || `[${field.label.toLocaleLowerCase('pl')}]`;
  });
}

function safeHref(url: string): string | null {
  return /^(https?:\/\/|mailto:|tel:|\/|#)/i.test(url) ? url : null;
}

function inline(text: string): string {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, url: string) => {
      const href = safeHref(url.replace(/&amp;/g, '&'));
      return href ? `<a href="${esc(href)}"${/^https?:/i.test(href) ? ' rel="noopener" target="_blank"' : ''}>${label}</a>` : match;
    });
}

/**
 * Markdown w wersji minimum: ## i ### nagłówki, akapity (pojedynczy enter = nowa linia),
 * listy „- ” i „1. ”, **pogrubienie**, [link](adres), linia pozioma „---”.
 * Najpierw escapowanie, więc treść z panelu nie wstrzyknie HTML-a.
 */
export function renderMarkdown(source: string): string {
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;

  const flush = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map(inline).join('<br />')}</p>`);
    paragraph = [];
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };

  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{2,3})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (!line.trim()) {
      flush();
    } else if (heading) {
      flush();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (/^-{3,}$/.test(line.trim())) {
      flush();
      out.push('<hr />');
    } else if (bullet || numbered) {
      const tag = bullet ? 'ul' : 'ol';
      if (paragraph.length || (list && list.tag !== tag)) flush();
      list ??= { tag, items: [] };
      list.items.push((bullet ?? numbered)![1]);
    } else if (list && /^\s{2,}/.test(raw)) {
      // wcięta linia = dalszy ciąg punktu listy
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      if (list) flush();
      paragraph.push(line.trim());
    }
  }
  flush();
  return out.join('\n');
}

export const renderContent = (body: string, settings: ShopSettings, host: string) => renderMarkdown(fillFields(body, settings, host));
