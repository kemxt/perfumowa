/**
 * Akcent strony = kolor zapachu (palette.accent). Ustawiany na <html>, żeby
 * korzystały z niego też elementy spoza widoku (nagłówek, pasek zakupu).
 */
const root = document.documentElement;

export function applyAccent(accent: string): void {
  root.style.setProperty('--accent', accent);
}

export function resetAccent(): void {
  root.style.removeProperty('--accent');
}
