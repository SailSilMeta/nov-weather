const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const FRAME_LIMIT = 30;
const LIST_TTL = 60e3;
const IMG_TTL = 45e3;
const IMG_MAX = 40;

const lists = new Map();
const frames = new Map();

async function request(url, { referer, accept, method = 'GET', timeout = 12000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Referer: referer || url, Accept: accept || '*/*' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${url} ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function requestJson(url, options) {
  return JSON.parse(await (await request(url, options)).text());
}

function cachedList(key, force, build) {
  const hit = lists.get(key);
  if (!force && hit && Date.now() - hit.at < LIST_TTL) return hit.promise;
  if (hit && hit.pending) return hit.promise;
  const entry = { at: Date.now(), pending: true, promise: null };
  entry.promise = build().then((result) => {
    entry.pending = false;
    entry.at = Date.now();
    entry.result = result;
    return result;
  }).catch((error) => {
    lists.delete(key);
    throw error;
  });
  lists.set(key, entry);
  return entry.promise;
}

function imgUrl(provider, params) {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `/api/${provider}-radar/img?${qs}`;
}

function isPng(buf) {
  return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

function isJpeg(buf) {
  return buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8;
}

function isGif(buf) {
  return buf.length > 8 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46;
}

function imageResult(buf, type, check) {
  if (!check(buf)) {
    const error = new Error('img type');
    error.status = 502;
    throw error;
  }
  return { body: buf, type, maxAge: 60 };
}

/* ---------- 东莞 ---------- */

const DG_BASE = 'https://dg121.com';
const DG_REFERER = `${DG_BASE}/Jcw/Home/Radar`;
const DG_PRODUCTS = [
  { key: 'dgleida', name: '东莞雷达图' },
  { key: 'dgxkz', name: '东莞相控阵' },
  { key: 'zhusanjiao', name: '珠三角雷达图' },
  { key: 'gdleida', name: '广东雷达图' },
];

function dgStampOf(file) {
  const m = file.match(/(\d{14})/) || file.match(/(\d{12})/);
  if (!m) return null;
  const s = m[1];
  const hh = Number(s.slice(8, 10));
  const mm = Number(s.slice(10, 12));
  if (!(hh < 24) || !(mm < 60)) return null;
  return { clock: `${s.slice(8, 10)}:${s.slice(10, 12)}`, stamp: `${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}` };
}

function dgProduct(product, files) {
  if (!files.length) return { key: product.key, name: product.name, maintenance: true, latest: '', frames: [] };
  if (files.every((file) => file === files[0]) && /^default\.(jpe?g|png)$/i.test(files[0])) {
    return { key: product.key, name: product.name, maintenance: true, latest: '', frames: [] };
  }
  const list = files.slice(-FRAME_LIMIT).map((file) => {
    const stamp = dgStampOf(file);
    return { file, src: imgUrl('dg', { type: product.key, file }), clock: stamp ? stamp.clock : '', stamp: stamp ? stamp.stamp : '' };
  });
  const last = list[list.length - 1];
  return { key: product.key, name: product.name, maintenance: false, latest: last ? last.stamp : '', frames: list };
}

function dgList(force) {
  return cachedList('dg', force, async () => {
    const products = await Promise.all(DG_PRODUCTS.map(async (product) => {
      try {
        const data = await requestJson(`${DG_BASE}/Monitor/GetProductByType?type=${product.key}&t=${Date.now()}`, { referer: DG_REFERER });
        if (!data || !Array.isArray(data.Data)) throw new Error('list shape');
        const files = data.Data.map((item) => String((item && item.ListFn) || '')).filter((file) => /^[A-Za-z0-9_.-]+\.(png|jpe?g)$/i.test(file));
        return dgProduct(product, files);
      } catch (e) {
        return { key: product.key, name: product.name, error: true, maintenance: false, latest: '', frames: [] };
      }
    }));
    return { source: DG_REFERER, fetchedAt: new Date().toISOString(), products };
  });
}

function dgFrame(type, file) {
  if (!DG_PRODUCTS.some((product) => product.key === type) || !/^[A-Za-z0-9_.-]+\.(png|jpe?g)$/i.test(file)) return null;
  const png = /\.png$/i.test(file);
  return request(`${DG_BASE}/data/product/${type}/${file}`, { referer: DG_REFERER, timeout: 15000 })
    .then(async (res) => imageResult(new Uint8Array(await res.arrayBuffer()), png ? 'image/png' : 'image/jpeg', png ? isPng : isJpeg));
}

/* ---------- 珠海 ---------- */

const ZH_BASE = 'https://weather.zhuhai.gov.cn';
const ZH_REFERER = `${ZH_BASE}/#/met-services/rdr-img`;
const ZH_PRODUCT = { key: 'zhuhai', name: '珠海雷达' };

function zhStampOf(ms) {
  const iso = new Date(ms + 8 * 3600e3).toISOString();
  const clock = iso.slice(11, 16);
  return { clock, stamp: `${iso.slice(5, 10)} ${clock}` };
}

function zhProduct(items) {
  if (!items.length) return { key: ZH_PRODUCT.key, name: ZH_PRODUCT.name, maintenance: true, latest: '', frames: [] };
  const list = items.slice(-FRAME_LIMIT).map((item) => {
    const stamp = zhStampOf(item.dt);
    return { file: item.file, src: imgUrl('zh', { file: item.file }), clock: stamp.clock, stamp: stamp.stamp };
  });
  const last = list[list.length - 1];
  return { key: ZH_PRODUCT.key, name: ZH_PRODUCT.name, maintenance: false, latest: last ? last.stamp : '', frames: list };
}

function zhList(force) {
  return cachedList('zh', force, async () => {
    const data = await requestJson(`${ZH_BASE}/met`, { referer: ZH_REFERER });
    if (!data || !Array.isArray(data.rdrImgArr)) throw new Error('met shape');
    const items = data.rdrImgArr
      .map((item) => ({ dt: Number(item && item.dt), file: String((item && item.uri) || '').split('/').pop() }))
      .filter((item) => Number.isFinite(item.dt) && /^[A-Za-z0-9_.-]+\.gif$/i.test(item.file))
      .sort((a, b) => a.dt - b.dt);
    return { source: ZH_REFERER, fetchedAt: new Date().toISOString(), products: [zhProduct(items)] };
  });
}

function zhFrame(file) {
  if (!/^[A-Za-z0-9_.-]+\.gif$/i.test(file)) return null;
  return request(`${ZH_BASE}/files/rdr-img/${file}`, { referer: ZH_REFERER, timeout: 15000 })
    .then(async (res) => imageResult(new Uint8Array(await res.arrayBuffer()), 'image/gif', isGif));
}

/* ---------- 佛山 ---------- */

const FS_BASE = 'https://www.fs121.com';
const FS_REFERER = `${FS_BASE}/weatherMonitor/sRadar`;
const FS_PRODUCT = { key: 'foshan', name: '佛山镇街雷达图' };
const FS_PREFIX = '/image/radar/fs/';

function fsStampOf(datetime) {
  const m = String(datetime || '').match(/^\d{4}-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  const clock = `${m[3]}:${m[4]}`;
  return { clock, stamp: `${m[1]}-${m[2]} ${clock}` };
}

function fsProduct(items) {
  if (!items.length) return { key: FS_PRODUCT.key, name: FS_PRODUCT.name, maintenance: true, latest: '', frames: [] };
  const list = items.slice(-FRAME_LIMIT).map((item) => {
    const stamp = fsStampOf(item.datetime);
    return { file: item.file, src: imgUrl('fs', { file: item.file }), clock: stamp.clock, stamp: stamp.stamp };
  });
  const last = list[list.length - 1];
  return { key: FS_PRODUCT.key, name: FS_PRODUCT.name, maintenance: false, latest: last ? last.stamp : '', frames: list };
}

function fsList(force) {
  return cachedList('fs', force, async () => {
    const data = await requestJson(`${FS_BASE}/mpsp/web/SRadar/list?t=${Date.now()}`, { referer: FS_REFERER });
    const raw = data && data.data && data.data.FoShan;
    if (!Array.isArray(raw)) throw new Error('list shape');
    const items = raw
      .map((item) => {
        const uri = String((item && item.path) || '');
        return { file: uri.startsWith(FS_PREFIX) ? uri.slice(FS_PREFIX.length) : '', datetime: String((item && item.datetime) || '') };
      })
      .filter((item) => /^[A-Za-z0-9_.-]+\.png$/i.test(item.file) && fsStampOf(item.datetime))
      .sort((a, b) => a.datetime.localeCompare(b.datetime));
    return { source: FS_REFERER, fetchedAt: new Date().toISOString(), products: [fsProduct(items)] };
  });
}

function fsFrame(file) {
  if (!/^[A-Za-z0-9_.-]+\.png$/i.test(file)) return null;
  return request(`${FS_BASE}${FS_PREFIX}${file}`, { referer: FS_REFERER, timeout: 15000 })
    .then(async (res) => imageResult(new Uint8Array(await res.arrayBuffer()), 'image/png', isPng));
}

/* ---------- 江门 ---------- */

const JM_BASE = 'http://jmtqcloud.jmqxgf.com.cn';
const JM_REFERER = 'http://jmtqwxh.jmqxgf.com.cn/wxhradar/radar.html';
const JM_PRODUCTS = [
  { key: 'jmsc', name: '上川岛雷达', dir: '/upload/weather_data/radarpic/', pattern: /^scradar(\d{1,2})\.png$/, base: 'scradar', ext: '.png', count: 10, descending: true },
  { key: 'jmjm', name: '江门雷达', dir: '/upload/weather_data/radarpic/', pattern: /^ZWCR(\d{1,2})\.png$/, base: 'ZWCR', ext: '.png', count: 10, descending: true },
  { key: 'jmgd', name: '全省雷达', dir: '/upload/WeatherFiles/', pattern: /^NEW_AWS_GD_CAPPI_(\d{1,2})\.PNG$/, base: 'NEW_AWS_GD_CAPPI_', ext: '.PNG', count: 8, descending: false },
];

function jmProductOf(key) {
  return JM_PRODUCTS.find((product) => product.key === key) || null;
}

function jmFileOk(product, file) {
  const m = product.pattern.exec(file);
  if (!m) return false;
  const n = Number(m[1]);
  return n >= 1 && n <= product.count;
}

async function jmHead(product, file) {
  try {
    const res = await request(`${JM_BASE}${product.dir}${file}`, { referer: JM_REFERER, method: 'HEAD', timeout: 8000 });
    const ms = Date.parse(res.headers.get('last-modified') || '');
    return Number.isFinite(ms) ? ms : null;
  } catch (e) {
    return null;
  }
}

async function jmProduct(product) {
  const names = [];
  for (let n = 1; n <= product.count; n += 1) {
    names.push(`${product.base}${product.descending ? product.count + 1 - n : n}${product.ext}`);
  }
  const ms = await Promise.all(names.map((name) => jmHead(product, name)));
  const items = names.map((file, i) => ({ file, ms: ms[i] })).filter((item) => item.ms);
  if (!items.length) return { key: product.key, name: product.name, maintenance: true, latest: '', frames: [] };
  const newest = Math.max(...items.map((item) => item.ms).filter(Boolean), 0);
  return {
    key: product.key,
    name: product.name,
    maintenance: false,
    latest: '',
    stale: !newest || Date.now() - newest > 3 * 3600e3,
    frames: items.map((item) => ({ file: item.file, src: imgUrl('jm', { type: product.key, file: item.file }), clock: '', stamp: '' })),
  };
}

function jmList(force) {
  return cachedList('jm', force, async () => {
    const products = await Promise.all(JM_PRODUCTS.map(async (product) => {
      try {
        return await jmProduct(product);
      } catch (e) {
        return { key: product.key, name: product.name, error: true, maintenance: false, latest: '', frames: [] };
      }
    }));
    return { source: JM_REFERER, fetchedAt: new Date().toISOString(), products };
  });
}

function jmFrame(type, file) {
  const product = jmProductOf(type);
  if (!product || !jmFileOk(product, file)) return null;
  return request(`${JM_BASE}${product.dir}${file}`, { referer: JM_REFERER, timeout: 15000 })
    .then(async (res) => imageResult(new Uint8Array(await res.arrayBuffer()), 'image/png', isPng));
}

/* ---------- 广州 ---------- */

const GZ_BASE = 'https://www.gzqxfw.com.cn';
const GZ_REFERER = `${GZ_BASE}/wx/`;
const GZ_PRODUCT = { key: 'gzcr', name: '广州市组合反射率' };
const GZ_DIR = '/data/swanmcrHttp/GZ/';

function gzStampOf(ms) {
  const iso = new Date(ms + 8 * 3600e3).toISOString();
  const clock = iso.slice(11, 16);
  return { clock, stamp: `${iso.slice(5, 10)} ${clock}` };
}

function gzProduct(items) {
  if (!items.length) return { key: GZ_PRODUCT.key, name: GZ_PRODUCT.name, maintenance: true, latest: '', frames: [] };
  const list = items.slice(-FRAME_LIMIT).map((item) => {
    const stamp = gzStampOf(item.dt);
    return { file: item.file, src: imgUrl('gz', { file: item.file }), clock: stamp.clock, stamp: stamp.stamp };
  });
  const last = list[list.length - 1];
  return { key: GZ_PRODUCT.key, name: GZ_PRODUCT.name, maintenance: false, latest: last ? last.stamp : '', frames: list };
}

function gzList(force) {
  return cachedList('gz', force, async () => {
    const data = await requestJson(`${GZ_BASE}${GZ_DIR}swanmcrGZ.json?t=${Date.now()}`, { referer: GZ_REFERER });
    const times = data && data.times;
    const images = data && data.images;
    if (!Array.isArray(times) || !Array.isArray(images)) throw new Error('list shape');
    const items = images
      .map((file, i) => ({ file: String(file || ''), dt: Number(times[i]) }))
      .filter((item) => /^\d{8}\/[A-Za-z0-9_.-]+\.png$/.test(item.file) && Number.isFinite(item.dt))
      .sort((a, b) => a.dt - b.dt);
    return { source: `${GZ_BASE}/wx/#/radarImage`, fetchedAt: new Date().toISOString(), products: [gzProduct(items)] };
  });
}

function gzFrame(file) {
  if (!/^\d{8}\/[A-Za-z0-9_.-]+\.png$/.test(file)) return null;
  return request(`${GZ_BASE}${GZ_DIR}${file}`, { referer: GZ_REFERER, timeout: 15000 })
    .then(async (res) => imageResult(new Uint8Array(await res.arrayBuffer()), 'image/png', isPng));
}

/* ---------- 澳门 ---------- */

const MO_BASE = 'https://www.dsmg.gov.mo';
const MO_CDN = 'https://cdn.dsmg.gov.mo/uploads/dsmg/';
const MO_REFERER = `${MO_BASE}/zh-hant/monitoring-images`;
const MO_PRODUCTS = [
  { key: 'moRadar', name: '珠澳天气雷达', api: 'radarMap', group: 'radarMap/240km', dir: 'radarMap/240km', pattern: /^radar(\d{2})\.jpg$/ },
  { key: 'moLight', name: '闪电定位', api: 'lightning', group: 'lightning/prd', dir: 'lightning/prd', pattern: /^llis(\d{2})\.png$/ },
];

function moProductOf(key) {
  return MO_PRODUCTS.find((product) => product.key === key) || null;
}

function moStampOf(time) {
  const m = String(time || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  const clock = `${m[4]}:${m[5]}`;
  return { clock, stamp: `${m[2]}-${m[3]} ${clock}` };
}

function moProduct(product, items) {
  if (!items.length) return { key: product.key, name: product.name, maintenance: true, latest: '', frames: [] };
  const list = items.map((item) => {
    const stamp = moStampOf(item.time);
    return { file: item.file, src: imgUrl('mo', { type: product.key, file: item.file }), clock: stamp.clock, stamp: stamp.stamp };
  });
  const last = list[list.length - 1];
  return { key: product.key, name: product.name, maintenance: false, latest: last ? last.stamp : '', frames: list };
}

function moList(force) {
  return cachedList('mo', force, async () => {
    const products = await Promise.all(MO_PRODUCTS.map(async (product) => {
      try {
        const data = await requestJson(`${MO_BASE}/api/images/get-images/${product.api}?type=${product.api}`, { referer: MO_REFERER, accept: 'application/json' });
        const group = data && data.data && data.data[product.group];
        if (!group) throw new Error('list shape');
        const items = (Array.isArray(group.fileInfos) ? group.fileInfos : [])
          .map((item) => ({ file: String((item && item.file) || ''), time: String((item && item.time) || '') }))
          .filter((item) => product.pattern.test(item.file) && moStampOf(item.time))
          .sort((a, b) => a.time.localeCompare(b.time));
        return moProduct(product, items);
      } catch (e) {
        return { key: product.key, name: product.name, error: true, maintenance: false, latest: '', frames: [] };
      }
    }));
    return { source: MO_REFERER, fetchedAt: new Date().toISOString(), products };
  });
}

async function moFrame(type, file) {
  const product = moProductOf(type);
  if (!product || !product.pattern.test(file)) return null;
  const res = await request(`${MO_CDN}${product.dir}/${file}`, { referer: MO_REFERER, timeout: 15000 });
  const png = /\.png$/i.test(file);
  return imageResult(new Uint8Array(await res.arrayBuffer()), png ? 'image/png' : 'image/jpeg', png ? isPng : isJpeg);
}

/* ---------- 图片内存缓存 ---------- */

function imageCache(key, load) {
  const hit = frames.get(key);
  if (hit && Date.now() - hit.at < IMG_TTL) return hit.promise;
  const entry = { at: Date.now(), promise: null };
  entry.promise = load().catch((error) => {
    frames.delete(key);
    throw error;
  });
  frames.set(key, entry);
  if (frames.size > IMG_MAX) frames.delete(frames.keys().next().value);
  return entry.promise;
}

function frameFor(name, load) {
  return (type, file) => {
    const job = load(type, file);
    return job ? imageCache(`${name}/${type}/${file}`, () => job) : Promise.resolve(null);
  };
}

const PROVIDERS = {
  dg: { list: dgList, frame: frameFor('dg', dgFrame) },
  zh: { list: zhList, frame: frameFor('zh', (type, file) => zhFrame(file)) },
  fs: { list: fsList, frame: frameFor('fs', (type, file) => fsFrame(file)) },
  jm: { list: jmList, frame: frameFor('jm', jmFrame) },
  gz: { list: gzList, frame: frameFor('gz', (type, file) => gzFrame(file)) },
  mo: { list: moList, frame: frameFor('mo', moFrame) },
};

export { PROVIDERS };
