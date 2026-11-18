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

export const SEASONS = ['wiosna', 'lato', 'jesien', 'zima'] as const;
export type Season = (typeof SEASONS)[number];
export const SEASON_LABEL: Record<Season, string> = { wiosna: 'Wiosna', lato: 'Lato', jesien: 'Jesień', zima: 'Zima' };

/** Dostępność pojemności: dostępna, ostatnie sztuki, chwilowo niedostępna. */
export const AVAILABILITY = ['available', 'low', 'unavailable'] as const;
export type Availability = (typeof AVAILABILITY)[number];
export const AVAILABILITY_LABEL: Record<Availability, string> = { available: 'Dostępny', low: 'Ostatnie sztuki', unavailable: 'Chwilowo niedostępny' };

export interface ProductSize {
  ml: number;
  price: number;
  availability: Availability;
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
  /** Pory roku, do których pasuje zapach (filtr w katalogu). */
  seasons: Season[];
  /** Oznaczony w panelu jako nowość (zakładka „Nowości”). */
  isNew: boolean;
  /** demo: true – dane przykładowe, przed startem podmień na oceny z systemu opinii. */
  rating: { value: number; count: number; demo?: boolean } | null;
  description: string[];
  /** Jedno–dwa zdania o każdej warstwie – pokazywane w przypiętym hero. */
  story: { top: string; heart: string; base: string };
  notes: { top: string[]; heart: string[]; base: string[] };
  sizes: ProductSize[];
  specs: { longevity: string; sillage: string; occasion: string };
  /** Kolory placeholderów (flakon, etykieta, galeria). Interfejs strony jest monochromatyczny. */
  palette: { bg: string; fg: string; liquid: string; paper: string; ink: string; cap: string };
  media: { bottle: string; label: string; photos: ProductPhoto[] };
  /** Kalibracja etykiety 3D (nadpisuje defaults.json). Wartości z panelu ?debug. */
  labelConfig?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Ustawienia sklepu i strony informacyjne
// ---------------------------------------------------------------------------

export interface ShippingMethod {
  name: string;
  /** Koszt w złotych (0 = bezpłatnie). */
  price: number;
  /** Przewidywany czas dostawy, np. „1–2 dni robocze”. */
  time: string;
}

export interface ShopSettings {
  company: { name: string; address: string; nip: string; regon: string };
  /** hours: kolejne linie, np. „Poniedziałek–piątek: 9:00–17:00”. */
  contact: { email: string; phone: string; hours: string };
  shipping: { methods: ShippingMethod[]; freeFrom: number | null; processingTime: string; tracking: string };
  payments: { methods: string[]; note: string };
  /** Ustawowo co najmniej 14 dni. */
  returns: { days: number };
}

export const PAYMENT_METHODS = ['BLIK', 'Karta płatnicza', 'Szybki przelew online', 'Przelew tradycyjny', 'Google Pay', 'Apple Pay', 'Płatność przy odbiorze'];

export const DEFAULT_SETTINGS: ShopSettings = {
  company: { name: '', address: '', nip: '', regon: '' },
  contact: { email: '', phone: '', hours: '' },
  shipping: { methods: [], freeFrom: null, processingTime: '', tracking: '' },
  payments: { methods: [], note: '' },
  returns: { days: 14 },
};

export interface PageLink {
  slug: string;
  title: string;
}

/** Strona informacyjna (regulamin, polityki…). Treść w prostym Markdownie z polami {{…}}. */
export interface Page extends PageLink {
  body: string;
  updatedAt: string;
}

/** GET /api/catalog – tylko opublikowane produkty i strony, w kolejności z panelu. */
export interface Catalog {
  categories: Category[];
  products: CatalogProduct[];
  settings: ShopSettings;
  pages: PageLink[];
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
  isNew: boolean;
  sizes: ProductSize[];
  thumb: ProductPhoto | null;
  updatedAt: string;
}

export type AdminCategoryInput = Pick<Category, 'slug' | 'name' | 'description'>;

export interface AdminPage extends Page {
  id: number;
  published: boolean;
  /** Strona wbudowana (kontakt, dostawa, dokumenty prawne) – nie da się jej usunąć ani zmienić adresu. */
  system: boolean;
  position: number;
}

export type AdminPageInput = Pick<AdminPage, 'slug' | 'title' | 'body' | 'published'>;

/** Adresy zajęte przez sklep – strona nie może ich użyć. */
export const RESERVED_SLUGS = ['perfumy', 'admin', 'api', 'media', 'assets', '_app', 'koszyk', 'kasa', 'favicon.svg'];

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
