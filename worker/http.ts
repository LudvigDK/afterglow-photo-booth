export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  FRONTEND_URL: string;
  STORAGE_LIMIT_BYTES?: string;
  ADMIN_ACCESS_KEY?: string;
  SIGNING_KEY?: string;
  LOGIN_LIMIT: RateLimit;
  UPLOAD_LIMIT: RateLimit;
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly headers?: HeadersInit) {
    super(message);
  }
}

export function json(body: unknown, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
  if (!responseHeaders.has('Cache-Control')) responseHeaders.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

export async function readBytes(request: Request, max: number) {
  const length = request.headers.get('Content-Length');
  if (length && Number(length) > max) throw new HttpError(413, 'The request is too large.');
  if (!request.body) throw new HttpError(400, 'The request body is missing.');
  const reader = request.body.getReader();
  let buffer = new Uint8Array(Math.min(max, Math.max(Number(length) || 1024, 1)));
  let offset = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return buffer.subarray(0, offset);
      const total = offset + value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => {});
        throw new HttpError(413, 'The request is too large.');
      }
      if (total > buffer.length) {
        const expanded = new Uint8Array(Math.min(max, Math.max(total, buffer.length * 2)));
        expanded.set(buffer);
        buffer = expanded;
      }
      buffer.set(value, offset);
      offset = total;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') {
    throw new HttpError(415, 'Send an application/json request.');
  }
  const body = await readBytes(request, 4096);
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'The request contains invalid JSON.');
  }
}

export function frontendUrl(env: Env) {
  try {
    const url = new URL(env.FRONTEND_URL);
    const local = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.hash || url.search) {
      throw new Error();
    }
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url;
  } catch {
    throw new HttpError(503, 'Set FRONTEND_URL to the website address in the Worker configuration.');
  }
}

export function conditional(request: Request, tag: string) {
  return request.headers.get('If-None-Match')?.split(',').some((value) =>
    value.trim().replace(/^W\//, '') === tag || value.trim() === '*');
}

export function unavailable(message = 'The service is temporarily unavailable. Please try again.') {
  return new HttpError(503, message, { 'Retry-After': '5' });
}
