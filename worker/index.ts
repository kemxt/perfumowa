import { handleAdmin } from './admin';
import { getCatalog, getPublishedPage } from './db';
import { HttpError, errorResponse, json } from './http';
import { serveMedia } from './media';
import { createCheckout, getCheckoutResult, handleWebhook } from './orders';

/**
 * Worker sklepu. Statyczną stronę (./dist, także panel /admin/) serwuje Cloudflare
 * bez udziału tego kodu – tutaj trafiają tylko ścieżki z assets.run_worker_first:
 *   /api/catalog         katalog dla sklepu (D1): produkty, kategorie, ustawienia, lista stron
 *   /api/pages/:s        treść opublikowanej strony informacyjnej
 *   /api/checkout        kasa: zamówienie + sesja Stripe Checkout (POST), wynik płatności (GET /:session)
 *   /api/admin/*         API panelu (logowanie, produkty, kategorie, zamówienia, upload)
 *   /admin/completed     webhook Stripe (adres ustawiony w panelu Stripe)
 *   /media/*             zdjęcia wgrane w panelu (KV)
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
      if (pathname === '/api/checkout') {
        if (request.method !== 'POST') throw new HttpError(405, 'Niedozwolona metoda.');
        return await createCheckout(request, env);
      }
      const checkout = pathname.match(/^\/api\/checkout\/([A-Za-z0-9_]+)$/);
      if (checkout) {
        if (request.method !== 'GET') throw new HttpError(405, 'Niedozwolona metoda.');
        return json(await getCheckoutResult(env, checkout[1]));
      }
      if (pathname === '/admin/completed') return await handleWebhook(request, env);
      if (pathname.startsWith('/api/admin/')) return await handleAdmin(request, env, ctx, pathname.slice('/api/admin/'.length));
      throw new HttpError(404, 'Nie znaleziono.');
    } catch (error) {
      return errorResponse(error);
    }
  },
} satisfies ExportedHandler<Env>;
