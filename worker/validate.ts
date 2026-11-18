import labelDefaults from '../src/lib/bottle-label/defaults.json';
import {
  PHOTO_MIME,
  SLUG_PATTERN,
  type AdminCategoryInput,
  type AdminProductInput,
  type CatalogProduct,
  type PhotoFormat,
  type ProductPhoto,
  type ProductSize,
} from '../shared/catalog';
import { HttpError } from './http';

/** Zbiera błędy per pole i na końcu rzuca jednym 422 z mapą `fields`. */
class Checker {
  readonly fields: Record<string, string> = {};

  fail(path: string, message: string): void {
    this.fields[path] ??= message;
  }

  text(value: unknown, path: string, { max = 200, required = false } = {}): string {
    if (value !== undefined && value !== null && typeof value !== 'string') {
      this.fail(path, 'Nieprawidłowa wartość.');
      return '';
    }
    const text = (value ?? '').trim();
    if (required && !text) this.fail(path, 'To pole jest wymagane.');
    else if (text.length > max) this.fail(path, `Maksymalnie ${max} znaków.`);
    return text;
  }

  number(value: unknown, path: string, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = true } = {}): number {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isFinite(n) || (integer && !Number.isInteger(n)) || n < min || n > max) {
      this.fail(path, integer ? `Podaj liczbę całkowitą od ${min} do ${max}.` : `Podaj liczbę od ${min} do ${max}.`);
      return min;
    }
    return n;
  }

  list(value: unknown, path: string, max: number): unknown[] {
    if (!Array.isArray(value)) {
      if (value !== undefined && value !== null) this.fail(path, 'Nieprawidłowa lista.');
      return [];
    }
    if (value.length > max) this.fail(path, `Maksymalnie ${max} pozycji.`);
    return value.slice(0, max);
  }

  object(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  /** Ścieżka do pliku z repo (/assets/...) albo wgranego w panelu (/media/...). */
  mediaPath(value: unknown, path: string, required = false): string {
    const text = this.text(value, path, { max: 300, required });
    if (text && (!/^\/(assets|media)\/[A-Za-z0-9._/-]+$/.test(text) || text.includes('..'))) this.fail(path, 'Nieprawidłowa ścieżka pliku.');
    return text;
  }

  done(): void {
    if (Object.keys(this.fields).length) throw new HttpError(422, 'Popraw zaznaczone pola.', this.fields);
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const PALETTE_KEYS = ['bg', 'fg', 'liquid', 'paper', 'ink', 'cap'] as const;
const LAYERS = ['top', 'heart', 'base'] as const;
const SPEC_KEYS = ['longevity', 'sillage', 'season', 'occasion'] as const;
const LABEL_KEYS = new Set(Object.keys(labelDefaults));

export function validateProduct(raw: unknown): AdminProductInput {
  const c = new Checker();
  const input = c.object(raw);

  const name = c.text(input.name, 'name', { max: 80, required: true });
  const slug = c.text(input.slug, 'slug', { max: 80, required: true });
  if (slug && !SLUG_PATTERN.test(slug)) c.fail('slug', 'Tylko małe litery bez polskich znaków, cyfry i myślniki, np. figowy-sad.');

  const status = input.status === 'published' ? 'published' : 'draft';
  if (input.status !== 'published' && input.status !== 'draft') c.fail('status', 'Nieprawidłowy status.');

  const categoryId = input.categoryId === null || input.categoryId === undefined || input.categoryId === '' ? null : c.number(input.categoryId, 'categoryId', { min: 1 });

  const yearRaw = input.year;
  const year = yearRaw === null || yearRaw === undefined || yearRaw === '' ? null : c.number(yearRaw, 'year', { min: 1900, max: 2100 });

  const description = c
    .list(input.description, 'description', 12)
    .map((para, i) => c.text(para, `description.${i}`, { max: 3000 }))
    .filter(Boolean);

  const storyIn = c.object(input.story);
  const story = Object.fromEntries(LAYERS.map((k) => [k, c.text(storyIn[k], `story.${k}`, { max: 600 })])) as CatalogProduct['story'];

  const notesIn = c.object(input.notes);
  const notes = Object.fromEntries(
    LAYERS.map((k) => [
      k,
      c
        .list(notesIn[k], `notes.${k}`, 12)
        .map((note, i) => c.text(note, `notes.${k}.${i}`, { max: 60 }))
        .filter(Boolean),
    ]),
  ) as CatalogProduct['notes'];

  const sizes: ProductSize[] = c.list(input.sizes, 'sizes', 10).map((item, i) => {
    const size = c.object(item);
    const ml = c.number(size.ml, `sizes.${i}.ml`, { min: 1, max: 5000 });
    const price = c.number(size.price, `sizes.${i}.price`, { min: 0, max: 1_000_000, integer: false });
    if (Math.abs(price * 100 - Math.round(price * 100)) > 1e-6) c.fail(`sizes.${i}.price`, 'Cena może mieć najwyżej dwa miejsca po przecinku.');
    return { ml, price };
  });
  sizes.forEach((s, i) => {
    if (sizes.findIndex((o) => o.ml === s.ml) !== i) c.fail(`sizes.${i}.ml`, 'Ta pojemność już jest na liście.');
  });
  if (status === 'published' && !sizes.length) c.fail('sizes', 'Opublikowany produkt musi mieć co najmniej jedną pojemność z ceną.');

  const specsIn = c.object(input.specs);
  const specs = Object.fromEntries(SPEC_KEYS.map((k) => [k, c.text(specsIn[k], `specs.${k}`, { max: 60 })])) as CatalogProduct['specs'];

  const paletteIn = c.object(input.palette);
  const palette = Object.fromEntries(
    PALETTE_KEYS.map((k) => {
      const color = c.text(paletteIn[k], `palette.${k}`, { max: 7, required: true });
      if (color && !HEX.test(color)) c.fail(`palette.${k}`, 'Kolor w formacie #RRGGBB.');
      return [k, color.toUpperCase()];
    }),
  ) as CatalogProduct['palette'];

  let rating: CatalogProduct['rating'] = null;
  if (input.rating) {
    const r = c.object(input.rating);
    rating = { value: c.number(r.value, 'rating.value', { min: 0, max: 5, integer: false }), count: c.number(r.count, 'rating.count', { max: 10_000_000 }) };
    if (r.demo) rating.demo = true;
  }

  const mediaIn = c.object(input.media);
  const bottle = c.mediaPath(mediaIn.bottle, 'media.bottle');
  if (status === 'published' && !bottle) c.fail('media.bottle', 'Opublikowany produkt musi mieć zdjęcie flakonu (do efektu 3D).');
  const label = c.mediaPath(mediaIn.label, 'media.label');

  const photos: ProductPhoto[] = c.list(mediaIn.photos, 'media.photos', 24).map((item, i) => {
    const photo = c.object(item);
    const formats = c.list(photo.formats, `media.photos.${i}.formats`, 4).filter((f): f is PhotoFormat => typeof f === 'string' && f in PHOTO_MIME);
    if (!formats.length) c.fail(`media.photos.${i}.formats`, 'Brak formatu zdjęcia.');
    const result: ProductPhoto = {
      src: c.mediaPath(photo.src, `media.photos.${i}.src`, true),
      formats: [...new Set(formats)],
      alt: c.text(photo.alt, `media.photos.${i}.alt`, { max: 200 }),
      width: c.number(photo.width, `media.photos.${i}.width`, { min: 1, max: 20000 }),
      height: c.number(photo.height, `media.photos.${i}.height`, { min: 1, max: 20000 }),
    };
    if (photo.cutout) result.cutout = true;
    return result;
  });

  let labelConfig: Record<string, number> | undefined;
  if (input.labelConfig !== undefined && input.labelConfig !== null) {
    const config = c.object(input.labelConfig);
    labelConfig = {};
    for (const [key, value] of Object.entries(config)) {
      if (!LABEL_KEYS.has(key)) c.fail('labelConfig', `Nieznany parametr: ${key}.`);
      else if (typeof value !== 'number' || !Number.isFinite(value)) c.fail('labelConfig', `${key} musi być liczbą.`);
      else labelConfig[key] = value;
    }
    if (!Object.keys(labelConfig).length) labelConfig = undefined;
  }

  const product: AdminProductInput = {
    name,
    slug,
    status,
    categoryId,
    tagline: c.text(input.tagline, 'tagline', { max: 160 }),
    mood: c.text(input.mood, 'mood', { max: 200 }),
    family: c.text(input.family, 'family', { max: 80 }),
    concentration: c.text(input.concentration, 'concentration', { max: 60 }),
    year,
    perfumer: c.text(input.perfumer, 'perfumer', { max: 80 }),
    rating,
    description,
    story,
    notes,
    sizes,
    specs,
    palette,
    media: { bottle, label, photos },
    ...(labelConfig ? { labelConfig } : {}),
  };
  c.done();
  return product;
}

export function validateCategory(raw: unknown): AdminCategoryInput {
  const c = new Checker();
  const input = c.object(raw);
  const name = c.text(input.name, 'name', { max: 80, required: true });
  const slug = c.text(input.slug, 'slug', { max: 80, required: true });
  if (slug && !SLUG_PATTERN.test(slug)) c.fail('slug', 'Tylko małe litery bez polskich znaków, cyfry i myślniki.');
  const description = c.text(input.description, 'description', { max: 500 });
  c.done();
  return { name, slug, description };
}

/** { ids: [3, 1, 2] } – nowa kolejność. */
export function validateOrder(raw: unknown): number[] {
  const c = new Checker();
  const ids = c.list(c.object(raw).ids, 'ids', 1000).map((id, i) => c.number(id, `ids.${i}`, { min: 1 }));
  c.done();
  return ids;
}

export function idParam(value: string | undefined): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(404, 'Nie znaleziono.');
  return id;
}
