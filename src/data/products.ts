import type { LabelConfig } from '../lib/bottle-label';
import data from './products.json';

export interface ProductSize {
  ml: number;
  price: number;
}

export interface GalleryImage {
  src: string;
  alt: string;
}

export interface Product {
  slug: string;
  name: string;
  tagline: string;
  family: string;
  concentration: string;
  year: number;
  perfumer: string;
  description: string[];
  /** Jedno–dwa zdania o każdej warstwie – pokazywane w przypiętym hero. */
  story: { top: string; heart: string; base: string };
  notes: { top: string[]; heart: string[]; base: string[] };
  sizes: ProductSize[];
  specs: { longevity: string; sillage: string; season: string; occasion: string };
  /** Kolory placeholderów (flakon, etykieta, galeria). Interfejs strony jest monochromatyczny. */
  palette: { bg: string; fg: string; liquid: string; paper: string; ink: string; cap: string };
  media: { bottle: string; label: string; gallery: GalleryImage[] };
  /** Kalibracja etykiety 3D (nadpisuje defaults.json). Wartości z panelu ?debug. */
  labelConfig?: Partial<LabelConfig>;
}

export const products: readonly Product[] = data as Product[];

export function getProduct(slug: string): Product | undefined {
  return products.find((p) => p.slug === slug);
}

/** Kolejne zapachy po danym (w kółko), do sekcji „Inne zapachy”. */
export function otherProducts(slug: string, count = 3): Product[] {
  const index = products.findIndex((p) => p.slug === slug);
  return Array.from({ length: Math.min(count, products.length - 1) }, (_, i) => products[(index + 1 + i) % products.length]);
}

export const productUrl = (p: Pick<Product, 'slug'>) => `/perfumy/${p.slug}`;

const priceFormat = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 });
export const formatPrice = (value: number) => priceFormat.format(value);
