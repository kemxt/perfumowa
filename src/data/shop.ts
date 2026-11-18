/** Warunki sklepu – jedno miejsce dla hero, koszyka, paska zakupu i danych strukturalnych. */
export const SHOP = {
  currency: 'PLN',
  freeShippingFrom: 300,
  returnDays: 30,
  sample: { ml: 2, price: 19 },
  /** Pojemność oznaczana jako „Najczęściej wybierana” i zaznaczana domyślnie. */
  popularMl: 50,
} as const;

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
