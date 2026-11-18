import { HttpError, getCookie, json, readJson } from './http';

/**
 * Logowanie do panelu jednym hasłem (sekret ADMIN_PASSWORD).
 * Sesja to podpisany HMAC-iem token w ciasteczku HttpOnly, widocznym tylko dla /api/admin.
 * Klucz pochodzi z hasła, więc zmiana hasła wylogowuje wszystkie sesje.
 */

const COOKIE = 'aura_admin';
const COOKIE_PATH = '/api/admin';
const SESSION_TTL = 7 * 24 * 60 * 60;
const MIN_PASSWORD_LENGTH = 8;
/** Limit nieudanych prób z jednego IP w oknie czasowym. */
const MAX_ATTEMPTS = 10;
const ATTEMPT_WINDOW = 15 * 60;

const encoder = new TextEncoder();
const now = () => Math.floor(Date.now() / 1000);

const toBase64Url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

function fromBase64Url(text: string): Uint8Array | null {
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

const hmacKey = (env: Env) =>
  crypto.subtle.importKey('raw', encoder.encode(`aura-session:${env.ADMIN_PASSWORD}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

export const isConfigured = (env: Env) => (env.ADMIN_PASSWORD ?? '').length >= MIN_PASSWORD_LENGTH;

function sessionCookie(request: Request, value: string, maxAge: number): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=${COOKIE_PATH}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

async function createSession(env: Env): Promise<string> {
  const payload = `v1.${now() + SESSION_TTL}`;
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(env), encoder.encode(payload));
  return `${payload}.${toBase64Url(signature)}`;
}

export async function isAuthenticated(request: Request, env: Env): Promise<boolean> {
  const token = getCookie(request, COOKIE);
  if (!token) return false;
  const [version, expires, signature] = token.split('.');
  if (version !== 'v1' || !(Number(expires) > now()) || !signature) return false;
  const bytes = fromBase64Url(signature);
  if (!bytes) return false;
  return crypto.subtle.verify('HMAC', await hmacKey(env), bytes, encoder.encode(`${version}.${expires}`));
}

async function passwordMatches(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([given, expected].map((s) => crypto.subtle.digest('SHA-256', encoder.encode(s))));
  return crypto.subtle.timingSafeEqual(a, b);
}

export async function login(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  const since = now() - ATTEMPT_WINDOW;
  const attempts = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND at > ?').bind(ip, since).first<number>('n');
  if ((attempts ?? 0) >= MAX_ATTEMPTS) throw new HttpError(429, 'Za dużo nieudanych prób. Spróbuj ponownie za kwadrans.');

  const { password } = await readJson<{ password?: unknown }>(request);
  if (typeof password !== 'string' || !(await passwordMatches(password, env.ADMIN_PASSWORD))) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO login_attempts (ip, at) VALUES (?, ?)').bind(ip, now()),
      env.DB.prepare('DELETE FROM login_attempts WHERE at < ?').bind(now() - 24 * 60 * 60),
    ]);
    throw new HttpError(401, 'Nieprawidłowe hasło.');
  }

  await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
  return json({ ok: true }, { headers: { 'set-cookie': sessionCookie(request, await createSession(env), SESSION_TTL) } });
}

export function logout(request: Request): Response {
  return json({ ok: true }, { headers: { 'set-cookie': sessionCookie(request, '', 0) } });
}

/**
 * Wspólne warunki dla /api/admin/*: hasło ustawione, nagłówek X-Aura-Admin przy zapisie
 * (formularz z innej domeny nie ustawi go bez CORS) i – poza logowaniem – ważna sesja.
 */
export async function guard(request: Request, env: Env, isLogin: boolean): Promise<void> {
  if (!isConfigured(env)) {
    throw new HttpError(503, `Panel nie jest skonfigurowany: ustaw sekret ADMIN_PASSWORD (min. ${MIN_PASSWORD_LENGTH} znaków).`);
  }
  if (request.method !== 'GET' && request.headers.get('x-aura-admin') !== '1') {
    throw new HttpError(403, 'Brak nagłówka X-Aura-Admin.');
  }
  if (!isLogin && !(await isAuthenticated(request, env))) {
    throw new HttpError(401, 'Sesja wygasła. Zaloguj się ponownie.');
  }
}
