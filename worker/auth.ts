import { frontendUrl, HttpError, readBytes, type Env } from './http';

const encode = new TextEncoder();
const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (byte) =>
  byte.toString(16).padStart(2, '0')).join('');

async function signingKey(env: Env) {
  if (!env.SIGNING_KEY || env.SIGNING_KEY.length < 32) {
    throw new HttpError(503, 'Configure the Worker signing key.');
  }
  return crypto.subtle.importKey('raw', encode.encode(env.SIGNING_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function sign(env: Env, message: string) {
  return hex(await crypto.subtle.sign('HMAC', await signingKey(env), encode.encode(message)));
}

async function verify(env: Env, message: string, signature: string) {
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  const bytes = Uint8Array.from(signature.match(/../g)!, (pair) => parseInt(pair, 16));
  return crypto.subtle.verify('HMAC', await signingKey(env), bytes, encode.encode(message));
}

function bearer(request: Request) {
  return request.headers.get('Authorization')?.match(/^Bearer ([a-zA-Z0-9._-]{1,180})$/)?.[1] ?? '';
}

export async function requireAdmin(request: Request, env: Env) {
  const [expires, nonce, signature, extra] = bearer(request).split('.');
  if (extra !== undefined || !/^\d{13}$/.test(expires) || Number(expires) <= Date.now()
      || !/^[a-f0-9-]{36}$/.test(nonce ?? '')
      || !await verify(env, `admin.${expires}.${nonce}`, signature ?? '')) {
    throw new HttpError(401, 'Sign in to manage events.');
  }
}

export const liveToken = (env: Env, id: string) => sign(env, `live.${id}`);
export const hasLiveAccess = (request: Request, env: Env, id: string) =>
  verify(env, `live.${id}`, bearer(request));

export const kioskToken = (env: Env, id: string, revision: string) =>
  sign(env, `kiosk.${id}.${revision}`);

export async function requireKiosk(request: Request, env: Env, id: string, revision: string) {
  if (!await verify(env, `kiosk.${id}.${revision}`, bearer(request))) {
    throw new HttpError(401, 'Open the current booth link from the event dashboard.');
  }
}

function loginPage(env: Env, message = '', status = 200, retry = false) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="same-origin"><title>Sign in · Afterglow</title>
<style>
  *{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:#141118;color:#f9f0eb;font:16px system-ui,sans-serif}
  main{width:min(100%,430px);padding:36px;background:#201a25;border:1px solid #3d303e;border-radius:26px}
  h1{font-size:38px;letter-spacing:-.055em;margin:14px 0 9px}p{line-height:1.55;color:#c2b1c1}
  strong{color:#ffc0aa}label,input,button{display:block;width:100%}label{margin:23px 0 8px}
  input,button{border-radius:12px;min-height:50px;padding:12px 15px;font:inherit}
  input{border:1px solid #554354;background:#141118;color:#f9f0eb}button{border:0;margin-top:16px;background:#ffc0aa;color:#271821;font-weight:750;cursor:pointer}
  .error{color:#ffb3a6}
</style></head><body><main><strong>✦ Afterglow</strong><h1>Admin sign in</h1>
<p>Enter the access key configured on your Cloudflare Worker.</p>
${message ? `<p role="alert" class="error">${message}</p>` : ''}
<form action="/auth" method="post"><label for="key">Admin access key</label>
<input id="key" name="key" type="password" autocomplete="current-password" maxlength="256" required>
<button type="submit">Sign in</button></form></main></body></html>`, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Referrer-Policy': 'same-origin',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${frontendUrl(env).origin}; frame-ancestors 'none'`,
      ...(retry ? { 'Retry-After': '60' } : {}),
    },
  });
}

export async function auth(request: Request, env: Env) {
  if (request.method === 'GET') return loginPage(env);
  if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  if (request.headers.get('Origin') !== new URL(request.url).origin) {
    throw new HttpError(403, 'Open the sign-in page directly to continue.');
  }
  const client = request.headers.get('CF-Connecting-IP') ?? 'local';
  if (!(await env.LOGIN_LIMIT.limit({ key: client })).success) {
    return loginPage(env, 'Too many attempts. Try again in a minute.', 429, true);
  }
  if (!env.ADMIN_ACCESS_KEY || env.ADMIN_ACCESS_KEY.length < 32) {
    return loginPage(env, 'An administrator must configure the Worker access key.', 503);
  }
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/x-www-form-urlencoded') {
    throw new HttpError(415, 'Use the sign-in form to continue.');
  }
  const body = await readBytes(request, 1024);
  const provided = new URLSearchParams(new TextDecoder().decode(body)).get('key') ?? '';
  const expected = await sign(env, `login.${env.ADMIN_ACCESS_KEY}`);
  if (!await verify(env, `login.${provided}`, expected)) {
    return loginPage(env, 'That access key is incorrect.', 401);
  }
  const claims = `${Date.now() + 8 * 60 * 60 * 1000}.${crypto.randomUUID()}`;
  const session = `${claims}.${await sign(env, `admin.${claims}`)}`;
  const destination = frontendUrl(env);
  destination.hash = `/admin?session=${session}`;
  return new Response(null, { status: 303, headers: { Location: destination.href, 'Cache-Control': 'no-store' } });
}
