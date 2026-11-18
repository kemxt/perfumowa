import type { ShopSettings } from '../../shared/catalog';

/**
 * Warunki sklepu – jedno miejsce dla hero, koszyka, paska zakupu i danych strukturalnych.
 * Darmowa dostawa, czas realizacji i dni na zwrot pochodzą z panelu (Ustawienia) – applySettings.
 */
export const SHOP = {
  currency: 'PLN' as const,
  /** null = bez darmowej dostawy */
  freeShippingFrom: 300 as number | null,
  returnDays: 30,
  processingTime: '1–2 dni robocze',
  sample: { ml: 2, price: 19 },
  /** Pojemność oznaczana jako „Najczęściej wybierana” i zaznaczana domyślnie. */
  popularMl: 50,
};

export function applySettings(settings: ShopSettings): void {
  SHOP.freeShippingFrom = settings.shipping.freeFrom;
  SHOP.returnDays = settings.returns.days;
  SHOP.processingTime = settings.shipping.processingTime || SHOP.processingTime;
}

const unitFormat = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: SHOP.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const formatUnitPrice = (price: number, ml: number) => `${unitFormat.format(price / ml)} / ml`;

const ratingFormat = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const formatRating = (value: number) => ratingFormat.format(value);

/** „127 opinii”, „1 opinia”, „2 opinie” */
export function reviewsLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = count === 1 ? 'opinia' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'opinie' : 'opinii';
  return `${count} ${word}`;
}
