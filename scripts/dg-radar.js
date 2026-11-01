const fs = require('fs');
const path = require('path');

const BASE = 'https://dg121.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const PRODUCTS = [
  { key: 'dgleida', name: '东莞雷达图' },
  { key: 'dgxkz', name: '东莞相控阵' },
  { key: 'zhusanjiao', name: '珠三角雷达图' },
  { key: 'gdleida', name: '广东雷达图' },
];
const FRAME_LIMIT = 30;
const LIST_TTL = 60e3;
const cacheRoot = path.join(__dirname, '..', 'cache', 'dg-radar');

function validKey(key) {
  return PRODUCTS.some((p) => p.key === key);
}

function validFile(file) {
  return /^[A-Za-z0-9_.-]+\.(png|jpe?g)$/i.test(file);
}

function stampOf(file) {
  const m = file.match(/(\d{14})/) || file.match(/(\d{12})/);
  if (!m) return null;
  const s = m[1];
  const hh = Number(s.slice(8, 10));
  const mm = Number(s.slice(10, 12));
  if (!(hh < 24) || !(mm < 60)) return null;
  return { clock: `${s.slice(8, 10)}:${s.slice(10, 12)}`, stamp: `${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}` };
}

function isPlaceholder(files) {
  return files.length > 0 && files.every((f) => f === files[0] && /^default\.(jpe?g|png)$/i.test(f));
}

async function fetchList(type) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(`${BASE}/Monitor/GetProductByType?type=${type}&t=${Date.now()}`, {
      headers: { 'User-Agent': UA, Referer: `${BASE}/Jcw/Home/Radar` },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`list ${res.status}`);
    const data = JSON.parse(await res.text());
    if (!data || !Array.isArray(data.Data)) throw new Error('list shape');
    return data.Data.map((item) => String((item && item.ListFn) || '')).filter(validFile);
  } finally {
    clearTimeout(timer);
  }
}

function buildProduct(product, files) {
  const maintenance = isPlaceholder(files);
  if (maintenance) return { key: product.key, name: product.name, maintenance: true, latest: '', frames: [] };
  const frames = files.slice(-FRAME_LIMIT).map((file) => {
    const stamp = stampOf(file);
    return {
      file,
      src: `/api/dg-radar/img?type=${product.key}&file=${encodeURIComponent(file)}`,
      clock: stamp ? stamp.clock : '',
      stamp: stamp ? stamp.stamp : '',
    };
  });
  const last = frames[frames.length - 1];
  return { key: product.key, name: product.name, maintenance: false, latest: last ? last.stamp : '', frames };
}

let listCache = null;
let listPending = null;

async function getProducts(force = false) {
  if (!force && listCache && Date.now() - listCache.at < LIST_TTL) return listCache.result;
  if (listPending) return listPending;
  listPending = Promise.all(PRODUCTS.map(async (product) => {
    try {
      return buildProduct(product, await fetchList(product.key));
    } catch (e) {
      return { key: product.key, name: product.name, error: true, maintenance: false, latest: '', frames: [] };
    }
  })).then((products) => {
    const result = {
      source: `${BASE}/Jcw/Home/Radar`,
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

const inflight = new Map();

function matchesType(buf, file) {
  if (/\.png$/i.test(file)) return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50;
  return buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8;
}

async function getFrameFile(type, file) {
  const dir = path.join(cacheRoot, type);
  const target = path.join(dir, file);
  try {
    const stat = await fs.promises.stat(target);
    if (stat.size > 0) return target;
  } catch (e) {
    /* not cached yet */
  }
  if (inflight.has(target)) return inflight.get(target);
  const job = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(`${BASE}/data/product/${type}/${file}`, {
        headers: { 'User-Agent': UA, Referer: `${BASE}/Jcw/Home/Radar` },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`img ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (!matchesType(buf, file)) throw new Error('img type');
      await fs.promises.mkdir(dir, { recursive: true });
      const tmp = `${target}.${process.pid}.tmp`;
      await fs.promises.writeFile(tmp, buf);
      await fs.promises.rename(tmp, target);
      return target;
    } finally {
      clearTimeout(timer);
      inflight.delete(target);
    }
  })();
  inflight.set(target, job);
  return job;
}

module.exports = { BASE, PRODUCTS, FRAME_LIMIT, validKey, validFile, stampOf, getProducts, getFrameFile };
