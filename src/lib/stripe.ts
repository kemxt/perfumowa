/**
 * Stripe.js – wczytywany dopiero na stronie /kasa. Stripe wymaga ładowania biblioteki
 * z js.stripe.com (nie wolno jej dołączać do własnego pakietu).
 */

export interface EmbeddedCheckout {
  mount(element: HTMLElement): void;
  destroy(): void;
}

interface StripeJs {
  initEmbeddedCheckout(options: { fetchClientSecret: () => Promise<string> }): Promise<EmbeddedCheckout>;
}

declare global {
  interface Window {
    Stripe?: (publishableKey: string) => StripeJs;
  }
}

const SRC = 'https://js.stripe.com/v3/';
let loading: Promise<NonNullable<Window['Stripe']>> | null = null;

export function loadStripe(): Promise<NonNullable<Window['Stripe']>> {
  if (window.Stripe) return Promise.resolve(window.Stripe);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SRC;
    script.async = true;
    script.onload = () => (window.Stripe ? resolve(window.Stripe) : reject(new Error('Stripe.js nie zadziałał.')));
    script.onerror = () => {
      script.remove();
      loading = null;
      reject(new Error('Nie udało się wczytać formularza płatności. Sprawdź połączenie i odśwież stronę.'));
    };
    document.head.append(script);
  });
  return loading;
}
