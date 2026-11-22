const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

const COLUMNS = 'id, title, body, level, url, pinned, published, starts_at, ends_at, created_at, updated_at';
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(payload, status = 200, extra = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...CORS,
      ...extra,
    },
  });
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function adminAllowed(request, env) {
  const secret = String(env.ANNOUNCE_ADMIN_TOKEN || '');
  if (secret.length < 16) return false;
  const header = String(request.headers.get('authorization') || '');
  if (!header.startsWith('Bearer ')) return false;
  return safeEqual(header.slice(7).trim(), secret);
}

async function readJsonBody(request, limit = 8192) {
  const text = await request.text();
  if (text.length > limit) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

const GATEWAY_TIMEOUT = 8000;

function gateway(env) {
  const url = String(env.PG_GATEWAY_URL || '').replace(/\/+$/, '');
  const key = String(env.PG_GATEWAY_KEY || '');
  if (!url.startsWith('https://') || key.length < 20) return null;
  return { url, key };
}

async function rest(conn, path, { method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT);
  try {
    const headers = { Authorization: `Bearer ${conn.key}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers.Prefer = 'return=representation';
    const res = await fetch(`${conn.url}/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function mapRow(row) {
  const iso = (value) => (value ? new Date(value).toISOString() : null);
  return {
    id: row.id,
    title: row.title,
    body: row.body || '',
    level: row.level || 'info',
    url: row.url || '',
    pinned: Boolean(row.pinned),
    published: Boolean(row.published),
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function parseOptionalTime(value) {
  if (value == null || value === '') return { ok: true, value: null };
  const time = Date.parse(value);
  return Number.isFinite(time) ? { ok: true, value: new Date(time).toISOString() } : { ok: false };
}

function cleanInput(body) {
  if (!body || typeof body !== 'object') return { error: 'invalid_body' };
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 120) return { error: 'invalid_title' };
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (text.length > 2000) return { error: 'invalid_text' };
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (url && (!/^https?:\/\//i.test(url) || url.length > 500)) return { error: 'invalid_url' };
  const startsAt = parseOptionalTime(body.startsAt);
  const endsAt = parseOptionalTime(body.endsAt);
  if (!startsAt.ok || !endsAt.ok) return { error: 'invalid_time' };
  if (startsAt.value && endsAt.value && new Date(endsAt.value) <= new Date(startsAt.value)) {
    return { error: 'invalid_time_range' };
  }
  return {
    data: {
      title,
      body: text,
      level: body.level === 'warning' ? 'warning' : 'info',
      url,
      pinned: body.pinned === true,
      published: body.published !== false,
      startsAt: startsAt.value,
      endsAt: endsAt.value,
    },
  };
}

async function publicList(conn, url) {
  const limit = Math.max(1, Math.min(20, Number(url.searchParams.get('limit')) || 5));
  const query = `announcements?select=${encodeURIComponent(COLUMNS)}&published=eq.true&order=pinned.desc,created_at.desc&limit=50`;
  const res = await rest(conn, query);
  if (!res.ok || !Array.isArray(res.data)) throw new Error(`gateway_${res.status}`);
  const now = Date.now();
  const active = res.data
    .filter((row) => {
      if (row.starts_at && Date.parse(row.starts_at) > now) return false;
      if (row.ends_at && Date.parse(row.ends_at) <= now) return false;
      return true;
    })
    .map(mapRow)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return Date.parse(b.startsAt || b.createdAt) - Date.parse(a.startsAt || a.createdAt);
    })
    .slice(0, limit);
  return { updatedAt: new Date().toISOString(), items: active };
}

async function adminList(conn) {
  const query = `announcements?select=${encodeURIComponent(COLUMNS)}&order=pinned.desc,created_at.desc&limit=200`;
  const res = await rest(conn, query);
  if (!res.ok || !Array.isArray(res.data)) throw new Error(`gateway_${res.status}`);
  return { ok: true, items: res.data.map(mapRow) };
}

function toRow(item) {
  return {
    title: item.title,
    body: item.body,
    level: item.level,
    url: item.url,
    pinned: item.pinned,
    published: item.published,
    starts_at: item.startsAt,
    ends_at: item.endsAt,
  };
}

async function createItem(conn, request) {
  const body = await readJsonBody(request);
  const input = cleanInput(body);
  if (input.error) return json({ ok: false, error: input.error }, 400);
  const row = { id: crypto.randomUUID(), ...toRow(input.data) };
  const res = await rest(conn, `announcements?select=${encodeURIComponent(COLUMNS)}`, { method: 'POST', body: row });
  if (!res.ok || !Array.isArray(res.data) || !res.data.length) throw new Error(`gateway_${res.status}`);
  return json({ ok: true, item: mapRow(res.data[0]) }, 201);
}

async function updateItem(conn, request, id) {
  const body = await readJsonBody(request);
  const input = cleanInput(body);
  if (input.error) return json({ ok: false, error: input.error }, 400);
  const row = { ...toRow(input.data), updated_at: new Date().toISOString() };
  const res = await rest(conn, `announcements?id=eq.${id}&select=${encodeURIComponent(COLUMNS)}`, { method: 'PATCH', body: row });
  if (!res.ok) throw new Error(`gateway_${res.status}`);
  if (!Array.isArray(res.data) || !res.data.length) return json({ ok: false, error: 'not_found' }, 404);
  return json({ ok: true, item: mapRow(res.data[0]) });
}

async function removeItem(conn, id) {
  const res = await rest(conn, `announcements?id=eq.${id}&select=id`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`gateway_${res.status}`);
  if (!Array.isArray(res.data) || !res.data.length) return json({ ok: false, error: 'not_found' }, 404);
  return json({ ok: true, id: res.data[0].id });
}

async function handleAnnouncements(request, url, env) {
  const conn = gateway(env);
  if (!conn) return json({ ok: false, error: 'pg_not_configured' }, 503);

  const path = url.pathname;
  const admin = path.startsWith('/api/announcements/admin');

  try {
    if (!admin) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ ok: false, error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
      }
      return json(await publicList(conn, url), 200, {
        'Cache-Control': 'public, max-age=30, stale-while-revalidate=120',
      });
    }

    if (!adminAllowed(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);

    if (path === '/api/announcements/admin') {
      if (request.method === 'GET' || request.method === 'HEAD') {
        return json(await adminList(conn), 200, { 'Cache-Control': 'no-store' });
      }
      if (request.method === 'POST') return await createItem(conn, request);
      return json({ ok: false, error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD, POST' });
    }

    const id = path.slice('/api/announcements/admin/'.length);
    if (!ID_PATTERN.test(id)) return json({ ok: false, error: 'not_found' }, 404);
    if (request.method === 'PUT') return await updateItem(conn, request, id);
    if (request.method === 'DELETE') return await removeItem(conn, id);
    return json({ ok: false, error: 'method_not_allowed' }, 405, { Allow: 'PUT, DELETE' });
  } catch (error) {
    console.error('announcements:', error && error.message ? error.message : error);
    return json({ ok: false, error: 'db_error' }, 500);
  }
}

export { handleAnnouncements };