const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { SOURCE: TYPHOON_SOURCE, validKey: validTyphoonKey, validData: validTyphoonData,
  fetchTyphoon, writeJsonAtomic } = require('./fetch-typhoons');
const { SOURCE: NMC_SOURCE, validKey: validNmcKey, validData: validNmcData,
  fetchNmc } = require('./nmc-typhoon');
const { SOURCE: GD_FIRE_SOURCE, fetchGdFire } = require('./gd-fire');
const gdNews = require('./gd-news');
const dgRadar = require('./dg-radar');
const zhRadar = require('./zh-radar');
const fsRadar = require('./fs-radar');
const jmRadar = require('./jm-radar');
const gzRadar = require('./gz-radar');
const moRadar = require('./mo-radar');
const hkmoWarning = require('./hkmo-warning');
const radarAuth = require('./radar-auth');

const root = path.join(__dirname, '..');
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || '0.0.0.0';
const cacheRoot = path.join(root, 'cache');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const blocked = new Set(['node_modules', 'scripts', 'cache', '.git', '.vscode', '.idea']);
const gzipCache = new Map();

const TILES = {
  sat: {
    ext: 'jpg',
    type: 'image/jpeg',
    url: (z, x, y, n) => `https://webst0${n}.is.autonavi.com/appmaptile?style=6&x=${x}&y=${y}&z=${z}`,
  },
  label: {
    ext: 'png',
    type: 'image/png',
    url: (z, x, y, n) => `https://webst0${n}.is.autonavi.com/appmaptile?style=8&x=${x}&y=${y}&z=${z}`,
  },
  vec: {
    ext: 'png',
    type: 'image/png',
    url: (z, x, y, n) =>
      `https://wprd0${n}.is.autonavi.com/appmaptile?x=${x}&y=${y}&z=${z}&lang=zh_cn&size=1&scl=1&style=7`,
  },
};

async function cacheFile(file, ttl) {
  try {
    const stat = await fs.promises.stat(file);
    if (Date.now() - stat.mtimeMs < ttl) return fs.promises.readFile(file);
  } catch (e) {
    /* cache miss */
  }
  return null;
}

async function storeCache(file, buf) {
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, buf);
  } catch (e) {
    /* ignore cache write errors */
  }
}

async function handleTile(kind, z, x, y, req, res) {
  const source = TILES[kind];
  if (!source || !/^\d{1,2}$/.test(z) || !/^\d{1,7}$/.test(x) || !/^\d{1,7}$/.test(y)) return notFound(res);
  const zoom = Number(z);
  const tx = Number(x);
  const ty = Number(y);
  if (zoom < 3 || zoom > 18 || tx >= 2 ** zoom || ty >= 2 ** zoom) return notFound(res);
  const file = path.join(cacheRoot, 'tiles', kind, z, x, `${y}.${source.ext}`);
  let buf = await cacheFile(file, 30 * 86400e3);
  if (!buf) {
    const n = (tx + ty) % 4 + 1;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const upstream = await fetch(source.url(zoom, tx, ty, n), {
        signal: ctrl.signal,
        headers: { Referer: 'https://www.amap.com/', 'User-Agent': 'Mozilla/5.0 qxksh-map' },
      });
      if (!upstream.ok) {
        res.writeHead(upstream.status === 404 ? 404 : 502);
        return res.end();
      }
      buf = Buffer.from(await upstream.arrayBuffer());
      storeCache(file, buf);
    } catch (e) {
      res.writeHead(504);
      return res.end();
    } finally {
      clearTimeout(timer);
    }
  }
  res.writeHead(200, {
    'Content-Type': source.type,
    'Cache-Control': 'public, max-age=2592000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : buf);
}

async function handleGeo(adcode, req, res) {
  if (!/^\d{6}$/.test(adcode)) return notFound(res);
  const file = path.join(cacheRoot, 'geo', `${adcode}.json`);
  let buf = await cacheFile(file, 7 * 86400e3);
  if (!buf) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const upstream = await fetch(`https://geo.datav.aliyun.com/areas_v3/bound/${adcode}_full.json`, { signal: ctrl.signal });
      if (!upstream.ok) {
        res.writeHead(upstream.status === 404 ? 404 : 502);
        return res.end();
      }
      buf = Buffer.from(await upstream.arrayBuffer());
      storeCache(file, buf);
    } catch (e) {
      res.writeHead(504);
      return res.end();
    } finally {
      clearTimeout(timer);
    }
  }
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=604800',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : buf);
}

const typhoonPending = new Map();
const typhoonTTL = 5 * 60e3;

function typhoonPayload(data = null, stale = true, fetchedAt = new Date().toISOString()) {
  return { source: TYPHOON_SOURCE, fetchedAt, stale, data };
}

function isTyphoonPath(pathname) {
  return pathname === '/api/typhoon' || pathname.startsWith('/api/typhoon/');
}

function sendApi(req, res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': body.length,
    ...(status === 405 ? { Allow: 'GET, HEAD' } : {}),
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function sendTyphoon(req, res, status, payload = typhoonPayload()) {
  sendApi(req, res, status, payload);
}

function isNmcPath(pathname) {
  return pathname === '/api/typhoon/nmc' || pathname.startsWith('/api/typhoon/nmc/');
}

async function loadTyphoon(kind, key) {
  const file = path.join(cacheRoot, 'typhoon', `${kind}-${key}.json`);
  let cached = null;
  try {
    const buf = await cacheFile(file, Infinity);
    const value = buf && JSON.parse(buf.toString('utf8'));
    const timestamp = value && Date.parse(value.fetchedAt);
    if (value && value.source === TYPHOON_SOURCE && value.stale === false
      && Number.isFinite(timestamp) && timestamp <= Date.now()
      && new Date(timestamp).toISOString() === value.fetchedAt && validTyphoonData(kind, key, value.data)) {
      cached = typhoonPayload(value.data, false, value.fetchedAt);
      if (Date.now() - timestamp < typhoonTTL) return { status: 200, payload: cached };
    }
  } catch (e) {
    /* Missing, unreadable or invalid cache: fetch again, never serve malformed data. */
  }
  try {
    const data = await fetchTyphoon(kind, key);
    const payload = typhoonPayload(data, false);
    try {
      await writeJsonAtomic(file, payload);
    } catch (e) {
      /* Serve validated fresh data even if disk writes fail; retain the previous cache. */
    }
    return { status: 200, payload };
  } catch (e) {
    return cached
      ? { status: 200, payload: typhoonPayload(cached.data, true, cached.fetchedAt) }
      : { status: 502, payload: typhoonPayload() };
  }
}

async function handleTyphoon(kind, key, req, res) {
  const resource = `${kind}-${key}`;
  let pending = typhoonPending.get(resource);
  if (!pending) {
    pending = loadTyphoon(kind, key).finally(() => typhoonPending.delete(resource));
    typhoonPending.set(resource, pending);
  }
  const { status, payload } = await pending;
  sendTyphoon(req, res, status, payload);
}

const nmcPending = new Map();
const nmcTTL = 3 * 60e3;

function nmcPayload(data = null, stale = true, fetchedAt = new Date().toISOString()) {
  return { source: NMC_SOURCE, fetchedAt, stale, data };
}

async function loadNmc(kind, key) {
  const file = path.join(cacheRoot, 'nmc-typhoon', `${kind}-${key}.json`);
  let cached = null;
  try {
    const buf = await cacheFile(file, Infinity);
    const value = buf && JSON.parse(buf.toString('utf8'));
    const timestamp = value && Date.parse(value.fetchedAt);
    if (value && value.source === NMC_SOURCE && value.stale === false
      && Number.isFinite(timestamp) && timestamp <= Date.now()
      && new Date(timestamp).toISOString() === value.fetchedAt && validNmcData(kind, key, value.data)) {
      cached = nmcPayload(value.data, false, value.fetchedAt);
      if (Date.now() - timestamp < nmcTTL) return { status: 200, payload: cached };
    }
  } catch (e) {
    /* Missing, unreadable or invalid cache: fetch again, never serve malformed data. */
  }
  try {
    const data = await fetchNmc(kind, key);
    const payload = nmcPayload(data, false);
    try {
      await writeJsonAtomic(file, payload);
    } catch (e) {
      /* Serve validated fresh data even if disk writes fail; retain the previous cache. */
    }
    return { status: 200, payload };
  } catch (e) {
    return cached
      ? { status: 200, payload: nmcPayload(cached.data, true, cached.fetchedAt) }
      : { status: 502, payload: nmcPayload() };
  }
}

async function handleNmc(kind, key, req, res) {
  const resource = `${kind}-${key}`;
  let pending = nmcPending.get(resource);
  if (!pending) {
    pending = loadNmc(kind, key).finally(() => nmcPending.delete(resource));
    nmcPending.set(resource, pending);
  }
  const { status, payload } = await pending;
  sendApi(req, res, status, payload);
}

const gdFirePending = { current: null };
const gdFireTTL = 5 * 60e3;

function gdFirePayload(data = null, stale = true) {
  return {
    source: GD_FIRE_SOURCE,
    fetchedAt: (data && data.fetchedAt) || new Date().toISOString(),
    stale,
    partial: Boolean(data && data.partial),
    citiesOk: (data && data.citiesOk) || 0,
    citiesTotal: (data && data.citiesTotal) || 0,
    count: (data && data.count) || 0,
    alerts: (data && Array.isArray(data.alerts)) ? data.alerts : [],
  };
}

async function loadGdFire() {
  const file = path.join(cacheRoot, 'gd-fire.json');
  let cached = null;
  try {
    const buf = await cacheFile(file, Infinity);
    const value = buf && JSON.parse(buf.toString('utf8'));
    const timestamp = value && Date.parse(value.fetchedAt);
    if (value && value.source === GD_FIRE_SOURCE && Array.isArray(value.alerts)
      && Number.isFinite(timestamp) && timestamp <= Date.now()) {
      cached = value;
      if (Date.now() - timestamp < gdFireTTL) return gdFirePayload(value, false);
    }
  } catch (e) {
    /* Missing or invalid cache: fetch again. */
  }
  try {
    const data = await fetchGdFire();
    try {
      await writeJsonAtomic(file, data);
    } catch (e) {
      /* Serve fresh data even if the cache cannot be written. */
    }
    return gdFirePayload(data, false);
  } catch (e) {
    return cached ? gdFirePayload(cached, true) : gdFirePayload();
  }
}

async function handleGdFire(req, res) {
  if (!gdFirePending.current) {
    gdFirePending.current = loadGdFire().finally(() => { gdFirePending.current = null; });
  }
  const payload = await gdFirePending.current;
  sendApi(req, res, payload.alerts.length || payload.citiesTotal ? 200 : 502, payload);
}

function readJsonBody(req, limit = 2048) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

async function handleRadarAuth(verifyOnly, req, res) {
  if (verifyOnly) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendApi(req, res, 405, { ok: false });
    const header = String(req.headers.authorization || '');
    const token = header.startsWith('Bearer ')
      ? header.slice(7).trim()
      : (new URL(req.url, 'http://localhost').searchParams.get('token') || '');
    const granted = radarAuth.check(token);
    return sendApi(req, res, granted ? 200 : 401, granted ? { ok: true, exp: granted.exp } : { ok: false });
  }
  if (req.method !== 'POST') return sendApi(req, res, 405, { ok: false });
  const body = await readJsonBody(req);
  if (!body || typeof body.pass !== 'string') return sendApi(req, res, 400, { ok: false });
  if (!radarAuth.matches(body.pass)) return sendApi(req, res, 401, { ok: false });
  const { token, exp } = radarAuth.issue();
  sendApi(req, res, 200, { ok: true, token, exp });
}

const newsIndex = { items: [], at: 0 };
const newsPending = { current: null };
const newsTTL = 10 * 60e3;

function newsPayload(page, index, extra = {}) {
  return {
    source: gdNews.SOURCE,
    fetchedAt: index.at ? new Date(index.at).toISOString() : new Date().toISOString(),
    stale: !index.at || Date.now() - index.at >= newsTTL,
    page,
    pageSize: gdNews.PAGE_SIZE,
    total: index.items.length,
    totalPages: index.items.length ? Math.ceil(index.items.length / gdNews.PAGE_SIZE) : 0,
    items: [],
    ...extra,
  };
}

async function loadGdNewsIndex() {
  if (newsIndex.items.length && Date.now() - newsIndex.at < newsTTL) return;
  try {
    const items = await gdNews.fetchIndex();
    newsIndex.items = items;
    newsIndex.at = Date.now();
  } catch (e) {
    /* Keep the previous index; an empty index means the source is unreachable. */
  }
}

async function handleGdNews(page, req, res) {
  if (!newsPending.current) {
    newsPending.current = loadGdNewsIndex().finally(() => { newsPending.current = null; });
  }
  await newsPending.current;
  if (!newsIndex.items.length) return sendApi(req, res, 502, newsPayload(page, newsIndex));
  const totalPages = Math.ceil(newsIndex.items.length / gdNews.PAGE_SIZE);
  if (page > totalPages) return sendApi(req, res, 404, newsPayload(page, newsIndex));
  const start = (page - 1) * gdNews.PAGE_SIZE;
  const items = newsIndex.items.slice(start, start + gdNews.PAGE_SIZE);
  sendApi(req, res, 200, newsPayload(page, newsIndex, { items }));
}

async function handleDgRadarImg(type, file, req, res) {
  const target = await dgRadar.getFrameFile(type, file);
  const buf = await fs.promises.readFile(target);
  const png = /\.png$/i.test(file);
  res.writeHead(200, {
    'Content-Type': png ? 'image/png' : 'image/jpeg',
    'Content-Length': buf.length,
    'Cache-Control': /\d{12,14}/.test(file) ? 'public, max-age=604800, immutable' : 'public, max-age=60',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : buf);
}

async function handleZhRadarImg(file, req, res) {
  const target = await zhRadar.getFrameFile(file);
  const buf = await fs.promises.readFile(target);
  res.writeHead(200, {
    'Content-Type': 'image/gif',
    'Content-Length': buf.length,
    'Cache-Control': /\d{12,14}/.test(file) ? 'public, max-age=604800, immutable' : 'public, max-age=60',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : buf);
}

async function handleFsRadarImg(file, req, res) {
  const target = await fsRadar.getFrameFile(file);
  const buf = await fs.promises.readFile(target);
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': buf.length,
    'Cache-Control': /\d{8}\.\d{6}/.test(file) ? 'public, max-age=604800, immutable' : 'public, max-age=60',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : buf);
}

async function handleJmRadarImg(type, file, req, res) {
  const buf = await jmRadar.getFrame(type, file);
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': buf.length,
    'Cache-Control': 'public, max-age=45',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : buf);
}

async function handleGzRadarImg(file, req, res) {
  const target = await gzRadar.getFrameFile(file);
  const buf = await fs.promises.readFile(target);
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': buf.length,
    'Cache-Control': /\d{14}/.test(file) ? 'public, max-age=604800, immutable' : 'public, max-age=60',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : buf);
}

async function handleMoRadarImg(type, file, req, res) {
  const buf = await moRadar.getFrame(type, file);
  const png = /\.png$/i.test(file);
  res.writeHead(200, {
    'Content-Type': png ? 'image/png' : 'image/jpeg',
    'Content-Length': buf.length,
    'Cache-Control': 'public, max-age=45',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : buf);
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
}

function isBlocked(rel) {
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return true;
  const first = rel.split(/[\\/]/)[0];
  if (blocked.has(first)) return true;
  if (rel.startsWith('.')) return true;
  if (rel === 'package.json' || rel === 'package-lock.json') return true;
  return false;
}

function lanAddresses() {
  const skip = /vEthernet|VirtualBox|VMware|Loopback|Hyper-V|WSL/i;
  const result = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (skip.test(name)) continue;
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) result.push({ name, ip: item.address });
    }
  }
  return result;
}

function bearerToken(req) {
  const raw = String(req.headers.authorization || '');
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

const server = http.createServer(async (req, res) => {
  const apiPath = (req.url || '').split('?')[0];
  if (apiPath === '/api/radar/auth' || apiPath === '/api/radar/auth/verify') {
    try {
      return await handleRadarAuth(apiPath.endsWith('/verify'), req, res);
    } catch (e) {
      return sendApi(req, res, 500, { ok: false });
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (isNmcPath(req.url.split('?')[0])) return sendApi(req, res, 405, nmcPayload());
    if (isTyphoonPath(req.url.split('?')[0])) return sendTyphoon(req, res, 405);
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  let pathname;
  try {
    pathname = decodeURIComponent(req.url.split('?')[0]);
  } catch (e) {
    if (isNmcPath(req.url.split('?')[0])) return sendApi(req, res, 400, nmcPayload());
    if (isTyphoonPath(req.url.split('?')[0])) return sendTyphoon(req, res, 400);
    res.writeHead(400);
    return res.end('bad request');
  }
  const tileMatch = pathname.match(/^\/tiles\/(sat|label|vec)\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.(?:jpg|png)$/);
  if (tileMatch) {
    try {
      return await handleTile(tileMatch[1], tileMatch[2], tileMatch[3], tileMatch[4], req, res);
    } catch (e) {
      res.writeHead(500);
      return res.end();
    }
  }
  const geoMatch = pathname.match(/^\/geo\/(\d{6})\.json$/);
  if (geoMatch) {
    try {
      return await handleGeo(geoMatch[1], req, res);
    } catch (e) {
      res.writeHead(500);
      return res.end();
    }
  }
  if (pathname === '/api/gd-fire') {
    try {
      return await handleGdFire(req, res);
    } catch (e) {
      return sendApi(req, res, 502, gdFirePayload());
    }
  }
  if (pathname === '/api/gd-news') {
    const page = Number(new URL(req.url, 'http://localhost').searchParams.get('page') || 1);
    if (!Number.isInteger(page) || page < 1 || page > 50) return sendApi(req, res, 404, newsPayload(1, newsIndex));
    try {
      return await handleGdNews(page, req, res);
    } catch (e) {
      return sendApi(req, res, 502, newsPayload(page, newsIndex));
    }
  }
  if (pathname === '/api/dg-radar') {
    const fresh = new URL(req.url, 'http://localhost').searchParams.get('fresh') === '1';
    try {
      return sendApi(req, res, 200, await dgRadar.getProducts(fresh));
    } catch (e) {
      return sendApi(req, res, 502, { source: dgRadar.BASE, products: [] });
    }
  }
  if (pathname === '/api/dg-radar/img') {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const type = params.get('type') || '';
    const file = params.get('file') || '';
    if (!dgRadar.validKey(type) || !dgRadar.validFile(file)) return notFound(res);
    try {
      return await handleDgRadarImg(type, file, req, res);
    } catch (e) {
      res.writeHead(502, { 'Cache-Control': 'no-store' });
      return res.end();
    }
  }
  if (pathname === '/api/zh-radar') {
    const fresh = new URL(req.url, 'http://localhost').searchParams.get('fresh') === '1';
    try {
      return sendApi(req, res, 200, await zhRadar.getProduct(fresh));
    } catch (e) {
      return sendApi(req, res, 502, { source: zhRadar.BASE, products: [] });
    }
  }
  if (pathname === '/api/zh-radar/img') {
    const file = new URL(req.url, 'http://localhost').searchParams.get('file') || '';
    if (!zhRadar.validFile(file)) return notFound(res);
    try {
      return await handleZhRadarImg(file, req, res);
    } catch (e) {
      res.writeHead(502, { 'Cache-Control': 'no-store' });
      return res.end();
    }
  }
  if (pathname === '/api/fs-radar') {
    const fresh = new URL(req.url, 'http://localhost').searchParams.get('fresh') === '1';
    try {
      return sendApi(req, res, 200, await fsRadar.getProduct(fresh));
    } catch (e) {
      return sendApi(req, res, 502, { source: fsRadar.BASE, products: [] });
    }
  }
  if (pathname === '/api/fs-radar/img') {
    const file = new URL(req.url, 'http://localhost').searchParams.get('file') || '';
    if (!fsRadar.validFile(file)) return notFound(res);
    try {
      return await handleFsRadarImg(file, req, res);
    } catch (e) {
      res.writeHead(502, { 'Cache-Control': 'no-store' });
      return res.end();
    }
  }
  if (pathname === '/api/jm-radar') {
    const fresh = new URL(req.url, 'http://localhost').searchParams.get('fresh') === '1';
    try {
      return sendApi(req, res, 200, await jmRadar.getProducts(fresh));
    } catch (e) {
      return sendApi(req, res, 502, { source: jmRadar.BASE, products: [] });
    }
  }
  if (pathname === '/api/jm-radar/img') {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const type = params.get('type') || '';
    const file = params.get('file') || '';
    if (!jmRadar.validFile(type, file)) return notFound(res);
    try {
      return await handleJmRadarImg(type, file, req, res);
    } catch (e) {
      res.writeHead(502, { 'Cache-Control': 'no-store' });
      return res.end();
    }
  }
  if (pathname === '/api/gz-radar') {
    const fresh = new URL(req.url, 'http://localhost').searchParams.get('fresh') === '1';
    try {
      return sendApi(req, res, 200, await gzRadar.getProduct(fresh));
    } catch (e) {
      return sendApi(req, res, 502, { source: gzRadar.BASE, products: [] });
    }
  }
  if (pathname === '/api/gz-radar/img') {
    const file = new URL(req.url, 'http://localhost').searchParams.get('file') || '';
    if (!gzRadar.validFile(file)) return notFound(res);
    try {
      return await handleGzRadarImg(file, req, res);
    } catch (e) {
      res.writeHead(502, { 'Cache-Control': 'no-store' });
      return res.end();
    }
  }
  if (pathname === '/api/mo-radar') {
    const fresh = new URL(req.url, 'http://localhost').searchParams.get('fresh') === '1';
    try {
      return sendApi(req, res, 200, await moRadar.getProducts(fresh));
    } catch (e) {
      return sendApi(req, res, 502, { source: moRadar.BASE, products: [] });
    }
  }
  if (pathname === '/api/warning-hkmo') {
    const params = new URL(req.url, 'http://localhost').searchParams;
    if (params.get('mock') === '1') {
      if (!radarAuth.check(bearerToken(req))) return sendApi(req, res, 401, { regions: [] });
      return sendApi(req, res, 200, hkmoWarning.mockWarnings());
    }
    try {
      return sendApi(req, res, 200, await hkmoWarning.getWarnings(params.get('fresh') === '1'));
    } catch (e) {
      return sendApi(req, res, 502, { regions: [] });
    }
  }
  if (pathname === '/api/mo-radar/img') {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const type = params.get('type') || '';
    const file = params.get('file') || '';
    if (!moRadar.validFile(type, file)) return notFound(res);
    try {
      return await handleMoRadarImg(type, file, req, res);
    } catch (e) {
      res.writeHead(502, { 'Cache-Control': 'no-store' });
      return res.end();
    }
  }
  if (isNmcPath(pathname)) {
    const match = pathname.match(/^\/api\/typhoon\/nmc\/(list|detail)\/(\d+)$/);
    if (!match || !validNmcKey(match[1], match[2])) return sendApi(req, res, 404, nmcPayload());
    try {
      return await handleNmc(match[1], match[2], req, res);
    } catch (e) {
      return sendApi(req, res, 502, nmcPayload());
    }
  }
  if (isTyphoonPath(pathname)) {
    const match = pathname.match(/^\/api\/typhoon\/(list|detail)\/(\d+)$/);
    if (!match || !validTyphoonKey(match[1], match[2])) return sendTyphoon(req, res, 404);
    try {
      return await handleTyphoon(match[1], match[2], req, res);
    } catch (e) {
      return sendTyphoon(req, res, 502);
    }
  }
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (isBlocked(rel)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('forbidden');
  }
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) && file !== root) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  fs.stat(file, (statErr, stat) => {
    if (statErr) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('not found');
    }
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('not found');
      }
      const ext = path.extname(file).toLowerCase();
      const headers = {
        'Content-Type': types[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      };
      let body = buf;
      if (buf.length > 1024 && /\.(html|js|css|json|svg)$/.test(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
        const key = `${file}:${stat.mtimeMs}:${buf.length}`;
        let gz = gzipCache.get(key);
        if (!gz) {
          gz = zlib.gzipSync(buf, { level: 6 });
          if (gzipCache.size > 30) gzipCache.clear();
          gzipCache.set(key, gz);
        }
        body = gz;
        headers['Content-Encoding'] = 'gzip';
        headers['Vary'] = 'Accept-Encoding';
      }
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
    });
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${port} 已被占用，可用 PORT=5174 npm start 换端口`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`局域网服务已启动：${root}`);
  console.log(`  本机: http://localhost:${port}`);
  const lan = lanAddresses();
  if (!lan.length) console.log('  未检测到局域网 IPv4 地址');
  for (const item of lan) {
    console.log(`  手机/同网设备: http://${item.ip}:${port}  (${item.name})`);
  }
  console.log('  手机需与电脑连接同一 Wi-Fi / 局域网');
});
