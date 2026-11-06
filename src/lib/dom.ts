const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapowanie tekstu wstawianego do szablonów HTML. */
export const esc = (value: unknown) => String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

export function qs<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Brak elementu: ${selector}`);
  return el;
}

export const pad2 = (n: number) => String(n).padStart(2, '0');
