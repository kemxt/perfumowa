import type { ApiError } from '../shared/catalog';

/** Błąd z kodem HTTP; `fields` trafia do formularza w panelu jako błędy przy polach. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    const body: ApiError = { error: error.message, ...(error.fields ? { fields: error.fields } : {}) };
    return json(body, { status: error.status });
  }
  console.error(error);
  return json({ error: 'Błąd serwera. Spróbuj ponownie.' } satisfies ApiError, { status: 500 });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, 'Nieprawidłowe dane (oczekiwano JSON).');
  }
}

export function getCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}
