#!/usr/bin/env node
/**
 * Generuje migrations/0002_seed.sql z src/data/products.json – początkowa zawartość
 * bazy D1 (kategorie + obecne zapachy). Po wdrożeniu źródłem prawdy jest baza,
 * a produkty edytuje się w panelu /admin/.
 *
 *   node scripts/seed-sql.mjs
 *
 * Uwaga: 0002 jest już zastosowana na produkcji – nie generuj jej ponownie. Zmiany danych
 * startowych (np. kategorie damskie/męskie/unisex) robi kolejna migracja, 0003_content.sql.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const products = JSON.parse(await readFile(path.join(ROOT, 'src/data/products.json'), 'utf8'));

const CATEGORIES = [
  { slug: 'zielone-i-aromatyczne', name: 'Zielone i aromatyczne', description: 'Liście, zioła, morskie powietrze.', products: ['figowy-sad', 'sol-i-jalowiec'] },
  { slug: 'kwiatowe-i-cytrusowe', name: 'Kwiatowe i cytrusowe', description: 'Jasne, rozświetlone kompozycje na dzień.', products: ['bialy-bez', 'gorzka-pomarancza'] },
  { slug: 'orientalne-i-drzewne', name: 'Orientalne i drzewne', description: 'Żywice, kadzidło i ciepłe drewno.', products: ['bursztynowa-noc', 'kadzidlo-i-deszcz'] },
];

const sql = (value) => {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replace(/'/g, "''")}'`;
};
const json = (value) => sql(value === undefined || value === null ? null : JSON.stringify(value));

const lines = ['-- Wygenerowane przez scripts/seed-sql.mjs z src/data/products.json.', ''];

CATEGORIES.forEach((c, i) => {
  lines.push(`INSERT INTO categories (id, slug, name, description, position) VALUES (${i + 1}, ${sql(c.slug)}, ${sql(c.name)}, ${sql(c.description)}, ${i});`);
});
lines.push('');

products.forEach((p, i) => {
  const id = i + 1;
  const categoryIndex = CATEGORIES.findIndex((c) => c.products.includes(p.slug));
  const columns = {
    id,
    slug: p.slug,
    name: p.name,
    category_id: categoryIndex >= 0 ? categoryIndex + 1 : null,
    status: 'published',
    position: i,
    tagline: p.tagline,
    mood: p.mood ?? '',
    family: p.family,
    concentration: p.concentration,
    year: p.year ?? null,
    perfumer: p.perfumer ?? '',
    description: p.description.join('\n\n'),
  };
  const jsonColumns = {
    story: p.story,
    notes: p.notes,
    specs: p.specs,
    palette: p.palette,
    rating: p.rating ?? null,
    label_config: p.labelConfig ?? null,
  };
  const names = [...Object.keys(columns), ...Object.keys(jsonColumns), 'bottle_image', 'label_image'];
  const values = [...Object.values(columns).map(sql), ...Object.values(jsonColumns).map(json), sql(p.media.bottle), sql(p.media.label)];
  lines.push(`INSERT INTO products (${names.join(', ')}) VALUES (${values.join(', ')});`);

  p.sizes.forEach((s, j) => {
    lines.push(`INSERT INTO product_sizes (product_id, ml, price, position) VALUES (${id}, ${s.ml}, ${Math.round(s.price * 100)}, ${j});`);
  });
  (p.media.photos ?? []).forEach((photo, j) => {
    // Zdjęcia z repo generuje scripts/generate-placeholders.mjs w AVIF i WebP.
    lines.push(
      `INSERT INTO product_photos (product_id, src, formats, alt, width, height, cutout, position) VALUES (${id}, ${sql(photo.src)}, 'avif,webp', ${sql(photo.alt)}, ${photo.width}, ${photo.height}, ${photo.cutout ? 1 : 0}, ${j});`,
    );
  });
  lines.push('');
});

const out = path.join(ROOT, 'migrations/0002_seed.sql');
await writeFile(out, lines.join('\n'));
console.log(`Zapisano ${path.relative(ROOT, out)} (${products.length} produktów, ${CATEGORIES.length} kategorie).`);
