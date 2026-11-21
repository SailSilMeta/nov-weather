const fs = require('fs').promises;
const path = require('path');
const { randomUUID } = require('crypto');
const gz = require('./gz-radar');
const jm = require('./jm-radar');
const mo = require('./mo-radar');
const news = require('./gd-news');

const DATA = path.join(__dirname, '..', 'data');
const RADAR = path.join(DATA, 'radar');
const LIMIT = 4;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JM_FILES = new Map(jm.PRODUCTS.map((product) => [product.key, new Set(
  Array.from({ length: product.count }, (_, i) => `${product.base}${i + 1}${product.ext}`)
)]));
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const MO_FILES = new Map([
  ['moRadar', 'radar', '.jpg'],
  ['moLight', 'llis', '.png'],
].map(([key, base, ext]) => [key, new Set(
  Array.from({ length: 10 }, (_, i) => `${base}${String(i + 1).padStart(2, '0')}${ext}`)
)]));

async function atomicWrite(target, contents) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, contents, { flag: 'wx' });
    await fs.rename(tmp, target);
  } finally {
    await fs.rm(tmp, { force: true }).catch((error) => console.warn(`temp cleanup: ${error.message}`));
  }
}

async function writeSnapshot(name, payload) {
  const contents = `${JSON.stringify(payload)}\n`;
  await atomicWrite(path.join(DATA, name), contents);
  return Buffer.byteLength(contents);
}

async function pool(items, fn) {
  const result = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(LIMIT, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      result[i] = await fn(items[i]);
    }
  }));
  return result;
}

// Hold slots through response bodies because adapters also fan out requests.
function limitedFetch(fetchImpl) {
  let active = 0;
  const waiting = [];
  return async (input, options) => {
    await new Promise((resolve) => {
      if (active < LIMIT) {
        active++;
        resolve();
      } else {
        waiting.push(resolve);
      }
    });
    try {
      if (options && options.signal) options.signal.throwIfAborted();
      const response = await fetchImpl(input, options);
      const body = await response.arrayBuffer();
      return new Response(body.byteLength ? body : null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

async function fetchGuangzhou() {
  const result = await gz.getProduct(true);
  const product = result.products && result.products.find((item) => item.key === gz.PRODUCT.key);
  if (!product || !Array.isArray(product.frames) || product.error) throw new Error('invalid Guangzhou product');
  const frames = product.frames.map((frame) => {
    if (typeof frame.file !== 'string' || !gz.validFile(frame.file)) throw new Error('invalid Guangzhou filename');
    return { ...frame, src: `https://www.gzqxfw.com.cn/data/swanmcrHttp/GZ/${frame.file}` };
  });
  if (!frames.length && !product.maintenance) throw new Error('empty Guangzhou frames');
  const bytes = await writeSnapshot('radar-gz.json', {
    source: result.source,
    fetchedAt: new Date().toISOString(),
    products: [{ ...product, frames }],
  });
  return `${frames.length} frames, maintenance=${!!product.maintenance}, JSON ${bytes} B (official HTTPS images, not mirrored)`;
}

async function fetchJiangmen() {
  const result = await jm.getProducts(true);
  if (!Array.isArray(result.products)) throw new Error('invalid Jiangmen products');
  const version = Date.now();
  const products = jm.PRODUCTS.map((definition) => {
    const product = result.products.find((item) => item.key === definition.key);
    return { ...product, key: definition.key, name: definition.name, frames: [] };
  });
  const jobs = [];
  for (const definition of jm.PRODUCTS) {
    const product = result.products.find((item) => item.key === definition.key);
    const seen = new Set();
    for (const frame of (product && Array.isArray(product.frames) ? product.frames : [])) {
      // Never accept upstream URLs, arbitrary product keys, paths or numbered history.
      if (!frame || !JM_FILES.get(definition.key).has(frame.file) || seen.has(frame.file)) continue;
      seen.add(frame.file);
      jobs.push({ key: definition.key, frame });
    }
  }
  const mirrored = await pool(jobs, async ({ key, frame }) => {
    const filename = `${key}-${frame.file}`;
    try {
      const buf = await jm.getFrame(key, frame.file);
      if (!Buffer.isBuffer(buf) || !buf.subarray(0, PNG.length).equals(PNG)) throw new Error('invalid PNG signature');
      await atomicWrite(path.join(RADAR, filename), buf);
      return {
        key, filename, bytes: buf.length,
        frame: { ...frame, src: `data/radar/${filename}?v=${version}` },
      };
    } catch (error) {
      console.warn(`jm ${key}/${frame.file}: ${error.message}`);
      return null;
    }
  });
  const saved = mirrored.filter(Boolean);
  for (const product of products) {
    product.frames = saved.filter((item) => item.key === product.key).map((item) => item.frame);
    // HEAD failures are not evidence of maintenance; do not reuse old product frames.
    product.maintenance = false;
    product.error = !product.frames.length;
    product.partial = product.frames.length > 0 && product.frames.length < JM_FILES.get(product.key).size;
    product.latest = product.frames.length ? product.frames[product.frames.length - 1].stamp || '' : '';
    console.log(`jm ${product.key}: ${product.frames.length}/${JM_FILES.get(product.key).size} frames, error=${product.error}, partial=${product.partial}, stale=${product.stale == null ? 'unknown' : product.stale}`);
  }
  if (!saved.length) throw new Error('no Jiangmen frames mirrored; old snapshot and fetchedAt retained');
  const bytes = await writeSnapshot('radar-jm.json', {
    source: result.source,
    fetchedAt: new Date().toISOString(),
    products,
  });
  // Prune only our declared fixed filenames, and only after publishing a usable JSON.
  const keep = new Set(saved.map((item) => item.filename));
  for (const [key, files] of JM_FILES) {
    for (const file of files) {
      const filename = `${key}-${file}`;
      if (!keep.has(filename)) {
        await fs.rm(path.join(RADAR, filename), { force: true })
          .catch((error) => console.warn(`PNG cleanup ${filename}: ${error.message}`));
      }
    }
  }
  const pngBytes = saved.reduce((sum, item) => sum + item.bytes, 0);
  return `${saved.length}/28 frames, JSON ${bytes} B, PNG ${pngBytes} B`;
}

async function fetchMacau() {
  const result = await mo.getProducts(true);
  if (!result || !Array.isArray(result.products)) throw new Error('invalid Macau products');
  const version = Date.now();
  const products = [];
  const jobs = [];
  const listed = new Map();
  for (const definition of mo.PRODUCTS.filter((item) => MO_FILES.has(item.key))) {
    const product = result.products.find((item) => item && item.key === definition.key);
    products.push({ ...product, key: definition.key, name: definition.name, frames: [] });
    const seen = new Set();
    const frames = product && !product.error && Array.isArray(product.frames) ? product.frames : [];
    for (const frame of frames) {
      // The upstream adapter permits other numbers; snapshots only own slots 01..10.
      if (!frame || !MO_FILES.get(definition.key).has(frame.file) || seen.has(frame.file)) continue;
      seen.add(frame.file);
      jobs.push({ key: definition.key, frame });
    }
    listed.set(definition.key, seen.size);
  }
  const mirrored = await pool(jobs, async ({ key, frame }) => {
    const filename = `${key}-${frame.file}`;
    try {
      const buf = await mo.getFrame(key, frame.file);
      const signature = key === 'moRadar' ? JPEG : PNG;
      if (!Buffer.isBuffer(buf) || !buf.subarray(0, signature.length).equals(signature)) {
        throw new Error(`invalid ${key === 'moRadar' ? 'JPEG' : 'PNG'} signature`);
      }
      await atomicWrite(path.join(RADAR, filename), buf);
      return {
        key, filename, bytes: buf.length,
        frame: { file: frame.file, clock: frame.clock, stamp: frame.stamp, src: `data/radar/${filename}?v=${version}` },
      };
    } catch (error) {
      console.warn(`mo ${key}/${frame.file}: ${error.message}`);
      return null;
    }
  });
  const saved = mirrored.filter(Boolean);
  for (const product of products) {
    product.frames = saved.filter((item) => item.key === product.key).map((item) => item.frame);
    // A failed/empty list or failed mirrors must not refresh old frames as new data.
    product.maintenance = false;
    product.error = !product.frames.length;
    product.partial = product.frames.length > 0 && product.frames.length < listed.get(product.key);
    product.latest = product.frames.length ? product.frames[product.frames.length - 1].stamp || '' : '';
    console.log(`mo ${product.key}: ${product.frames.length}/${listed.get(product.key)} frames, error=${product.error}, partial=${product.partial}`);
  }
  if (!saved.length) throw new Error('no Macau frames mirrored; old snapshot and fetchedAt retained');
  const bytes = await writeSnapshot('radar-mo.json', {
    source: result.source,
    fetchedAt: new Date().toISOString(),
    products,
  });
  // Only prune our 20 declared files after the new JSON is safely published.
  const keep = new Set(saved.map((item) => item.filename));
  for (const [key, files] of MO_FILES) {
    for (const file of files) {
      const filename = `${key}-${file}`;
      if (!keep.has(filename)) {
        await fs.rm(path.join(RADAR, filename), { force: true })
          .catch((error) => console.warn(`Macau image cleanup ${filename}: ${error.message}`));
      }
    }
  }
  const imageBytes = saved.reduce((sum, item) => sum + item.bytes, 0);
  return `${saved.length}/20 frames, JSON ${bytes} B, images ${imageBytes} B`;
}

async function fetchNews() {
  let failedPages = [];
  const result = await news.fetchIndex((pages) => { failedPages = pages; });
  if (!Array.isArray(result) || !result.length) throw new Error('empty news index');
  const items = result.slice(0, 200).map((item) => {
    if (!item || typeof item.title !== 'string' || !item.title.trim() ||
        typeof item.time !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(item.time) ||
        typeof item.url !== 'string' || !item.url.startsWith('https://www.gd121.cn/')) {
      throw new Error('invalid news item');
    }
    return { title: item.title, time: item.time, url: item.url };
  });
  const bytes = await writeSnapshot('radar-news.json', {
    source: news.SOURCE,
    fetchedAt: new Date().toISOString(),
    items,
  });
  const partial = failedPages.length ? `, pages ${failedPages.join('/')} failed` : '';
  return `${items.length} items${partial}, JSON ${bytes} B`;
}

async function writeSummary(rows) {
  const failed = rows.filter((row) => !row.ok);
  const detail = (text) => String(text).replace(/\|/g, '\\|');
  const lines = [
    '### Radar snapshot refresh',
    '',
    '| Source | Result | Detail |',
    '| --- | --- | --- |',
    ...rows.map((row) => `| ${row.name} | ${row.ok ? 'OK' : 'FAILED'} | ${detail(row.detail)} |`),
    '',
    failed.length ? `**${failed.length}/${rows.length} sources failed.**` : 'All sources updated.',
  ];
  const text = `${lines.join('\n')}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, text)
      .catch((error) => console.warn(`step summary write failed: ${error.message}`));
  }
  return text;
}

async function main() {
  const fetchImpl = globalThis.fetch;
  globalThis.fetch = limitedFetch(fetchImpl);
  const rows = [];
  try {
    // Keep sources independent; a failed source never rewrites its previous JSON.
    for (const [name, task] of [['gz', fetchGuangzhou], ['jm', fetchJiangmen], ['mo', fetchMacau], ['news', fetchNews]]) {
      try {
        rows.push({ name, ok: true, detail: await task() });
      } catch (error) {
        rows.push({ name, ok: false, detail: error.message });
      }
    }
  } finally {
    globalThis.fetch = fetchImpl;
  }
  const succeeded = rows.filter((row) => row.ok).length;
  for (const row of rows) {
    if (row.ok) console.log(`${row.name}: OK ${row.detail}`);
    else {
      console.error(`${row.name}: FAILED ${row.detail}; previous JSON/fetchedAt unchanged (if present)`);
      console.log(`::error::${row.name} snapshot failed: ${row.detail}`);
    }
  }
  const summary = await writeSummary(rows);
  console.log(summary);
  console.log(`radar snapshots: ${succeeded}/${rows.length} sources updated`);
  if (!succeeded) throw new Error('all radar/news sources failed');
  // 部分成功仍提交已抓到的快照，但用非零退出码让运行标红（workflow 里 continue-on-error 后再显式失败）。
  if (succeeded < rows.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { main, fetchGuangzhou, fetchJiangmen, fetchMacau, fetchNews, limitedFetch };
