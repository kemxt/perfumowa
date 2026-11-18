import { handleAdmin } from './admin';
import { getCatalog } from './db';
import { HttpError, errorResponse, json } from './http';
import { serveMedia } from './media';

/**
 * Worker sklepu. Statyczną stronę (./dist, także panel /admin/) serwuje Cloudflare
 * bez udziału tego kodu – tutaj trafiają tylko ścieżki z assets.run_worker_first:
 *   /api/catalog   katalog dla sklepu (D1)
 *   /api/admin/*   API panelu (logowanie, produkty, kategorie, upload)
 *   /media/*       zdjęcia wgrane w panelu (KV)
 */
export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    try {
      if (pathname.startsWith('/media/')) return await serveMedia(request, env, ctx);
      if (pathname === '/api/catalog') {
        if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'Niedozwolona metoda.');
        // Krótki cache: zmiany z panelu widać w sklepie po kilku sekundach.
        return json(await getCatalog(env.DB), { headers: { 'cache-control': 'public, max-age=10' } });
      }
      if (pathname.startsWith('/api/admin/')) return await handleAdmin(request, env, ctx, pathname.slice('/api/admin/'.length));
      throw new HttpError(404, 'Nie znaleziono.');
    } catch (error) {
      return errorResponse(error);
    }
  },
} satisfies ExportedHandler<Env>;
