const BASE = 'http://jmtqcloud.jmqxgf.com.cn';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const REFERER = 'http://jmtqwxh.jmqxgf.com.cn/wxhradar/radar.html';

const PRODUCTS = [
  {
    key: 'jmsc',
    name: '上川岛雷达',
    dir: '/upload/weather_data/radarpic/',
    pattern: /^scradar(\d{1,2})\.png$/,
    base: 'scradar',
    ext: '.png',
    count: 10,
    descending: true,
  },
  {
    key: 'jmjm',
    name: '江门雷达',
    dir: '/upload/weather_data/radarpic/',
    pattern: /^ZWCR(\d{1,2})\.png$/,
    base: 'ZWCR',
    ext: '.png',
    count: 10,
    descending: true,
  },
  {
    key: 'jmgd',
    name: '全省雷达',
    dir: '/upload/WeatherFiles/',
    pattern: /^NEW_AWS_GD_CAPPI_(\d{1,2})\.PNG$/,
    base: 'NEW_AWS_GD_CAPPI_',
    ext: '.PNG',
    count: 8,
    descending: false,
  },
];

const LIST_TTL = 60e3;
const STALE_MS = 3 * 3600e3;

function productOf(key) {
  return PRODUCTS.find((p) => p.key === key) || null;
}

function validFile(key, file) {
  const product = productOf(key);
  if (!product) return false;
  const m = product.pattern.exec(file);
  if (!m) return false;
  const n = Number(m[1]);
  return n >= 1 && n <= product.count;
}

async function headFile(product, file) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${BASE}${product.dir}${file}`, {
      method: 'HEAD',
      headers: { 'User-Agent': UA, Referer: REFERER },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const ms = Date.parse(res.headers.get('last-modified') || '');
    return Number.isFinite(ms) ? ms : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function buildProduct(product, stamps) {
  const frames = stamps
    .map((item) => ({
      file: item.file,
      src: `/api/jm-radar/img?type=${product.key}&file=${encodeURIComponent(item.file)}`,
      clock: '',
      stamp: '',
    }));
  if (!frames.length) {
    return { key: product.key, name: product.name, maintenance: true, latest: '', frames: [] };
  }
  const newest = Math.max(...stamps.map((s) => s.ms).filter(Boolean), 0);
  const stale = !newest || Date.now() - newest > STALE_MS;
  return {
    key: product.key,
    name: product.name,
    maintenance: false,
    latest: '',
    stale,
    frames,
  };
}

async function fetchProduct(product) {
  const files = [];
  for (let n = 1; n <= product.count; n += 1) {
    files.push(product.descending ? product.count + 1 - n : n);
  }
  const names = files.map((n) => `${product.base}${n}${product.ext}`);
  const ms = await Promise.all(names.map((name) => headFile(product, name)));
  const list = names.map((name, i) => ({ file: name, ms: ms[i] })).filter((item) => item.ms);
  return buildProduct(product, list);
}

let listCache = null;
let listPending = null;

async function getProducts(force = false) {
  if (!force && listCache && Date.now() - listCache.at < LIST_TTL) return listCache.result;
  if (listPending) return listPending;
  listPending = Promise.all(PRODUCTS.map(async (product) => {
    try {
      return await fetchProduct(product);
    } catch (e) {
      return { key: product.key, name: product.name, error: true, maintenance: false, latest: '', frames: [] };
    }
  })).then((products) => {
    const result = {
      source: 'http://jmtqwxh.jmqxgf.com.cn/wxhradar/radar.html',
      fetchedAt: new Date().toISOString(),
      products,
    };
    listCache = { at: Date.now(), result };
    return result;
  }).finally(() => {
    listPending = null;
  });
  return listPending;
}

const IMG_TTL = 45e3;
const IMG_MAX = 40;
const imgCache = new Map();
const inflight = new Map();

async function getFrame(type, file) {
  const key = `${type}/${file}`;
  const hit = imgCache.get(key);
  if (hit && Date.now() - hit.at < IMG_TTL) return hit.buf;
  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    const product = productOf(type);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(`${BASE}${product.dir}${file}`, {
        headers: { 'User-Agent': UA, Referer: REFERER },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`img ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50) throw new Error('img type');
      imgCache.set(key, { at: Date.now(), buf });
      if (imgCache.size > IMG_MAX) imgCache.delete(imgCache.keys().next().value);
      return buf;
    } finally {
      clearTimeout(timer);
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
  return job;
}

module.exports = { BASE, PRODUCTS, validFile, productOf, getProducts, getFrame };
