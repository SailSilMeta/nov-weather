const BASE = 'https://www.dsmg.gov.mo';
const CDN = 'https://cdn.dsmg.gov.mo/uploads/dsmg/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const REFERER = `${BASE}/zh-hant/monitoring-images`;

const PRODUCTS = [
  {
    key: 'moRadar',
    name: '珠澳天气雷达',
    api: 'radarMap',
    group: 'radarMap/240km',
    dir: 'radarMap/240km',
    pattern: /^radar(\d{2})\.jpg$/,
  },
  {
    key: 'moLight',
    name: '闪电定位',
    api: 'lightning',
    group: 'lightning/prd',
    dir: 'lightning/prd',
    pattern: /^llis(\d{2})\.png$/,
  },
];

const LIST_TTL = 60e3;

function productOf(key) {
  return PRODUCTS.find((p) => p.key === key) || null;
}

function validFile(key, file) {
  const product = productOf(key);
  return !!(product && product.pattern.test(file));
}

function stampOf(time) {
  const m = String(time || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  const clock = `${m[4]}:${m[5]}`;
  return { clock, stamp: `${m[2]}-${m[3]} ${clock}` };
}

async function fetchGroup(product) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(`${BASE}/api/images/get-images/${product.api}?type=${product.api}`, {
      headers: { 'User-Agent': UA, Referer: REFERER, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`list ${res.status}`);
    const json = JSON.parse(await res.text());
    const group = json && json.data && json.data[product.group];
    if (!group) throw new Error('list shape');
    const infos = Array.isArray(group.fileInfos) ? group.fileInfos : [];
    return infos
      .map((item) => ({ file: String((item && item.file) || ''), time: String((item && item.time) || '') }))
      .filter((item) => validFile(product.key, item.file) && stampOf(item.time))
      .sort((a, b) => a.time.localeCompare(b.time));
  } finally {
    clearTimeout(timer);
  }
}

function buildProduct(product, items) {
  const frames = items.map((item) => {
    const stamp = stampOf(item.time);
    return {
      file: item.file,
      src: `/api/mo-radar/img?type=${product.key}&file=${encodeURIComponent(item.file)}`,
      clock: stamp.clock,
      stamp: stamp.stamp,
    };
  });
  if (!frames.length) {
    return { key: product.key, name: product.name, maintenance: true, latest: '', frames: [] };
  }
  const last = frames[frames.length - 1];
  return { key: product.key, name: product.name, maintenance: false, latest: last.stamp, frames };
}

let listCache = null;
let listPending = null;

async function getProducts(force = false) {
  if (!force && listCache && Date.now() - listCache.at < LIST_TTL) return listCache.result;
  if (listPending) return listPending;
  listPending = Promise.all(PRODUCTS.map(async (product) => {
    try {
      return buildProduct(product, await fetchGroup(product));
    } catch (e) {
      return { key: product.key, name: product.name, error: true, maintenance: false, latest: '', frames: [] };
    }
  })).then((products) => {
    const result = {
      source: REFERER,
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
      const res = await fetch(`${CDN}${product.dir}/${file}`, {
        headers: { 'User-Agent': UA, Referer: REFERER },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`img ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const png = /\.png$/i.test(file);
      const ok = png
        ? buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50
        : buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8;
      if (!ok) throw new Error('img type');
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
