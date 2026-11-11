import {
  DAY, MAX_DAILY_UPLOADS, MAX_EVENT_PHOTOS, MAX_PHOTO_BYTES, MAX_THUMB_BYTES,
  isId, type EventInfo, type Photo,
} from '../shared/model';
import { requireKiosk } from './auth';
import { conditional, HttpError, json, readBytes, unavailable, type Env } from './http';

export interface PhotoRow {
  id: string;
  event_id: string;
  storage_key: string;
  content_type: Photo['type'];
  created_at: number;
  expires_at: number;
  bytes: number;
  state: 'pending' | 'ready' | 'deleting';
  lease_until: number;
}

export const photoDto = (row: PhotoRow): Photo => ({
  id: row.id, eventId: row.event_id, createdAt: row.created_at,
  expiresAt: row.expires_at, bytes: row.bytes, type: row.content_type,
});

export function storageLimit(env: Env) {
  const configured = Number(env.STORAGE_LIMIT_BYTES ?? '5000000000');
  return Number.isSafeInteger(configured) && configured >= 0 ? Math.min(configured, 5_000_000_000) : 0;
}

function validJpeg(bytes: Uint8Array, maxEdge: number) {
  const last = bytes.length - 2;
  if (last < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[last] !== 0xff || bytes[last + 1] !== 0xd9) {
    return false;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let dimensions = false;
  for (let offset = 2, segments = 0; offset + 3 < last && segments < 128; segments++) {
    if (bytes[offset++] !== 0xff) return false;
    const marker = bytes[offset++];
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > last) return false;
    if (marker === 0xda) return dimensions && length >= 8 && offset + length < last;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (length < 11 || bytes[offset + 2] !== 8) return false;
      const height = view.getUint16(offset + 3);
      const width = view.getUint16(offset + 5);
      if (!height || !width || Math.max(height, width) > maxEdge) return false;
      dimensions = true;
    }
    offset += length;
  }
  return false;
}

async function deleteObjects(env: Env, rows: Pick<PhotoRow, 'id' | 'storage_key'>[]) {
  if (!rows.length) return;
  await env.IMAGES.delete(rows.flatMap(({ storage_key: key }) => [key + '.jpg', key + '-thumb.jpg']));
  const ids = rows.map(({ id }) => id);
  await env.DB.prepare(`DELETE FROM photos WHERE id IN (${ids.map(() => '?').join(',')})
    AND state = 'deleting' AND lease_until <= ?`).bind(...ids, Date.now()).run();
}

export async function cleanUp(env: Env, now = Date.now()) {
  // Bound each run. Pending reservations abandoned by a terminated Worker are recoverable.
  const expired = await env.DB.prepare(`UPDATE photos SET state = 'deleting'
    WHERE id IN (SELECT id FROM photos WHERE state = 'ready' AND expires_at <= ? LIMIT 80)`)
    .bind(now).run();
  const abandoned = await env.DB.prepare(`UPDATE photos SET state = 'deleting'
    WHERE id IN (SELECT id FROM photos WHERE state = 'pending' AND lease_until <= ? LIMIT 80)`)
    .bind(now).run();
  const { results } = await env.DB.prepare(`SELECT id, storage_key FROM photos
    WHERE state = 'deleting' AND lease_until <= ? ORDER BY lease_until LIMIT 80`)
    .bind(now).all<PhotoRow>();
  await deleteObjects(env, results);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM daily_uploads WHERE day < ?').bind(Math.floor(now / DAY) - 2),
    env.DB.prepare(`DELETE FROM events WHERE id IN (
      SELECT id FROM events WHERE deleted = 1 AND reserved = 0 LIMIT 50)`),
  ]);
  return { expired: expired.meta.changes, abandoned: abandoned.meta.changes, removed: results.length };
}

export async function upload(request: Request, env: Env, ctx: ExecutionContext, event: EventInfo, revision: string) {
  await requireKiosk(request, env, event.id, revision);
  const requestId = request.headers.get('X-Capture-Id') ?? '';
  if (!isId(requestId)) throw new HttpError(400, 'A capture ID is required.');
  const existing = await env.DB.prepare('SELECT * FROM photos WHERE event_id = ? AND request_id = ?')
    .bind(event.id, requestId).first<PhotoRow>();
  if (existing?.state === 'ready' && existing.expires_at > Date.now()) return json(photoDto(existing));
  if (existing) {
    throw new HttpError(409, 'This capture is still being processed. Try again shortly.', { 'Retry-After': '5' });
  }
  if (!(await env.UPLOAD_LIMIT.limit({ key: event.id })).success) {
    throw new HttpError(429, 'The booth is receiving too many uploads. Try again in a minute.', { 'Retry-After': '60' });
  }
  if (request.headers.get('Content-Type') !== 'application/octet-stream') {
    throw new HttpError(415, 'Send a JPEG and its JPEG thumbnail.');
  }
  const originalLength = Number(request.headers.get('X-Photo-Bytes'));
  if (!Number.isInteger(originalLength) || originalLength < 16 || originalLength > MAX_PHOTO_BYTES) {
    throw new HttpError(413, 'The original photo exceeds the 4 MB upload limit.');
  }
  const bytes = await readBytes(request, originalLength + MAX_THUMB_BYTES);
  const original = bytes.subarray(0, originalLength);
  const thumb = bytes.subarray(originalLength);
  if (!validJpeg(original, 4096) || !validJpeg(thumb, 640)) {
    throw new HttpError(415, 'The photo or thumbnail is an unsupported JPEG.');
  }
  const now = Date.now();
  const id = crypto.randomUUID();
  const key = `photos/${event.id}/${id}`;
  const expiresAt = now + event.settings.retentionDays * DAY;
  // D1 serializes writes. This single statement checks and reserves quota before any R2 write.
  const row = await env.DB.prepare(`INSERT INTO photos
    (id, event_id, request_id, storage_key, created_at, expires_at, lease_until, bytes, thumb_bytes, state)
    SELECT ?, id, ?, ?, ?, ?, ?, ?, ?, 'pending' FROM events
    WHERE id = ? AND deleted = 0 AND kiosk_rev = ? AND reserved < ?
      AND (SELECT bytes FROM storage_usage WHERE id = 1) + ? <= ?
      AND COALESCE((SELECT attempts FROM daily_uploads WHERE day = ?), 0) < ?
    ON CONFLICT(event_id, request_id) DO NOTHING RETURNING *`)
    .bind(id, requestId, key, now, expiresAt, now + 15 * 60_000, original.length, thumb.length,
      event.id, revision, MAX_EVENT_PHOTOS, bytes.length, storageLimit(env), Math.floor(now / DAY), MAX_DAILY_UPLOADS)
    .first<PhotoRow>();
  if (!row) {
    const concurrent = await env.DB.prepare('SELECT * FROM photos WHERE event_id = ? AND request_id = ?')
      .bind(event.id, requestId).first<PhotoRow>();
    if (concurrent?.state === 'ready' && concurrent.expires_at > Date.now()) return json(photoDto(concurrent));
    if (concurrent) throw new HttpError(409, 'The capture is still being uploaded.', { 'Retry-After': '5' });
    const current = await env.DB.prepare('SELECT kiosk_rev FROM events WHERE id = ? AND deleted = 0')
      .bind(event.id).first<string>('kiosk_rev');
    if (current !== revision) throw new HttpError(401, 'Open the current booth link from the event dashboard.');
    throw new HttpError(507, 'The booth has reached its storage, event, or daily upload limit. Contact the event host.');
  }

  const finished = storeUpload(env, row, original, thumb);
  // Complete a reserved capture even if the tablet closes the connection.
  ctx.waitUntil(finished.catch(() => {}));
  return finished;
}

async function storeUpload(env: Env, row: PhotoRow, original: Uint8Array<ArrayBuffer>, thumb: Uint8Array<ArrayBuffer>) {
  const { id, storage_key: key } = row;
  const options = { storageClass: 'Standard' as const, httpMetadata: { contentType: 'image/jpeg' } };
  const results = await Promise.allSettled([
    env.IMAGES.put(key + '.jpg', original, options),
    env.IMAGES.put(key + '-thumb.jpg', thumb, options),
  ]);
  if (results.every((result) => result.status === 'fulfilled' && result.value !== null)) {
    const ready = await env.DB.prepare(`UPDATE photos SET state = 'ready', lease_until = 0
      WHERE id = ? AND state = 'pending' AND lease_until > ? RETURNING *`).bind(id, Date.now()).first<PhotoRow>();
    if (ready) return json(photoDto(ready), 201);
  }
  await env.DB.prepare("UPDATE photos SET state = 'deleting', lease_until = 0 WHERE id = ? AND state <> 'ready'")
    .bind(id).run();
  await deleteObjects(env, [row]).catch(() => {});
  if (results.some((result) => result.status === 'rejected')) throw unavailable('The photo could not be stored. Retry the upload.');
  throw new HttpError(409, 'The capture was cancelled. Open the current booth link to continue.');
}

export async function markPhotosDeleted(env: Env, eventId: string, photoId?: string) {
  const query = env.DB.prepare(`UPDATE photos SET state = 'deleting'
    WHERE event_id = ? ${photoId ? 'AND id = ?' : ''} AND state <> 'deleting'`);
  const result = await (photoId ? query.bind(eventId, photoId) : query.bind(eventId)).run();
  if (photoId && !result.meta.changes) throw new HttpError(404, 'This photo has already been removed.');
  if (photoId) {
    const row = await env.DB.prepare('SELECT id, storage_key FROM photos WHERE id = ? AND lease_until <= ?')
      .bind(photoId, Date.now()).first<PhotoRow>();
    if (row) await deleteObjects(env, [row]).catch(() => {});
  }
}

export async function servePhoto(request: Request, env: Env, id: string, variant?: string) {
  const row = await env.DB.prepare(`SELECT p.*, e.name AS event_name, e.settings
    FROM photos p JOIN events e ON e.id = p.event_id
    WHERE p.id = ? AND p.state = 'ready' AND p.expires_at > ? AND e.deleted = 0`)
    .bind(id, Date.now()).first<PhotoRow & { event_name: string; settings: string }>();
  if (!row) throw new HttpError(404, 'This photo has expired or was removed.');
  if (!variant) {
    return json({ ...photoDto(row), eventName: row.event_name, galleryVisible: JSON.parse(row.settings).galleryVisible });
  }

  const tag = `"${row.id}-${variant}"`;
  const ttl = Math.max(0, Math.min(60, Math.floor((row.expires_at - Date.now()) / 1000)));
  const headers = new Headers({
    'Content-Type': row.content_type,
    'Cache-Control': `private, max-age=${ttl}, must-revalidate`,
    ETag: tag,
  });
  if (variant === 'download') headers.set('Content-Disposition', `attachment; filename="afterglow-${id}.jpg"`);
  if (conditional(request, tag)) return new Response(null, { status: 304, headers });
  const thumb = variant === 'thumb';
  const object = await env.IMAGES.get(row.storage_key + (thumb ? '-thumb.jpg' : '.jpg'));
  if (!object) throw new HttpError(404, 'This photo is no longer available.');
  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { headers });
}
