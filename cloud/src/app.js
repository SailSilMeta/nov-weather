import { getWarnings, mockWarnings } from './hkmo.js';
import { issue, check, matches } from './auth.js';
import { PROVIDERS } from './radar.js';
import { fetchIndex, SOURCE as NEWS_SOURCE, PAGE_SIZE } from './news.js';
import { fetchGdFire, SOURCE as FIRE_SOURCE, CITIES } from './fire.js';
import { handleAnnouncements } from './announcements.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(payload, status = 200, extra = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...CORS,
      ...extra,
    },
  });
}

function empty(status = 404) {
  return new Response(null, { status, headers: CORS });
}

function bearer(request, url) {
  const header = String(request.headers.get('authorization') || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : (url.searchParams.get('token') || '');
}

async function readJsonBody(request, limit = 2048) {
  const text = await request.text();
  if (text.length > limit) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

async function handleAuth(request, url, env, verifyOnly) {
  const secret = env.RADAR_AUTH_SECRET;
  if (!secret) return json({ ok: false, error: 'auth_not_configured' }, 500);
  if (verifyOnly) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ ok: false }, 405, { Allow: 'GET, HEAD' });
    const granted = await check(bearer(request, url), secret);
    return granted ? json({ ok: true, exp: granted.exp }) : json({ ok: false }, 401);
  }
  if (request.method !== 'POST') return json({ ok: false }, 405, { Allow: 'POST' });
  const body = await readJsonBody(request);
  if (!body || typeof body.pass !== 'string') return json({ ok: false }, 400);
  if (!matches(body.pass)) return json({ ok: false }, 401);
  const { token, exp } = await issue(secret);
  return json({ ok: true, token, exp });
}

let newsIndex = { items: [], at: 0, pending: null };
const NEWS_TTL = 10 * 60e3;

function newsPayload(page, index, extra = {}) {
  return {
    source: NEWS_SOURCE,
    fetchedAt: index.at ? new Date(index.at).toISOString() : new Date().toISOString(),
    stale: !index.at || Date.now() - index.at >= NEWS_TTL,
    page,
    pageSize: PAGE_SIZE,
    total: index.items.length,
    totalPages: index.items.length ? Math.ceil(index.items.length / PAGE_SIZE) : 0,
    items: [],
    ...extra,
  };
}

async function loadNewsIndex() {
  if (newsIndex.items.length && Date.now() - newsIndex.at < NEWS_TTL) return;
  if (newsIndex.pending) return newsIndex.pending;
  newsIndex.pending = fetchIndex()
    .then((items) => {
      newsIndex = { items, at: Date.now(), pending: null };
    })
    .catch(() => {
      newsIndex.pending = null;
    });
  return newsIndex.pending;
}

async function handleNews(url) {
  const page = Number(url.searchParams.get('page') || 1);
  if (!Number.isInteger(page) || page < 1 || page > 50) return json(newsPayload(1, newsIndex), 404);
  await loadNewsIndex();
  if (!newsIndex.items.length) return json(newsPayload(page, newsIndex), 502);
  const totalPages = Math.ceil(newsIndex.items.length / PAGE_SIZE);
  if (page > totalPages) return json(newsPayload(page, newsIndex), 404);
  const start = (page - 1) * PAGE_SIZE;
  return json(newsPayload(page, newsIndex, { items: newsIndex.items.slice(start, start + PAGE_SIZE) }));
}

let fireCache = null;
const FIRE_TTL = 5 * 60e3;

function firePayload(data, stale) {
  return {
    source: FIRE_SOURCE,
    fetchedAt: (data && data.fetchedAt) || new Date().toISOString(),
    stale,
    partial: Boolean(data && data.partial),
    citiesOk: (data && data.citiesOk) || 0,
    citiesTotal: (data && data.citiesTotal) || CITIES.length,
    count: (data && data.count) || 0,
    alerts: (data && Array.isArray(data.alerts)) ? data.alerts : [],
  };
}

async function handleFire(force) {
  if (!force && fireCache && Date.now() - fireCache.at < FIRE_TTL) return firePayload(fireCache.data, false);
  try {
    const data = await fetchGdFire();
    fireCache = { at: Date.now(), data };
    return firePayload(data, false);
  } catch (e) {
    return firePayload(fireCache && fireCache.data, true);
  }
}

const RADAR_ROUTE = /^\/api\/(dg|zh|fs|jm|gz|mo)-radar(\/img)?$/;

async function handleRadar(request, url, match) {
  const provider = PROVIDERS[match[1]];
  const isImage = Boolean(match[2]);
  if (isImage) {
    const type = url.searchParams.get('type') || '';
    const file = url.searchParams.get('file') || '';
    let frame;
    try {
      frame = await provider.frame(type, file);
    } catch (e) {
      return new Response(null, { status: 502, headers: { 'Cache-Control': 'no-store', ...CORS } });
    }
    if (!frame) return empty(404);
    return new Response(request.method === 'HEAD' ? null : frame.body, {
      status: 200,
      headers: {
        'Content-Type': frame.type,
        'Content-Length': String(frame.body.length),
        'Cache-Control': `public, max-age=${frame.maxAge}`,
        'X-Content-Type-Options': 'nosniff',
        ...CORS,
      },
    });
  }
  const force = url.searchParams.get('fresh') === '1';
  try {
    const result = await provider.list(force);
    return json(result);
  } catch (e) {
    return json({ products: [] }, 502);
  }
}

async function handleHkmo(request, url, env) {
  if (url.searchParams.get('mock') === '1') {
    const secret = env.RADAR_AUTH_SECRET;
    const granted = secret ? await check(bearer(request, url), secret) : null;
    if (!granted) return json({ regions: [] }, 401);
    return json(mockWarnings());
  }
  try {
    return json(await getWarnings(url.searchParams.get('fresh') === '1'));
  } catch (e) {
    return json({ regions: [] }, 502);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/radar/auth') return handleAuth(request, url, env, false);
    if (path === '/api/radar/auth/verify') return handleAuth(request, url, env, true);
    if (path === '/api/warning-hkmo') return handleHkmo(request, url, env);
    if (path === '/api/gd-news') return handleNews(url);
    if (path === '/api/gd-fire') return json(await handleFire(url.searchParams.get('fresh') === '1'));
    if (path === '/api/announcements' || path.startsWith('/api/announcements/')) {
      return handleAnnouncements(request, url, env);
    }
    if (path === '/api/health') {
      return json({
        ok: true,
        auth: Boolean(env.RADAR_AUTH_SECRET),
        announcements: Boolean(env.PG_CONNECTION_STRING || env.PG_HOST),
      });
    }

    const radarMatch = path.match(RADAR_ROUTE);
    if (radarMatch) return handleRadar(request, url, radarMatch);

    return json({ ok: false, error: 'not_found' }, 404);
  },
};
