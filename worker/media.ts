import { PHOTO_MIME, PHOTO_WIDTHS, type PhotoFormat, type ProductPhoto, type UploadedPhoto } from '../shared/catalog';
import { HttpError, json } from './http';

/**
 * Zdjęcia i pliki wgrane w panelu, trzymane w Workers KV (klucz → plik, typ w metadanych).
 *   photos/{uuid}-{600,1200}.{format}   zdjęcia produktu (warianty robi przeglądarka w panelu)
 *   files/{uuid}.{ext}                  flakon i etykieta do efektu 3D
 * Klucze są unikalne i nigdy się nie zmieniają, więc odpowiedzi są cache'owane na zawsze.
 */

const MAX_BYTES = 10 * 1024 * 1024;
const KEY_PATTERN = /^(photos|files)\/[a-f0-9-]+(-\d+)?\.(avif|webp|jpg|png|svg)$/;
const FILE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

interface MediaMetadata {
  type: string;
}

export async function serveMedia(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });

  const url = new URL(request.url);
  const key = url.pathname.slice('/media/'.length);
  if (!KEY_PATTERN.test(key)) return new Response('Nie znaleziono', { status: 404 });

  // Cache API działa na domenie własnej (na workers.dev jest no-opem) – oszczędza odczyty KV.
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const cache = caches.default;
  let response = await cache.match(cacheKey);
  if (!response) {
    const { value, metadata } = await env.MEDIA.getWithMetadata<MediaMetadata>(key, { type: 'arrayBuffer', cacheTtl: 86400 });
    if (!value) return new Response('Nie znaleziono', { status: 404 });
    response = new Response(value, {
      headers: {
        'content-type': metadata?.type ?? 'application/octet-stream',
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
        // SVG otwarty bezpośrednio nie wykona skryptów.
        'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
      },
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return request.method === 'HEAD' ? new Response(null, response) : response;
}

function fileField(form: FormData, name: string): File {
  const value = form.get(name);
  if (!(value instanceof File)) throw new HttpError(400, `Brak pliku (${name}).`);
  if (value.size > MAX_BYTES) throw new HttpError(413, `Plik jest za duży (maks. ${MAX_BYTES / 1024 / 1024} MB).`);
  return value;
}

async function readForm(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw new HttpError(400, 'Oczekiwano formularza multipart.');
  }
}

/** Zdjęcie produktu: przeglądarka przysyła gotowe warianty w600 i w1200 w jednym formacie. */
export async function uploadPhoto(request: Request, env: Env): Promise<Response> {
  const form = await readForm(request);
  const format = String(form.get('format')) as PhotoFormat;
  if (!(format in PHOTO_MIME)) throw new HttpError(400, 'Nieobsługiwany format zdjęcia.');
  const width = Number(form.get('width'));
  const height = Number(form.get('height'));
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new HttpError(400, 'Brak wymiarów zdjęcia.');

  const id = crypto.randomUUID();
  const files = PHOTO_WIDTHS.map((w) => [w, fileField(form, `w${w}`)] as const);
  for (const [, file] of files) {
    if (file.type !== PHOTO_MIME[format]) throw new HttpError(400, 'Typ pliku nie zgadza się z formatem.');
  }
  await Promise.all(
    files.map(async ([w, file]) => env.MEDIA.put(`photos/${id}-${w}.${format}`, await file.arrayBuffer(), { metadata: { type: PHOTO_MIME[format] } satisfies MediaMetadata })),
  );
  return json({ src: `/media/photos/${id}`, formats: [format], width, height } satisfies UploadedPhoto, { status: 201 });
}

/** Pojedynczy plik (flakon, etykieta) bez wariantów. */
export async function uploadFile(request: Request, env: Env): Promise<Response> {
  const file = fileField(await readForm(request), 'file');
  const ext = FILE_TYPES[file.type];
  if (!ext) throw new HttpError(400, 'Dozwolone pliki: PNG, JPG, WebP, AVIF, SVG.');
  const key = `files/${crypto.randomUUID()}.${ext}`;
  await env.MEDIA.put(key, await file.arrayBuffer(), { metadata: { type: file.type } satisfies MediaMetadata });
  return json({ url: `/media/${key}` }, { status: 201 });
}

/** Klucze KV plików produktu wgranych w panelu (pliki z /assets/ są w repo i ich nie ruszamy). */
export function mediaKeys(media: { bottle: string; label: string; photos: Pick<ProductPhoto, 'src' | 'formats'>[] }): Set<string> {
  const keys = new Set<string>();
  for (const path of [media.bottle, media.label]) {
    if (path.startsWith('/media/files/')) keys.add(path.slice('/media/'.length));
  }
  for (const photo of media.photos) {
    if (!photo.src.startsWith('/media/photos/')) continue;
    for (const w of PHOTO_WIDTHS) for (const f of photo.formats) keys.add(`${photo.src.slice('/media/'.length)}-${w}.${f}`);
  }
  return keys;
}

export async function deleteMedia(env: Env, keys: Iterable<string>): Promise<void> {
  await Promise.all([...keys].map((key) => env.MEDIA.delete(key)));
}
