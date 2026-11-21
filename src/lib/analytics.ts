import type { Product } from '../data/products';
import { SHOP } from '../data/shop';

/**
 * Zdarzenia analityczne w formacie GA4 e-commerce, wypychane do window.dataLayer.
 * Google Tag Manager / gtag odczytają je bez zmian; bez GTM tablica po prostu rośnie.
 */
declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[];
  }
}

export type AnalyticsEvent = 'view_item' | 'select_size' | 'add_to_cart' | 'add_sample' | 'open_cart' | 'begin_checkout' | 'purchase';

export interface AnalyticsItem {
  item_id: string;
  item_name: string;
  item_brand: string;
  item_category: string;
  item_variant: string;
  price: number;
  quantity: number;
}

export function analyticsItem(product: Product, variant: { label: string; price: number; id: string }, quantity = 1): AnalyticsItem {
  return {
    item_id: variant.id,
    item_name: product.name,
    item_brand: 'Perfumowa Aura',
    item_category: 'Perfumy',
    item_variant: variant.label,
    price: variant.price,
    quantity,
  };
}

/** `ecommerce` uzupełnia obiekt ecommerce, np. { transaction_id, shipping, value } przy purchase. */
export function track(event: AnalyticsEvent, items: AnalyticsItem[] = [], extra: Record<string, unknown> = {}, ecommerce: Record<string, unknown> = {}): void {
  const value = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const layer = (window.dataLayer ??= []);
  layer.push({ ecommerce: null }); // zalecane przez GA4: czyści poprzedni obiekt ecommerce
  layer.push({ event, ecommerce: { currency: SHOP.currency, value, items, ...ecommerce }, ...extra });
  if (import.meta.env.DEV) console.debug(`[analytics] ${event}`, { value, items, ...extra });
}
