/**
 * Kontrakt API między Workerem (worker/) a stroną i panelem (src/).
 * Ceny w API są w złotych (w bazie w groszach).
 */

export type PhotoFormat = 'avif' | 'webp' | 'jpg' | 'png';

export const PHOTO_WIDTHS = [600, 1200] as const;

export const PHOTO_MIME: Record<PhotoFormat, string> = {
  avif: 'image/avif',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  png: 'image/png',
};

export interface ProductSize {
  ml: number;
  price: number;
}

/** Zdjęcie: `src` to ścieżka bez sufiksu; pliki to `${src}-{600,1200}.{format}`. */
export interface ProductPhoto {
  src: string;
  /** Formaty od najlepszego; ostatni jest fallbackiem w <img>. */
  formats: PhotoFormat[];
  alt: string;
  width: number;
  height: number;
  /** Wycięty flakon na przezroczystym tle. */
  cutout?: boolean;
}

export interface Category {
  slug: string;
  name: string;
  description: string;
}

export interface CatalogProduct {
  slug: string;
  name: string;
  /** Slug kategorii. */
  category: string | null;
  tagline: string;
  /** Jedno zdanie budujące wyobraźnię, pod taglinem. */
  mood: string;
  family: string;
  concentration: string;
  year: number | null;
  perfumer: string;
  /** demo: true – dane przykładowe, przed startem podmień na oceny z systemu opinii. */
  rating: { value: number; count: number; demo?: boolean } | null;
  description: string[];
  /** Jedno–dwa zdania o każdej warstwie – pokazywane w przypiętym hero. */
  story: { top: string; heart: string; base: string };
  notes: { top: string[]; heart: string[]; base: string[] };
  sizes: ProductSize[];
  specs: { longevity: string; sillage: string; season: string; occasion: string };
  /** Kolory placeholderów (flakon, etykieta, galeria). Interfejs strony jest monochromatyczny. */
  palette: { bg: string; fg: string; liquid: string; paper: string; ink: string; cap: string };
  media: { bottle: string; label: string; photos: ProductPhoto[] };
  /** Kalibracja etykiety 3D (nadpisuje defaults.json). Wartości z panelu ?debug. */
  labelConfig?: Record<string, number>;
}

/** GET /api/catalog – tylko opublikowane produkty, w kolejności z panelu. */
export interface Catalog {
  categories: Category[];
  products: CatalogProduct[];
}

// ---------------------------------------------------------------------------
// Panel admina
// ---------------------------------------------------------------------------

export type ProductStatus = 'draft' | 'published';

export interface AdminCategory extends Category {
  id: number;
  position: number;
  productCount: number;
}

/** Produkt w edytorze: pola katalogu + identyfikator, status i kategoria po id. */
export interface AdminProduct extends Omit<CatalogProduct, 'category'> {
  id: number;
  status: ProductStatus;
  categoryId: number | null;
  position: number;
  updatedAt: string;
}

/** Treść zapisu (POST/PUT /api/admin/products). */
export type AdminProductInput = Omit<AdminProduct, 'id' | 'position' | 'updatedAt'>;

export interface AdminProductSummary {
  id: number;
  slug: string;
  name: string;
  status: ProductStatus;
  categoryId: number | null;
  position: number;
  sizes: ProductSize[];
  thumb: ProductPhoto | null;
  updatedAt: string;
}

export type AdminCategoryInput = Pick<Category, 'slug' | 'name' | 'description'>;

/** Wynik wgrania zdjęcia (POST /api/admin/media/photo). */
export type UploadedPhoto = Pick<ProductPhoto, 'src' | 'formats' | 'width' | 'height'>;

export interface ApiError {
  error: string;
  /** Błędy walidacji per pole, np. { "sizes.0.price": "..." }. */
  fields?: Record<string, string>;
}

/** URL konkretnego wariantu zdjęcia. */
export const photoUrl = (photo: Pick<ProductPhoto, 'src'>, width: number, format: PhotoFormat) => `${photo.src}-${width}.${format}`;

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** „Gorzka Pomarańcza” → „gorzka-pomarancza” */
export function slugify(text: string): string {
  return text
    .toLocaleLowerCase('pl')
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
