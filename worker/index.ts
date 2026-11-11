import { isId } from '../shared/model';
import { auth, requireAdmin } from './auth';
import { adminEvent, adminEvents, publicEvent } from './events';
import { frontendUrl, HttpError, json, unavailable, type Env } from './http';
import { cleanUp, servePhoto } from './photos';

async function route(request: Request, env: Env, path: string, ctx: ExecutionContext) {
  if (path === '/auth') return auth(request, env);
  const [, api, group, id, action, sub, photo, ...rest] = path.split('/');
  if (api !== 'api' || rest.length) throw new HttpError(404, 'This endpoint could not be found.');
  if (group === 'admin') {
    await requireAdmin(request, env);
    if (id === 'events' && !action && !sub && !photo) return adminEvents(request, env);
    if (id === 'events' && action && isId(action)) {
      if ((!sub || ['gallery', 'links', 'photos'].includes(sub))
          && (!photo || (sub === 'photos' && isId(photo)))) {
        return adminEvent(request, env, action, sub, photo);
      }
    }
  }
  if (group === 'events' && id && isId(id) && !sub && !photo) return publicEvent(request, env, ctx, id, action);
  if (group === 'photos' && id && isId(id) && !sub && !photo && (!action || ['image', 'thumb', 'download'].includes(action))) {
    if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
    return servePhoto(request, env, id, action);
  }
  if (group === 'health' && !id && !action && !sub && !photo && request.method === 'GET') return json({ status: 'ok' });
  throw new HttpError(404, 'This endpoint could not be found.');
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const path = new URL(request.url).pathname;
    const origin = request.headers.get('Origin');
    let response: Response;
    let allowCors = false;
    try {
      if (path.startsWith('/api/') && origin) {
        if (origin !== frontendUrl(env).origin) throw new HttpError(403, 'This website is not allowed to use the API.');
        allowCors = true;
      }
      if (request.method === 'OPTIONS' && allowCors) {
        response = new Response(null, { status: 204, headers: {
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match, X-Capture-Id, X-Photo-Bytes',
          'Access-Control-Max-Age': '86400',
        } });
      } else {
        response = await route(request, env, path, ctx);
      }
    } catch (error) {
      if (!(error instanceof HttpError)) console.error('Worker request failed', error instanceof Error ? error.message : 'Unknown error');
      const issue = error instanceof HttpError ? error : unavailable();
      response = json({ error: issue.message }, issue.status, issue.headers);
    }
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    if (!headers.has('Referrer-Policy')) headers.set('Referrer-Policy', 'no-referrer');
    if (path.startsWith('/api/')) headers.append('Vary', 'Origin');
    if (allowCors && origin) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Expose-Headers', 'ETag, Retry-After, Content-Disposition');
    }
    return new Response(response.body, { status: response.status, headers });
  },
  async scheduled(_controller: ScheduledController, env: Env) {
    console.log('Photo cleanup', await cleanUp(env));
  },
} satisfies ExportedHandler<Env>;
