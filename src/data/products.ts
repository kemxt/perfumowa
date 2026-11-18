import type { Catalog, CatalogProduct, Category } from '../../shared/catalog';
import type { LabelConfig } from '../lib/bottle-label';

export type { Category, ProductPhoto, ProductSize } from '../../shared/catalog';

/**
 * Produkty i kategorie pochodzą z bazy D1 (GET /api/catalog, edycja w panelu /admin/).
 * src/data/products.json to już tylko dane startowe: seed bazy (scripts/seed-sql.mjs)
 * i źródło placeholderów (scripts/generate-placeholders.mjs).
 */
export interface Product extends Omit<CatalogProduct, 'labelConfig'> {
  /** Kalibracja etykiety 3D (nadpisuje defaults.json). Wartości z panelu ?debug. */
  labelConfig?: Partial<LabelConfig>;
}

export let products: readonly Product[] = [];
export let categories: readonly Category[] = [];

/** Pobiera katalog raz, przed startem routera (index.html robi preload tego adresu). */
export async function loadCatalog(): Promise<void> {
  const response = await fetch('/api/catalog');
  if (!response.ok) throw new Error(`Katalog: HTTP ${response.status}`);
  const catalog = (await response.json()) as Catalog;
  products = catalog.products as Product[];
  categories = catalog.categories;
}

export function getProduct(slug: string): Product | undefined {
  return products.find((p) => p.slug === slug);
}

export function getCategory(slug: string | null): Category | undefined {
  return categories.find((c) => c.slug === slug);
}

/** Kolejne zapachy po danym (w kółko), do sekcji „Inne zapachy”. */
export function otherProducts(slug: string, count = 3): Product[] {
  const index = products.findIndex((p) => p.slug === slug);
  return Array.from({ length: Math.min(count, products.length - 1) }, (_, i) => products[(index + 1 + i) % products.length]);
}

export const productUrl = (p: Pick<Product, 'slug'>) => `/perfumy/${p.slug}`;

export const fromPrice = (p: Pick<Product, 'sizes'>) => Math.min(...p.sizes.map((s) => s.price));

const priceFormat = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 });
const priceFormatCents = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** „490 zł”, a ceny z groszami z panelu: „129,50 zł”. */
export const formatPrice = (value: number) => (Number.isInteger(value) ? priceFormat : priceFormatCents).format(value);
