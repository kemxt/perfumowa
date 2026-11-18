import { handleAdmin } from './admin';
import { getCatalog, getPublishedPage } from './db';
import { HttpError, errorResponse, json } from './http';
import { serveMedia } from './media';

/**
 * Worker sklepu. Statyczną stronę (./dist, także panel /admin/) serwuje Cloudflare
 * bez udziału tego kodu – tutaj trafiają tylko ścieżki z assets.run_worker_first:
 *   /api/catalog   katalog dla sklepu (D1): produkty, kategorie, ustawienia, lista stron
 *   /api/pages/:s  treść opublikowanej strony informacyjnej
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
        // no-cache: przeglądarka pyta za każdym razem, więc zmiany z panelu widać od razu.
        return json(await getCatalog(env.DB), { headers: { 'cache-control': 'no-cache' } });
      }
      const page = pathname.match(/^\/api\/pages\/([a-z0-9-]+)$/);
      if (page) {
        if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'Niedozwolona metoda.');
        return json(await getPublishedPage(env.DB, page[1]), { headers: { 'cache-control': 'no-cache' } });
      }
      if (pathname.startsWith('/api/admin/')) return await handleAdmin(request, env, ctx, pathname.slice('/api/admin/'.length));
      throw new HttpError(404, 'Nie znaleziono.');
    } catch (error) {
      return errorResponse(error);
    }
  },
} satisfies ExportedHandler<Env>;
