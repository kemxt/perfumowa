import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace, type Texture } from 'three';

/**
 * Rasteryzacja etykiety (SVG lub PNG) do canvasa – raz na plik, współdzielona między
 * instancjami (hero, karty, klon w przejściu). Każdy renderer tworzy z niej własną teksturę,
 * bo tekstury WebGL są przypisane do kontekstu.
 */
const rasterCache = new Map<string, Promise<HTMLCanvasElement>>();

function rasterize(src: string, maxSize: number): Promise<HTMLCanvasElement> {
  const key = `${src}@${maxSize}`;
  let pending = rasterCache.get(key);
  if (!pending) {
    pending = (async () => {
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
      await img.decode();
      const w0 = img.naturalWidth || 2048;
      const h0 = img.naturalHeight || 512;
      const scale = Math.min(1, maxSize / Math.max(w0, h0));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w0 * scale);
      canvas.height = Math.round(h0 * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas;
    })();
    pending.catch(() => rasterCache.delete(key));
    rasterCache.set(key, pending);
  }
  return pending;
}

export async function loadLabelTexture(src: string, opts: { maxSize: number; anisotropy: number }): Promise<Texture> {
  const canvas = await rasterize(src, Math.min(opts.maxSize, 4096));
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = opts.anisotropy;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  return texture;
}
