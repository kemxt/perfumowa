import { guard, login, logout } from './auth';
import * as db from './db';
import { HttpError, json, readJson } from './http';
import { deleteMedia, mediaKeys, uploadFile, uploadPhoto } from './media';
import { getOrder, listOrders, updateOrder } from './orders';
import { idParam, validateCategory, validateOrder, validateOrderUpdate, validatePage, validateProduct, validateSettings } from './validate';

interface Context {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  params: string[];
}

type Handler = (c: Context) => Promise<Response> | Response;

/** Usuwa z KV pliki, których produkt już nie używa (po udanym zapisie, w tle). */
function cleanupMedia(c: Context, before: Set<string>, after: Set<string>): void {
  const orphaned = [...before].filter((key) => !after.has(key));
  if (orphaned.length) c.ctx.waitUntil(deleteMedia(c.env, orphaned));
}

const routes: [method: string, path: RegExp, handler: Handler][] = [
  ['POST', /^login$/, ({ request, env }) => login(request, env)],
  ['POST', /^logout$/, ({ request }) => logout(request)],
  ['GET', /^session$/, () => json({ ok: true })],

  ['GET', /^products$/, async ({ env }) => json(await db.listProducts(env.DB))],
  [
    'POST',
    /^products$/,
    async ({ request, env }) => {
      const id = await db.createProduct(env.DB, validateProduct(await readJson(request)));
      return json(await db.getProduct(env.DB, id), { status: 201 });
    },
  ],
  [
    'PUT',
    /^products\/order$/,
    async ({ request, env }) => {
      await db.reorder(env.DB, 'products', validateOrder(await readJson(request)));
      return json({ ok: true });
    },
  ],
  ['GET', /^products\/(\d+)$/, async ({ env, params }) => json(await db.getProduct(env.DB, idParam(params[0])))],
  [
    'PUT',
    /^products\/(\d+)$/,
    async (c) => {
      const id = idParam(c.params[0]);
      const input = validateProduct(await readJson(c.request));
      const before = await db.getProduct(c.env.DB, id);
      await db.updateProduct(c.env.DB, id, input);
      cleanupMedia(c, mediaKeys(before.media), mediaKeys(input.media));
      return json(await db.getProduct(c.env.DB, id));
    },
  ],
  [
    'DELETE',
    /^products\/(\d+)$/,
    async (c) => {
      const id = idParam(c.params[0]);
      const before = await db.getProduct(c.env.DB, id);
      await db.deleteProduct(c.env.DB, id);
      cleanupMedia(c, mediaKeys(before.media), new Set());
      return json({ ok: true });
    },
  ],

  ['GET', /^categories$/, async ({ env }) => json(await db.listCategories(env.DB))],
  [
    'POST',
    /^categories$/,
    async ({ request, env }) => {
      await db.createCategory(env.DB, validateCategory(await readJson(request)));
      return json(await db.listCategories(env.DB), { status: 201 });
    },
  ],
  [
    'PUT',
    /^categories\/order$/,
    async ({ request, env }) => {
      await db.reorder(env.DB, 'categories', validateOrder(await readJson(request)));
      return json(await db.listCategories(env.DB));
    },
  ],
  [
    'PUT',
    /^categories\/(\d+)$/,
    async ({ request, env, params }) => {
      await db.updateCategory(env.DB, idParam(params[0]), validateCategory(await readJson(request)));
      return json(await db.listCategories(env.DB));
    },
  ],
  [
    'DELETE',
    /^categories\/(\d+)$/,
    async ({ env, params }) => {
      await db.deleteCategory(env.DB, idParam(params[0]));
      return json(await db.listCategories(env.DB));
    },
  ],

  ['GET', /^settings$/, async ({ env }) => json(await db.getSettings(env.DB))],
  [
    'PUT',
    /^settings$/,
    async ({ request, env }) => {
      await db.saveSettings(env.DB, validateSettings(await readJson(request)));
      return json(await db.getSettings(env.DB));
    },
  ],

  ['GET', /^pages$/, async ({ env }) => json(await db.listPages(env.DB))],
  [
    'POST',
    /^pages$/,
    async ({ request, env }) => {
      const id = await db.createPage(env.DB, validatePage(await readJson(request)));
      return json(await db.getPage(env.DB, id), { status: 201 });
    },
  ],
  ['GET', /^pages\/(\d+)$/, async ({ env, params }) => json(await db.getPage(env.DB, idParam(params[0])))],
  [
    'PUT',
    /^pages\/(\d+)$/,
    async ({ request, env, params }) => {
      const id = idParam(params[0]);
      await db.updatePage(env.DB, id, validatePage(await readJson(request)));
      return json(await db.getPage(env.DB, id));
    },
  ],
  [
    'DELETE',
    /^pages\/(\d+)$/,
    async ({ env, params }) => {
      await db.deletePage(env.DB, idParam(params[0]));
      return json({ ok: true });
    },
  ],

  ['GET', /^orders$/, async ({ env }) => json(await listOrders(env))],
  ['GET', /^orders\/(\d+)$/, async ({ env, params }) => json(await getOrder(env.DB, idParam(params[0])))],
  [
    'PUT',
    /^orders\/(\d+)$/,
    async ({ request, env, params }) => {
      const id = idParam(params[0]);
      await updateOrder(env.DB, id, validateOrderUpdate(await readJson(request)));
      return json(await getOrder(env.DB, id));
    },
  ],

  ['POST', /^media\/photo$/, ({ request, env }) => uploadPhoto(request, env)],
  ['POST', /^media\/file$/, ({ request, env }) => uploadFile(request, env)],
];

/** /api/admin/* */
export async function handleAdmin(request: Request, env: Env, ctx: ExecutionContext, path: string): Promise<Response> {
  let pathMatched = false;
  for (const [method, pattern, handler] of routes) {
    const match = path.match(pattern);
    if (!match) continue;
    pathMatched = true;
    if (method !== request.method) continue;
    await guard(request, env, path === 'login');
    return handler({ request, env, ctx, params: match.slice(1) });
  }
  throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'Niedozwolona metoda.' : 'Nie znaleziono.');
}
