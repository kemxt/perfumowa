/** Atrapa koszyka – licznik w nagłówku (bez backendu). */
let count = 0;

export function addToCart(quantity = 1): number {
  count += quantity;
  document.querySelectorAll('[data-cart-count]').forEach((el) => (el.textContent = String(count)));
  return count;
}
