import type { ApiError } from '../../shared/catalog';

export class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

/** Wywoływane przy 401 – main.ts pokazuje okno logowania. */
let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'x-aura-admin': '1' };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(`/api/admin/${path}`, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new RequestError(0, 'Brak połączenia z serwerem.');
  }

  const data = (await response.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!response.ok) {
    if (response.status === 401 && path !== 'login') onUnauthorized();
    throw new RequestError(response.status, data?.error ?? `Błąd ${response.status}`, data?.fields);
  }
  return data as T;
}
