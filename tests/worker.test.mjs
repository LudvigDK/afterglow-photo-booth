import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const cli = 'node_modules/wrangler/bin/wrangler.js';
const run = promisify(execFile);
const site = 'http://127.0.0.1:5173';
const localKey = 'local-development-only-change-this-key-123456';
const jpeg = await readFile(new URL('../src/assets/party.jpg', import.meta.url));
// A tiny, valid grayscale baseline JPEG used as a thumbnail fixture.
const thumbnail = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAA/AK+Af//Z', 'base64');

async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('Worker API with local D1 and R2', { timeout: 60_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'afterglow-test-'));
  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;
  const options = { env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } };
  const wrangler = (...args) => run(process.execPath, [cli, ...args], options);
  t.after(() => rm(dir, { recursive: true, force: true }));
  await wrangler('d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', dir);
  const worker = spawn(process.execPath, [cli, 'dev', '--ip', '127.0.0.1', '--port', String(port),
    '--inspector-port', '0', '--test-scheduled', '--persist-to', dir, '--env-file', '.dev.vars.example',
    '--var', 'FRONTEND_URL:' + site + '/', '--var', 'STORAGE_LIMIT_BYTES:14000000'], options);
  let logs = '';
  worker.stdout.on('data', (line) => { logs += line; });
  worker.stderr.on('data', (line) => { logs += line; });
  const closed = once(worker, 'close');
  try {
    for (let i = 0; ; i++) {
      if ((await fetch(base + '/api/health').catch(() => null))?.ok) break;
      if (i >= 100 || worker.exitCode !== null) throw new Error('Worker did not start.\n' + logs);
      await delay(150);
    }
    const login = (key, origin = base) => fetch(base + '/auth', {
      method: 'POST', redirect: 'manual', headers: { Origin: origin },
      body: new URLSearchParams({ key }),
    });
    const request = (path, { method = 'GET', token, body, headers, ...rest } = {}) => fetch(base + '/api' + path, {
      method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined, ...rest,
    });

    let admin, event, kiosk, liveKey, first, second;
    const upload = (key, token = kiosk, body = Buffer.concat([jpeg, thumbnail]), eventId = event.id) =>
      request(`/events/${eventId}/photos`, { method: 'POST', token, body,
        headers: { 'Content-Type': 'application/octet-stream', 'X-Photo-Bytes': String(jpeg.length), 'X-Capture-Id': key } });

    await t.test('authorization, origin checks and protected event creation', async () => {
      assert.equal((await request('/admin/events')).status, 401);
      assert.equal((await request('/health', { headers: { Origin: 'https://wrong.example' } })).status, 403);
      const preflight = await request('/health', { method: 'OPTIONS', headers: { Origin: site } });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), site);
      assert.equal((await login(localKey, 'https://wrong.example')).status, 403);
      assert.equal((await login('invalid')).status, 401);
      const signedIn = await login(localKey);
      assert.equal(signedIn.status, 303);
      admin = new URLSearchParams(new URL(signedIn.headers.get('Location')).hash.split('?')[1]).get('session');
      const created = await request('/admin/events', { method: 'POST', token: admin, body: { name: 'Test party' } });
      assert.equal(created.status, 201);
      event = await created.json();
      assert.equal(event.settings.countdown, 3);
      assert.equal(event.settings.retentionDays, 7);
      const links = await (await request(`/admin/events/${event.id}/links`, { token: admin })).json();
      kiosk = links.kiosk;
      liveKey = links.live;
      assert.equal((await request('/admin/events', { token: kiosk })).status, 401);
    });

    await t.test('JPEG validation, event scope, upload idempotency, and download bytes', async () => {
      const other = await (await request('/admin/events', { method: 'POST', token: admin, body: { name: 'Other' } })).json();
      assert.equal((await upload(crypto.randomUUID(), 'wrong')).status, 401);
      assert.equal((await upload(crypto.randomUUID(), kiosk, Buffer.concat([jpeg, thumbnail]), other.id)).status, 401);
      assert.equal((await upload(crypto.randomUUID(), kiosk, Buffer.concat([jpeg, Buffer.from('bad')]))).status, 415);
      const capture = crypto.randomUUID();
      const simultaneous = await Promise.all([upload(capture), upload(capture)]);
      const success = simultaneous.find((response) => response.status === 201);
      assert.ok(success, 'one upload creates the photo: ' + await simultaneous[0].clone().text());
      assert.ok(simultaneous.every((response) => [200, 201, 409].includes(response.status)));
      first = await success.json();
      assert.notEqual(first.id, capture);
      const duplicate = await upload(capture);
      assert.equal(duplicate.status, 200);
      assert.equal((await duplicate.json()).id, first.id);
      const original = await request(`/photos/${first.id}/download`);
      assert.equal(original.status, 200);
      assert.match(original.headers.get('Content-Disposition'), /^attachment;/);
      assert.deepEqual(Buffer.from(await original.arrayBuffer()), jpeg);
      const thumb = await request(`/photos/${first.id}/thumb`);
      assert.deepEqual(Buffer.from(await thumb.arrayBuffer()), thumbnail);
      assert.equal((await request(`/photos/${first.id}/thumb`, { headers: { 'If-None-Match': thumb.headers.get('ETag') } })).status, 304);
      const otherGallery = await (await request(`/events/${other.id}/gallery`)).json();
      assert.deepEqual(otherGallery.photos, []);
    });

    await t.test('live revisions, display modes and private gallery access', async () => {
      const livePath = `/events/${event.id}/live`;
      const latest = await request(livePath);
      const tag = latest.headers.get('ETag');
      assert.equal((await latest.json()).photos[0][0], first.id);
      assert.equal((await request(livePath, { headers: { 'If-None-Match': tag } })).status, 304);
      const uploaded = await upload(crypto.randomUUID());
      assert.equal(uploaded.status, 201);
      second = await uploaded.json();
      const updated = await request(livePath, { headers: { 'If-None-Match': tag } });
      assert.deepEqual((await updated.json()).photos.map(([id]) => id), [second.id]);
      const save = (settings) => request(`/admin/events/${event.id}`, {
        method: 'PUT', token: admin, body: { name: event.name, settings },
      });
      assert.equal((await save({ ...event.settings, slideSeconds: -1 })).status, 400);
      assert.equal((await save({ ...event.settings, mode: 'all' })).status, 200);
      assert.deepEqual((await (await request(livePath)).json()).photos.map(([id]) => id), [second.id, first.id]);
      assert.equal((await save({ ...event.settings, mode: 'recent', recentCount: 1, galleryVisible: false })).status, 200);
      assert.equal((await request(livePath)).status, 403);
      assert.deepEqual((await (await request(livePath, { token: liveKey })).json()).photos.map(([id]) => id), [second.id]);
      assert.equal((await request(`/events/${event.id}/gallery`)).status, 404);
      assert.equal((await request(`/admin/events/${event.id}/gallery`, { token: admin })).status, 200);
      assert.equal((await request(`/photos/${first.id}`)).status, 200);
      assert.equal((await save(event.settings)).status, 200);
    });

    await t.test('pagination, expiry, cleanup, and revocation', async () => {
      const gallery = `/events/${event.id}/gallery`;
      for (let i = 0; i < 24; i++) {
        const response = await upload(crypto.randomUUID());
        assert.equal(response.status, 201);
      }
      const head = await (await request(gallery)).json();
      assert.equal(head.photos.length, 24);
      const tail = await (await request(gallery + '?before=' + encodeURIComponent(head.next))).json();
      assert.deepEqual(tail.photos.map(({ id }) => id), [second.id, first.id]);
      await wrangler('d1', 'execute', 'DB', '--local', '--persist-to', dir,
        '--command', `UPDATE photos SET expires_at = 0 WHERE id = '${first.id}'`);
      assert.equal((await request(`/photos/${first.id}/download`)).status, 404);
      const scheduled = await fetch(base + '/__scheduled?cron=' + encodeURIComponent('*/10 * * * *'));
      assert.equal(scheduled.status, 200, await scheduled.text());
      const row = await wrangler('d1', 'execute', 'DB', '--local', '--persist-to', dir, '--json',
        '--command', `SELECT id FROM photos WHERE id = '${first.id}'`);
      assert.deepEqual(JSON.parse(row.stdout)[0].results, []);
      const object = await wrangler('r2', 'object', 'get', `afterglow-photos/photos/${event.id}/${first.id}.jpg`,
        '--local', '--persist-to', dir, '--file', join(dir, 'expired.jpg')).catch((issue) => issue);
      assert.ok(object.code, 'expired image was removed from local R2');
      const newLinks = await request(`/admin/events/${event.id}/links`, { method: 'POST', token: admin });
      assert.equal(newLinks.status, 200);
      assert.notEqual((await newLinks.json()).kiosk, kiosk);
      assert.equal((await upload(crypto.randomUUID())).status, 401);
    });

    await t.test('quota reservations and authorized deletion', async () => {
      const link = await (await request(`/admin/events/${event.id}/links`, { token: admin })).json();
      // 25 objects remain at about 510 kB per capture. The configured cap holds 27.
      const results = await Promise.all(Array.from({ length: 4 }, () => upload(crypto.randomUUID(), link.kiosk)));
      assert.deepEqual(results.map(({ status }) => status).sort(), [201, 201, 507, 507]);
      const photoPath = `/admin/events/${event.id}/photos/${second.id}`;
      assert.equal((await request(photoPath, { method: 'DELETE', token: kiosk })).status, 401);
      assert.equal((await request(photoPath, { method: 'DELETE', token: admin })).status, 204);
      assert.equal((await request(`/photos/${second.id}/thumb`)).status, 404);
      assert.equal((await request(`/admin/events/${event.id}/photos`, { method: 'DELETE', token: admin })).status, 204);
      assert.deepEqual((await (await request(`/events/${event.id}/gallery`)).json()).photos, []);
      assert.equal((await request(`/admin/events/${event.id}`, { method: 'DELETE', token: admin })).status, 204);
      assert.equal((await request(`/events/${event.id}/live`)).status, 404);
    });
  } finally {
    worker.kill('SIGTERM');
    await closed;
  }
});
