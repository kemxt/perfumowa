import { PHOTO_MIME, PHOTO_WIDTHS, type PhotoFormat, type UploadedPhoto } from '../../shared/catalog';
import { api } from './api';

/**
 * Zdjęcia produktu skalujemy w przeglądarce do szerokości 600 i 1200 px (WebP),
 * tak jak generator robi to dla zdjęć z repo – Worker tylko zapisuje gotowe pliki.
 */

const QUALITY = 0.86;

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

async function encode(bitmap: ImageBitmap, width: number, preferAlpha: boolean): Promise<{ blob: Blob; format: PhotoFormat; height: number }> {
  const scale = Math.min(1, width / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  // Przeglądarki bez kodera WebP zwracają PNG – wtedy JPG (albo PNG, gdy liczy się przezroczystość).
  const webp = await toBlob(canvas, PHOTO_MIME.webp);
  if (webp?.type === PHOTO_MIME.webp) return { blob: webp, format: 'webp', height: canvas.height };
  const format: PhotoFormat = preferAlpha ? 'png' : 'jpg';
  const blob = await toBlob(canvas, PHOTO_MIME[format]);
  if (!blob) throw new Error('Nie udało się przetworzyć zdjęcia.');
  return { blob, format, height: canvas.height };
}

export async function uploadPhoto(file: File): Promise<UploadedPhoto> {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name}: to nie jest obraz.`);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name}: nie udało się odczytać obrazu.`);
  }

  const form = new FormData();
  const preferAlpha = file.type === 'image/png' || file.type === 'image/webp';
  let format: PhotoFormat = 'webp';
  let size = { width: 0, height: 0 };
  for (const w of PHOTO_WIDTHS) {
    const variant = await encode(bitmap, w, preferAlpha);
    format = variant.format;
    form.append(`w${w}`, new File([variant.blob], `w${w}.${format}`, { type: PHOTO_MIME[format] }));
    size = { width: Math.round(bitmap.width * Math.min(1, w / bitmap.width)), height: variant.height };
  }
  bitmap.close();
  form.append('format', format);
  form.append('width', String(size.width));
  form.append('height', String(size.height));
  return api<UploadedPhoto>('POST', 'media/photo', form);
}

/** Flakon / etykieta – plik bez zmian (PNG z przezroczystością albo SVG). */
export async function uploadFile(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const { url } = await api<{ url: string }>('POST', 'media/file', form);
  return url;
}
