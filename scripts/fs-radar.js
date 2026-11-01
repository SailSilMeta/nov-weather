const fs = require('fs');
const path = require('path');

const BASE = 'https://www.fs121.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const PRODUCT = { key: 'foshan', name: '佛山镇街雷达图' };
const LIST_URL = `${BASE}/mpsp/web/SRadar/list`;
const IMG_PREFIX = '/image/radar/fs/';
const FRAME_LIMIT = 30;
const LIST_TTL = 60e3;
const cacheRoot = path.join(__dirname, '..', 'cache', 'fs-radar');

function validFile(file) {
  return /^[A-Za-z0-9_.-]+\.png$/i.test(file);
}

function stampOf(datetime) {
  const m = String(datetime || '').match(/^\d{4}-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  const clock = `${m[3]}:${m[4]}`;
  return { clock, stamp: `${m[1]}-${m[2]} ${clock}` };
}

async function fetchList() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(`${LIST_URL}?t=${Date.now()}`, {
      headers: { 'User-Agent': UA, Referer: `${BASE}/weatherMonitor/sRadar` },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`list ${res.status}`);
    const data = JSON.parse(await res.text());
    const list = data && data.data && data.data.FoShan;
    if (!Array.isArray(list)) throw new Error('list shape');
    return list
      .map((item) => {
        const uri = String((item && item.path) || '');
        const file = uri.startsWith(IMG_PREFIX) ? uri.slice(IMG_PREFIX.length) : '';
        return { file, datetime: String((item && item.datetime) || '') };
      })
      .filter((item) => validFile(item.file) && stampOf(item.datetime))
      .sort((a, b) => a.datetime.localeCompare(b.datetime));
  } finally {
    clearTimeout(timer);
  }
}

function buildProduct(items) {
  const frames = items.slice(-FRAME_LIMIT).map((item) => {
    const stamp = stampOf(item.datetime);
    return {
      file: item.file,
      src: `/api/fs-radar/img?file=${encodeURIComponent(item.file)}`,
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
        source: `${BASE}/weatherMonitor/sRadar`,
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
      const res = await fetch(`${BASE}${IMG_PREFIX}${file}`, {
        headers: { 'User-Agent': UA, Referer: `${BASE}/weatherMonitor/sRadar` },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`img ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50) throw new Error('img type');
      await fs.promises.mkdir(cacheRoot, { recursive: true });
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

module.exports = { BASE, PRODUCT, FRAME_LIMIT, validFile, stampOf, getProduct, getFrameFile };
