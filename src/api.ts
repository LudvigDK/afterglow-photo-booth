export const apiBase = (import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://127.0.0.1:8787' : '')).replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfter = 0) { super(message); }
}

export async function api<T>(path: string, options: RequestInit & { token?: string; tag?: string; timeout?: number } = {}) {
  if (!apiBase) throw new ApiError('Set VITE_API_URL before building the website.', 0);
  const { token, tag, timeout = 15_000, signal, ...init } = options;
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (tag) headers.set('If-None-Match', tag);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = window.setTimeout(abort, timeout);
  try {
    const response = await fetch(`${apiBase}/api${path}`, { ...init, headers, signal: controller.signal, cache: 'no-store' });
    if (response.status === 304 || response.status === 204) {
      return { data: null, tag: response.headers.get('ETag') ?? tag };
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      throw new ApiError(body?.error ?? 'The service is temporarily unavailable.', response.status,
        Number(response.headers.get('Retry-After')) || 0);
    }
    return { data: await response.json() as T, tag: response.headers.get('ETag') ?? undefined };
  } catch (error) {
    if (error instanceof ApiError || signal?.aborted) throw error;
    throw new ApiError('Connection interrupted. Check your connection and try again.', 0);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export const imageUrl = (id: string, variant: 'image' | 'thumb' | 'download' = 'image') =>
  `${apiBase}/api/photos/${id}/${variant}`;

export function appUrl(path: string) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = path;
  return url.href;
}

export const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Try again.';
const memory = new Map<string, string>();

export function readToken(key: string) {
  try { return sessionStorage.getItem(key) ?? memory.get(key) ?? ''; }
  catch { return memory.get(key) ?? ''; }
}

export function saveToken(key: string, value: string) {
  if (value) memory.set(key, value); else memory.delete(key);
  try { if (value) sessionStorage.setItem(key, value); else sessionStorage.removeItem(key); }
  catch { /* The current tab can continue using its in-memory credentials. */ }
}

// Remove scoped credentials from the address bar before mounting the router.
export function consumeLink() {
  const [path, query] = location.hash.slice(1).split('?', 2);
  if (!query) return;
  const params = new URLSearchParams(query);
  const session = params.get('session');
  if (session && path === '/admin' && /^\d{13}\.[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(session)) {
    saveToken('admin', session);
  }
  const token = params.get('key');
  if (token && /^\/(booth|live)\/[a-f0-9-]{36}$/.test(path) && /^[a-f0-9]{64}$/.test(token)) {
    saveToken(path, token);
  }
  if (params.has('key') || params.has('session')) {
    params.delete('key');
    params.delete('session');
    history.replaceState(history.state, '', `#${path}${params.size ? '?' + params : ''}`);
  }
}

export async function copyText(value: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  throw new Error('Select the link to copy it on this browser.');
}
