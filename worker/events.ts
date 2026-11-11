import { defaultSettings, isId, type EventInfo, type LivePhoto } from '../shared/model';
import { hasLiveAccess, kioskToken, liveToken } from './auth';
import { conditional, HttpError, json, readJson, type Env } from './http';
import { markPhotosDeleted, photoDto, storageLimit, upload, type PhotoRow } from './photos';
import { eventName, eventSettings } from './settings';

interface EventRow {
  id: string;
  name: string;
  created_at: number;
  settings: string;
  kiosk_rev: string;
  revision: number;
}
const eventDto = (row: EventRow): EventInfo => ({
  id: row.id, name: row.name, createdAt: row.created_at,
  settings: { ...defaultSettings, ...JSON.parse(row.settings) },
});

async function getEvent(env: Env, id: string) {
  const row = await env.DB.prepare('SELECT * FROM events WHERE id = ? AND deleted = 0')
    .bind(id).first<EventRow>();
  if (!row) throw new HttpError(404, 'This event could not be found.');
  return row;
}

export async function adminEvents(request: Request, env: Env) {
  if (request.method === 'GET') {
    const { results } = await env.DB.prepare(`SELECT id, name, created_at AS createdAt
      FROM events WHERE deleted = 0 ORDER BY created_at DESC`).all();
    return json({ events: results });
  }
  if (request.method === 'POST') {
    const input = await readJson(request);
    const name = eventName(input.name);
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const result = await env.DB.prepare(`INSERT INTO events (id,name,created_at,settings,kiosk_rev)
      SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM events) < 100`)
      .bind(id, name, createdAt, JSON.stringify(defaultSettings), crypto.randomUUID()).run();
    if (!result.meta.changes) throw new HttpError(409, 'This installation can store up to 100 events.');
    return json({ id, name, createdAt, settings: defaultSettings }, 201);
  }
  throw new HttpError(405, 'Method not allowed.');
}

async function gallery(request: Request, env: Env, row: EventRow, now: number) {
  const before = new URL(request.url).searchParams.get('before');
  const cursor = before ? before.match(/^(\d{13})\.([a-f0-9-]+)$/) : null;
  if (before !== null && (!cursor || !isId(cursor[2]))) throw new HttpError(400, 'Invalid gallery cursor.');
  const sql = `SELECT * FROM photos WHERE event_id = ? AND state = 'ready' AND expires_at > ?
    ${cursor ? 'AND (created_at, id) < (?, ?)' : ''} ORDER BY created_at DESC, id DESC LIMIT 25`;
  const query = env.DB.prepare(sql);
  const { results } = await (cursor ? query.bind(row.id, now, Number(cursor[1]), cursor[2]) : query.bind(row.id, now))
    .all<PhotoRow>();
  const photos = results.slice(0, 24).map(photoDto);
  const last = photos.at(-1);
  return { event: eventDto(row), photos, next: results.length > 24 && last ? `${last.createdAt}.${last.id}` : null };
}

async function live(env: Env, event: EventInfo, now: number) {
  const { mode, recentCount } = event.settings;
  const limit = mode === 'latest' ? 1 : mode === 'recent' ? recentCount : 1000;
  const { results } = await env.DB.prepare(`SELECT id, created_at, expires_at FROM photos
    WHERE event_id = ? AND state = 'ready' AND expires_at > ? ORDER BY created_at DESC, id DESC LIMIT ?`)
    .bind(event.id, now, limit).all<Pick<PhotoRow, 'id' | 'created_at' | 'expires_at'>>();
  return { event, photos: results.map((photo): LivePhoto => [photo.id, photo.created_at, photo.expires_at]) };
}

async function feed(request: Request, env: Env, row: EventRow, type: 'gallery' | 'live', admin = false) {
  const event = eventDto(row);
  if (!admin && !event.settings.galleryVisible) {
    if (type === 'gallery') throw new HttpError(404, 'This event’s gallery is private.');
    if (!await hasLiveAccess(request, env, event.id)) {
      throw new HttpError(403, 'Open the live display link from the event dashboard.');
    }
  }
  const now = Date.now();
  const before = type === 'gallery' ? new URL(request.url).searchParams.get('before') : null;
  const nextExpiry = await env.DB.prepare(`SELECT expires_at FROM photos
    WHERE event_id = ? AND state = 'ready' AND expires_at > ? ORDER BY expires_at LIMIT 1`)
    .bind(row.id, now).first<number>('expires_at');
  const tag = `"${type}-${row.id}-${row.revision}-${nextExpiry ?? 0}${before ? '-' + before.slice(0, 50) : ''}"`;
  const headers = { ETag: tag, 'Cache-Control': 'private, no-cache' };
  if (!before && conditional(request, tag)) return new Response(null, { status: 304, headers });
  const data = type === 'gallery' ? await gallery(request, env, row, now) : await live(env, event, now);
  return json(data, 200, headers);
}

export async function publicEvent(request: Request, env: Env, ctx: ExecutionContext, id: string, action?: string) {
  const row = await getEvent(env, id);
  const event = eventDto(row);
  if (!action && request.method === 'GET') {
    const tag = `"event-${row.id}-${row.revision}"`;
    const headers = { ETag: tag, 'Cache-Control': 'private, no-cache' };
    return conditional(request, tag) ? new Response(null, { status: 304, headers }) : json(event, 200, headers);
  }
  if ((action === 'gallery' || action === 'live') && request.method === 'GET') return feed(request, env, row, action);
  if (action === 'photos' && request.method === 'POST') return upload(request, env, ctx, event, row.kiosk_rev);
  throw new HttpError(405, 'Method not allowed.');
}

export async function adminEvent(request: Request, env: Env, id: string, action?: string, photoId?: string) {
  const row = await getEvent(env, id);
  if (!action && request.method === 'GET') {
    const [event, storage] = await env.DB.batch<Record<string, number>>([
      env.DB.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(bytes + thumb_bytes),0) AS bytes
        FROM photos WHERE event_id = ? AND state = 'ready' AND expires_at > ?`).bind(id, Date.now()),
      env.DB.prepare('SELECT bytes AS storageUsed FROM storage_usage WHERE id = 1'),
    ]);
    return json({ ...eventDto(row), ...event.results[0], ...storage.results[0], storageLimit: storageLimit(env) });
  }
  if (!action && request.method === 'PUT') {
    const input = await readJson(request);
    const name = eventName(input.name);
    const settings = eventSettings(input.settings);
    const saved = await env.DB.prepare(`UPDATE events SET name = ?, settings = ?, revision = revision + 1
      WHERE id = ? AND deleted = 0`).bind(name, JSON.stringify(settings), id).run();
    if (!saved.meta.changes) throw new HttpError(404, 'This event could not be found.');
    return json({ ...eventDto(row), name, settings });
  }
  if (!action && request.method === 'DELETE') {
    await env.DB.batch([
      env.DB.prepare('UPDATE events SET deleted = 1 WHERE id = ?').bind(id),
      env.DB.prepare("UPDATE photos SET state = 'deleting' WHERE event_id = ? AND state <> 'deleting'").bind(id),
    ]);
    return new Response(null, { status: 204 });
  }
  if (action === 'gallery' && request.method === 'GET') return feed(request, env, row, 'gallery', true);
  if (action === 'links' && request.method === 'GET') {
    return json({ kiosk: await kioskToken(env, id, row.kiosk_rev), live: await liveToken(env, id) });
  }
  if (action === 'links' && request.method === 'POST') {
    const revision = crypto.randomUUID();
    const saved = await env.DB.prepare('UPDATE events SET kiosk_rev = ? WHERE id = ? AND deleted = 0').bind(revision, id).run();
    if (!saved.meta.changes) throw new HttpError(404, 'This event could not be found.');
    return json({ kiosk: await kioskToken(env, id, revision), live: await liveToken(env, id) });
  }
  if (action === 'photos' && request.method === 'DELETE') {
    await markPhotosDeleted(env, id, photoId);
    return new Response(null, { status: 204 });
  }
  throw new HttpError(405, 'Method not allowed.');
}
