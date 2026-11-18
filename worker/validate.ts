import labelDefaults from '../src/lib/bottle-label/defaults.json';
import {
  AVAILABILITY,
  PHOTO_MIME,
  RESERVED_SLUGS,
  SEASONS,
  SLUG_PATTERN,
  type AdminCategoryInput,
  type AdminPageInput,
  type AdminProductInput,
  type Availability,
  type CatalogProduct,
  type PhotoFormat,
  type ProductPhoto,
  type ProductSize,
  type ShippingMethod,
  type ShopSettings,
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

  /** Kwota w złotych z najwyżej dwoma miejscami po przecinku. */
  money(value: unknown, path: string, max = 1_000_000): number {
    const n = this.number(value, path, { min: 0, max, integer: false });
    if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) this.fail(path, 'Kwota może mieć najwyżej dwa miejsca po przecinku.');
    return n;
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
const SPEC_KEYS = ['longevity', 'sillage', 'occasion'] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
    const price = c.money(size.price, `sizes.${i}.price`);
    const availability: Availability = AVAILABILITY.includes(size.availability as Availability) ? (size.availability as Availability) : 'available';
    return { ml, price, availability };
  });
  sizes.forEach((s, i) => {
    if (sizes.findIndex((o) => o.ml === s.ml) !== i) c.fail(`sizes.${i}.ml`, 'Ta pojemność już jest na liście.');
  });
  if (status === 'published' && !sizes.length) c.fail('sizes', 'Opublikowany produkt musi mieć co najmniej jedną pojemność z ceną.');

  const seasons = SEASONS.filter((season) => c.list(input.seasons, 'seasons', SEASONS.length).includes(season));

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
    seasons,
    isNew: input.isNew === true,
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

export function validateSettings(raw: unknown): ShopSettings {
  const c = new Checker();
  const input = c.object(raw);
  const company = c.object(input.company);
  const contact = c.object(input.contact);
  const shipping = c.object(input.shipping);
  const payments = c.object(input.payments);
  const returns = c.object(input.returns);

  const email = c.text(contact.email, 'contact.email', { max: 120 });
  if (email && !EMAIL.test(email)) c.fail('contact.email', 'Nieprawidłowy adres e-mail.');

  const methods: ShippingMethod[] = c.list(shipping.methods, 'shipping.methods', 10).map((item, i) => {
    const m = c.object(item);
    return {
      name: c.text(m.name, `shipping.methods.${i}.name`, { max: 80, required: true }),
      price: c.money(m.price, `shipping.methods.${i}.price`, 10_000),
      time: c.text(m.time, `shipping.methods.${i}.time`, { max: 60 }),
    };
  });

  const freeRaw = shipping.freeFrom;
  const freeFrom = freeRaw === null || freeRaw === undefined || freeRaw === '' ? null : c.money(freeRaw, 'shipping.freeFrom', 100_000);

  const paymentMethods = [
    ...new Set(
      c
        .list(payments.methods, 'payments.methods', 15)
        .map((m, i) => c.text(m, `payments.methods.${i}`, { max: 60 }))
        .filter(Boolean),
    ),
  ];

  // Komunikat o minimum ustawowym ma pierwszeństwo przed ogólnym błędem zakresu.
  if (Number(returns.days) < 14) c.fail('returns.days', 'Ustawowo konsument ma co najmniej 14 dni na odstąpienie od umowy.');
  const days = c.number(returns.days, 'returns.days', { min: 14, max: 365 });

  const settings: ShopSettings = {
    company: {
      name: c.text(company.name, 'company.name', { max: 160 }),
      address: c.text(company.address, 'company.address', { max: 300 }),
      nip: c.text(company.nip, 'company.nip', { max: 20 }),
      regon: c.text(company.regon, 'company.regon', { max: 20 }),
    },
    contact: {
      email,
      phone: c.text(contact.phone, 'contact.phone', { max: 40 }),
      hours: c.text(contact.hours, 'contact.hours', { max: 400 }),
    },
    shipping: {
      methods,
      freeFrom,
      processingTime: c.text(shipping.processingTime, 'shipping.processingTime', { max: 80 }),
      tracking: c.text(shipping.tracking, 'shipping.tracking', { max: 600 }),
    },
    payments: { methods: paymentMethods, note: c.text(payments.note, 'payments.note', { max: 600 }) },
    returns: { days },
  };
  c.done();
  return settings;
}

export function validatePage(raw: unknown): AdminPageInput {
  const c = new Checker();
  const input = c.object(raw);
  const title = c.text(input.title, 'title', { max: 120, required: true });
  const slug = c.text(input.slug, 'slug', { max: 80, required: true });
  if (slug && !SLUG_PATTERN.test(slug)) c.fail('slug', 'Tylko małe litery bez polskich znaków, cyfry i myślniki, np. regulamin.');
  else if (RESERVED_SLUGS.includes(slug)) c.fail('slug', 'Ten adres jest zajęty przez sklep.');
  const body = c.text(input.body, 'body', { max: 100_000 });
  const page: AdminPageInput = { title, slug, body, published: input.published === true };
  c.done();
  return page;
}
