import {
  AVAILABILITY,
  DEFAULT_SETTINGS,
  SEASONS,
  type AdminCategory,
  type AdminCategoryInput,
  type AdminPage,
  type AdminPageInput,
  type AdminProduct,
  type AdminProductInput,
  type AdminProductSummary,
  type Availability,
  type Catalog,
  type CatalogProduct,
  type Page,
  type PhotoFormat,
  type ProductPhoto,
  type ProductSize,
  type Season,
  type ShopSettings,
} from '../shared/catalog';
import { HttpError } from './http';

// ---------------------------------------------------------------------------
// Wiersze
// ---------------------------------------------------------------------------

interface ProductRow {
  id: number;
  slug: string;
  name: string;
  category_id: number | null;
  category_slug?: string | null;
  status: 'draft' | 'published';
  position: number;
  tagline: string;
  mood: string;
  family: string;
  concentration: string;
  year: number | null;
  perfumer: string;
  seasons: string;
  is_new: number;
  description: string;
  story: string;
  notes: string;
  specs: string;
  palette: string;
  rating: string | null;
  bottle_image: string;
  label_image: string;
  label_config: string | null;
  updated_at: string;
}

interface SizeRow {
  product_id: number;
  ml: number;
  price: number;
  availability: string;
}

interface PhotoRow {
  product_id: number;
  src: string;
  formats: string;
  alt: string;
  width: number;
  height: number;
  cutout: number;
}

interface CategoryRow {
  id: number;
  slug: string;
  name: string;
  description: string;
  position: number;
  product_count?: number;
}

const DEFAULT_PALETTE: CatalogProduct['palette'] = { bg: '#D9D4CB', fg: '#1A1A19', liquid: '#EFE9DC', paper: '#F6F2E6', ink: '#1A1A19', cap: '#2B2620' };

function parse<T extends object>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' ? ({ ...fallback, ...value } as T) : fallback;
  } catch {
    return fallback;
  }
}

const toSize = (row: SizeRow): ProductSize => ({
  ml: row.ml,
  price: row.price / 100,
  availability: AVAILABILITY.includes(row.availability as Availability) ? (row.availability as Availability) : 'available',
});

function parseSeasons(text: string): Season[] {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? SEASONS.filter((s) => value.includes(s)) : [];
  } catch {
    return [];
  }
}

function toPhoto(row: PhotoRow): ProductPhoto {
  const photo: ProductPhoto = { src: row.src, formats: row.formats.split(',') as PhotoFormat[], alt: row.alt, width: row.width, height: row.height };
  if (row.cutout) photo.cutout = true;
  return photo;
}

function groupBy<T extends { product_id: number }, U>(rows: T[], map: (row: T) => U): Map<number, U[]> {
  const groups = new Map<number, U[]>();
  for (const row of rows) {
    const list = groups.get(row.product_id) ?? [];
    list.push(map(row));
    groups.set(row.product_id, list);
  }
  return groups;
}

/** Stare rekordy mają w specs także „season” (dziś osobne pole seasons) – pomijamy je. */
const pickSpecs = ({ longevity, sillage, occasion }: CatalogProduct['specs']): CatalogProduct['specs'] => ({ longevity, sillage, occasion });

/** Pola wspólne dla katalogu i edytora. */
function productFields(row: ProductRow, sizes: ProductSize[], photos: ProductPhoto[]): Omit<CatalogProduct, 'category'> {
  const labelConfig = row.label_config ? parse<Record<string, number>>(row.label_config, {}) : undefined;
  return {
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    mood: row.mood,
    family: row.family,
    concentration: row.concentration,
    year: row.year,
    perfumer: row.perfumer,
    seasons: parseSeasons(row.seasons),
    isNew: !!row.is_new,
    rating: row.rating ? parse(row.rating, { value: 0, count: 0 }) : null,
    description: row.description.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
    story: parse(row.story, { top: '', heart: '', base: '' }),
    notes: parse(row.notes, { top: [], heart: [], base: [] }),
    sizes,
    specs: pickSpecs(parse(row.specs, { longevity: '', sillage: '', occasion: '' })),
    palette: parse(row.palette, DEFAULT_PALETTE),
    media: { bottle: row.bottle_image, label: row.label_image, photos },
    ...(labelConfig && Object.keys(labelConfig).length ? { labelConfig } : {}),
  };
}

function toAdminProduct(row: ProductRow, sizes: ProductSize[], photos: ProductPhoto[]): AdminProduct {
  return {
    id: row.id,
    status: row.status,
    categoryId: row.category_id,
    position: row.position,
    updatedAt: row.updated_at,
    ...productFields(row, sizes, photos),
  };
}

// ---------------------------------------------------------------------------
// Katalog (strona sklepu)
// ---------------------------------------------------------------------------

export async function getCatalog(db: D1Database): Promise<Catalog> {
  const published = `SELECT id FROM products WHERE status = 'published'`;
  const [categories, products, sizes, photos, settings, pages] = await db.batch([
    db.prepare('SELECT id, slug, name, description, position FROM categories ORDER BY position, id'),
    db.prepare(
      `SELECT p.*, c.slug AS category_slug FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.status = 'published' ORDER BY p.position, p.id`,
    ),
    db.prepare(`SELECT product_id, ml, price, availability FROM product_sizes WHERE product_id IN (${published}) ORDER BY product_id, ml`),
    db.prepare(`SELECT * FROM product_photos WHERE product_id IN (${published}) ORDER BY product_id, position, id`),
    db.prepare(`SELECT value FROM settings WHERE key = 'shop'`),
    db.prepare('SELECT slug, title FROM pages WHERE published = 1 ORDER BY position, id'),
  ]);
  const sizesBy = groupBy(sizes.results as SizeRow[], toSize);
  const photosBy = groupBy(photos.results as PhotoRow[], toPhoto);
  return {
    categories: (categories.results as CategoryRow[]).map(({ slug, name, description }) => ({ slug, name, description })),
    products: (products.results as ProductRow[]).map((row) => ({
      ...productFields(row, sizesBy.get(row.id) ?? [], photosBy.get(row.id) ?? []),
      category: row.category_slug ?? null,
    })),
    settings: parseSettings((settings.results[0] as { value: string } | undefined)?.value ?? null),
    pages: pages.results as Catalog['pages'],
  };
}

// ---------------------------------------------------------------------------
// Produkty (panel)
// ---------------------------------------------------------------------------

export async function listProducts(db: D1Database): Promise<AdminProductSummary[]> {
  const [products, sizes, photos] = await db.batch([
    db.prepare('SELECT id, slug, name, status, category_id, position, is_new, updated_at FROM products ORDER BY position, id'),
    db.prepare('SELECT product_id, ml, price, availability FROM product_sizes ORDER BY product_id, ml'),
    db.prepare('SELECT * FROM product_photos ORDER BY product_id, position, id'),
  ]);
  const sizesBy = groupBy(sizes.results as SizeRow[], toSize);
  const photosBy = groupBy(photos.results as PhotoRow[], toPhoto);
  return (products.results as ProductRow[]).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    categoryId: row.category_id,
    position: row.position,
    isNew: !!row.is_new,
    sizes: sizesBy.get(row.id) ?? [],
    thumb: photosBy.get(row.id)?.[0] ?? null,
    updatedAt: row.updated_at,
  }));
}

export async function getProduct(db: D1Database, id: number): Promise<AdminProduct> {
  const [products, sizes, photos] = await db.batch([
    db.prepare('SELECT * FROM products WHERE id = ?').bind(id),
    db.prepare('SELECT product_id, ml, price, availability FROM product_sizes WHERE product_id = ? ORDER BY ml').bind(id),
    db.prepare('SELECT * FROM product_photos WHERE product_id = ? ORDER BY position, id').bind(id),
  ]);
  const row = products.results[0] as ProductRow | undefined;
  if (!row) throw new HttpError(404, 'Nie ma takiego produktu.');
  return toAdminProduct(row, (sizes.results as SizeRow[]).map(toSize), (photos.results as PhotoRow[]).map(toPhoto));
}

async function assertProductUnique(db: D1Database, input: AdminProductInput, id: number | null): Promise<void> {
  const taken = await db.prepare('SELECT id FROM products WHERE slug = ? AND id IS NOT ?').bind(input.slug, id).first<number>('id');
  if (taken) throw new HttpError(409, 'Adres jest już zajęty.', { slug: 'Inny produkt ma już ten adres.' });
  if (input.categoryId !== null) {
    const exists = await db.prepare('SELECT id FROM categories WHERE id = ?').bind(input.categoryId).first<number>('id');
    if (!exists) throw new HttpError(422, 'Wybrana kategoria nie istnieje.', { categoryId: 'Wybrana kategoria nie istnieje.' });
  }
}

/** Kolumny produktu w kolejności używanej przez INSERT i UPDATE. */
function productColumns(input: AdminProductInput): [string, unknown][] {
  return [
    ['slug', input.slug],
    ['name', input.name],
    ['category_id', input.categoryId],
    ['status', input.status],
    ['tagline', input.tagline],
    ['mood', input.mood],
    ['family', input.family],
    ['concentration', input.concentration],
    ['year', input.year],
    ['perfumer', input.perfumer],
    ['seasons', JSON.stringify(input.seasons)],
    ['is_new', input.isNew ? 1 : 0],
    ['description', input.description.join('\n\n')],
    ['story', JSON.stringify(input.story)],
    ['notes', JSON.stringify(input.notes)],
    ['specs', JSON.stringify(input.specs)],
    ['palette', JSON.stringify(input.palette)],
    ['rating', input.rating ? JSON.stringify(input.rating) : null],
    ['bottle_image', input.media.bottle],
    ['label_image', input.media.label],
    ['label_config', input.labelConfig ? JSON.stringify(input.labelConfig) : null],
  ];
}

/** Pojemności i zdjęcia zapisujemy od nowa przy każdym zapisie produktu. */
function childStatements(db: D1Database, input: AdminProductInput, productId: string, bindId: unknown): D1PreparedStatement[] {
  return [
    db.prepare(`DELETE FROM product_sizes WHERE product_id = ${productId}`).bind(bindId),
    db.prepare(`DELETE FROM product_photos WHERE product_id = ${productId}`).bind(bindId),
    ...[...input.sizes]
      .sort((a, b) => a.ml - b.ml)
      .map((s, i) =>
        db
          .prepare(`INSERT INTO product_sizes (product_id, ml, price, availability, position) VALUES (${productId}, ?, ?, ?, ?)`)
          .bind(bindId, s.ml, Math.round(s.price * 100), s.availability, i),
      ),
    ...input.media.photos.map((p, i) =>
      db
        .prepare(`INSERT INTO product_photos (product_id, src, formats, alt, width, height, cutout, position) VALUES (${productId}, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(bindId, p.src, p.formats.join(','), p.alt, p.width, p.height, p.cutout ? 1 : 0, i),
    ),
  ];
}

export async function createProduct(db: D1Database, input: AdminProductInput): Promise<number> {
  await assertProductUnique(db, input, null);
  const columns = productColumns(input);
  // Batch to jedna transakcja; dzieci odnajdują nowy produkt po unikalnym slugu.
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO products (${columns.map(([c]) => c).join(', ')}, position)
         VALUES (${columns.map(() => '?').join(', ')}, (SELECT COALESCE(MAX(position), -1) + 1 FROM products)) RETURNING id`,
      )
      .bind(...columns.map(([, v]) => v)),
    ...childStatements(db, input, '(SELECT id FROM products WHERE slug = ?)', input.slug),
  ]);
  return (results[0].results[0] as { id: number }).id;
}

export async function updateProduct(db: D1Database, id: number, input: AdminProductInput): Promise<void> {
  await assertProductUnique(db, input, id);
  const columns = productColumns(input);
  const [update] = await db.batch([
    db
      .prepare(`UPDATE products SET ${columns.map(([c]) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
      .bind(...columns.map(([, v]) => v), id),
    ...childStatements(db, input, '?', id),
  ]);
  if (!update.meta.changes) throw new HttpError(404, 'Nie ma takiego produktu.');
}

export async function deleteProduct(db: D1Database, id: number): Promise<void> {
  const [, , removed] = await db.batch([
    db.prepare('DELETE FROM product_sizes WHERE product_id = ?').bind(id),
    db.prepare('DELETE FROM product_photos WHERE product_id = ?').bind(id),
    db.prepare('DELETE FROM products WHERE id = ?').bind(id),
  ]);
  if (!removed.meta.changes) throw new HttpError(404, 'Nie ma takiego produktu.');
}

export async function reorder(db: D1Database, table: 'products' | 'categories', ids: number[]): Promise<void> {
  if (!ids.length) return;
  await db.batch(ids.map((id, i) => db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`).bind(i, id)));
}

// ---------------------------------------------------------------------------
// Kategorie (panel)
// ---------------------------------------------------------------------------

export async function listCategories(db: D1Database): Promise<AdminCategory[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.slug, c.name, c.description, c.position,
         (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
       FROM categories c ORDER BY c.position, c.id`,
    )
    .all<CategoryRow>();
  return results.map((r) => ({ id: r.id, slug: r.slug, name: r.name, description: r.description, position: r.position, productCount: r.product_count ?? 0 }));
}

async function assertCategoryUnique(db: D1Database, input: AdminCategoryInput, id: number | null): Promise<void> {
  const taken = await db.prepare('SELECT id FROM categories WHERE slug = ? AND id IS NOT ?').bind(input.slug, id).first<number>('id');
  if (taken) throw new HttpError(409, 'Adres jest już zajęty.', { slug: 'Inna kategoria ma już ten adres.' });
}

export async function createCategory(db: D1Database, input: AdminCategoryInput): Promise<number> {
  await assertCategoryUnique(db, input, null);
  const id = await db
    .prepare(
      `INSERT INTO categories (slug, name, description, position)
       VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM categories)) RETURNING id`,
    )
    .bind(input.slug, input.name, input.description)
    .first<number>('id');
  return id!;
}

export async function updateCategory(db: D1Database, id: number, input: AdminCategoryInput): Promise<void> {
  await assertCategoryUnique(db, input, id);
  const result = await db
    .prepare(`UPDATE categories SET slug = ?, name = ?, description = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(input.slug, input.name, input.description, id)
    .run();
  if (!result.meta.changes) throw new HttpError(404, 'Nie ma takiej kategorii.');
}

export async function deleteCategory(db: D1Database, id: number): Promise<void> {
  const [, removed] = await db.batch([
    db.prepare('UPDATE products SET category_id = NULL WHERE category_id = ?').bind(id),
    db.prepare('DELETE FROM categories WHERE id = ?').bind(id),
  ]);
  if (!removed.meta.changes) throw new HttpError(404, 'Nie ma takiej kategorii.');
}

// ---------------------------------------------------------------------------
// Ustawienia sklepu
// ---------------------------------------------------------------------------

/** Ustawienia z bazy uzupełnione domyślnymi (np. po dodaniu nowego pola). */
function parseSettings(text: string | null): ShopSettings {
  let stored: Partial<ShopSettings> = {};
  try {
    stored = text ? (JSON.parse(text) as Partial<ShopSettings>) : {};
  } catch {
    // uszkodzony JSON – zostają domyślne
  }
  return {
    company: { ...DEFAULT_SETTINGS.company, ...stored.company },
    contact: { ...DEFAULT_SETTINGS.contact, ...stored.contact },
    shipping: { ...DEFAULT_SETTINGS.shipping, ...stored.shipping },
    payments: { ...DEFAULT_SETTINGS.payments, ...stored.payments },
    returns: { ...DEFAULT_SETTINGS.returns, ...stored.returns },
  };
}

export async function getSettings(db: D1Database): Promise<ShopSettings> {
  return parseSettings(await db.prepare(`SELECT value FROM settings WHERE key = 'shop'`).first<string>('value'));
}

export async function saveSettings(db: D1Database, settings: ShopSettings): Promise<void> {
  await db
    .prepare(`INSERT INTO settings (key, value) VALUES ('shop', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`)
    .bind(JSON.stringify(settings))
    .run();
}

// ---------------------------------------------------------------------------
// Strony informacyjne
// ---------------------------------------------------------------------------

interface PageRow {
  id: number;
  slug: string;
  title: string;
  body: string;
  published: number;
  system: number;
  position: number;
  updated_at: string;
}

const toAdminPage = (r: PageRow): AdminPage => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  body: r.body,
  published: !!r.published,
  system: !!r.system,
  position: r.position,
  updatedAt: r.updated_at,
});

export async function getPublishedPage(db: D1Database, slug: string): Promise<Page> {
  const row = await db.prepare('SELECT slug, title, body, updated_at FROM pages WHERE slug = ? AND published = 1').bind(slug).first<PageRow>();
  if (!row) throw new HttpError(404, 'Nie ma takiej strony.');
  return { slug: row.slug, title: row.title, body: row.body, updatedAt: row.updated_at };
}

export async function listPages(db: D1Database): Promise<AdminPage[]> {
  const { results } = await db.prepare('SELECT * FROM pages ORDER BY position, id').all<PageRow>();
  return results.map(toAdminPage);
}

export async function getPage(db: D1Database, id: number): Promise<AdminPage> {
  const row = await db.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first<PageRow>();
  if (!row) throw new HttpError(404, 'Nie ma takiej strony.');
  return toAdminPage(row);
}

async function assertPageUnique(db: D1Database, slug: string, id: number | null): Promise<void> {
  const taken = await db.prepare('SELECT id FROM pages WHERE slug = ? AND id IS NOT ?').bind(slug, id).first<number>('id');
  if (taken) throw new HttpError(409, 'Adres jest już zajęty.', { slug: 'Inna strona ma już ten adres.' });
}

export async function createPage(db: D1Database, input: AdminPageInput): Promise<number> {
  await assertPageUnique(db, input.slug, null);
  const id = await db
    .prepare(
      `INSERT INTO pages (slug, title, body, published, position)
       VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM pages)) RETURNING id`,
    )
    .bind(input.slug, input.title, input.body, input.published ? 1 : 0)
    .first<number>('id');
  return id!;
}

export async function updatePage(db: D1Database, id: number, input: AdminPageInput): Promise<void> {
  const current = await getPage(db, id);
  // Strony wbudowane mają stały adres – linkuje do nich kod sklepu i inne dokumenty.
  const slug = current.system ? current.slug : input.slug;
  await assertPageUnique(db, slug, id);
  await db
    .prepare(`UPDATE pages SET slug = ?, title = ?, body = ?, published = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(slug, input.title, input.body, input.published ? 1 : 0, id)
    .run();
}

export async function deletePage(db: D1Database, id: number): Promise<void> {
  const page = await getPage(db, id);
  if (page.system) throw new HttpError(409, 'Tej strony nie można usunąć – możesz ją ukryć (szkic).');
  await db.prepare('DELETE FROM pages WHERE id = ?').bind(id).run();
}
