const fs = require('fs');
const path = require('path');

const BASE = 'https://www.gzqxfw.com.cn';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const PRODUCT = { key: 'gzcr', name: '广州市组合反射率' };
const LIST_PATH = '/data/swanmcrHttp/GZ/swanmcrGZ.json';
const IMG_DIR = '/data/swanmcrHttp/GZ/';
const FRAME_LIMIT = 30;
const LIST_TTL = 60e3;
const cacheRoot = path.join(__dirname, '..', 'cache', 'gz-radar');

function validFile(file) {
  return /^\d{8}\/[A-Za-z0-9_.-]+\.png$/.test(file);
}

function stampOf(ms) {
  const iso = new Date(ms + 8 * 3600e3).toISOString();
  const clock = iso.slice(11, 16);
  return { clock, stamp: `${iso.slice(5, 10)} ${clock}` };
}

async function fetchList() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(`${BASE}${LIST_PATH}?t=${Date.now()}`, {
      headers: { 'User-Agent': UA, Referer: `${BASE}/wx/` },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`list ${res.status}`);
    const data = JSON.parse(await res.text());
    const times = data && data.times;
    const images = data && data.images;
    if (!Array.isArray(times) || !Array.isArray(images)) throw new Error('list shape');
    return images
      .map((file, i) => ({ file: String(file || ''), dt: Number(times[i]) }))
      .filter((item) => validFile(item.file) && Number.isFinite(item.dt))
      .sort((a, b) => a.dt - b.dt);
  } finally {
    clearTimeout(timer);
  }
}

function buildProduct(items) {
  const frames = items.slice(-FRAME_LIMIT).map((item) => {
    const stamp = stampOf(item.dt);
    return {
      file: item.file,
      src: `/api/gz-radar/img?file=${encodeURIComponent(item.file)}`,
      clock: stamp.clock,
      stamp: stamp.stamp,
    };
  });
  if (!frames.length) {
    return { key: PRODUCT.key, name: PRODUCT.name, maintenance: true, latest: '', frames: [] };
  }
  const last = frames[frames.length - 1];
  return { key: PRODUCT.key, name: PRODUCT.name, maintenance: false, latest: last.stamp, frames };
}

let listCache = null;
let listPending = null;

async function getProduct(force = false) {
  if (!force && listCache && Date.now() - listCache.at < LIST_TTL) return listCache.result;
  if (listPending) return listPending;
  listPending = fetchList()
    .then((items) => {
      const result = {
        source: `${BASE}/wx/#/radarImage`,
        fetchedAt: new Date().toISOString(),
        products: [buildProduct(items)],
      };
      listCache = { at: Date.now(), result };
      return result;
    })
    .finally(() => {
      listPending = null;
    });
  return listPending;
}

const inflight = new Map();

async function getFrameFile(file) {
  const target = path.join(cacheRoot, file);
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
      const res = await fetch(`${BASE}${IMG_DIR}${file}`, {
        headers: { 'User-Agent': UA, Referer: `${BASE}/wx/` },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`img ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50) throw new Error('img type');
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
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

module.exports = { BASE, PRODUCT, FRAME_LIMIT, validFile, getProduct, getFrameFile };
