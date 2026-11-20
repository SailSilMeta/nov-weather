(function () {
  'use strict';

  const RADAR_TTL = 30 * 60e3;
  const NEWS_TTL = 24 * 3600e3;
  const FRAME_LIMIT = 30;

  async function readJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
      if (!response.ok) throw new Error('数据读取失败');
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function stamp(time) {
    const date = new Date(time + 8 * 3600e3);
    if (!Number.isFinite(date.getTime())) return null;
    const iso = date.toISOString();
    return { clock: iso.slice(11, 16), stamp: `${iso.slice(5, 10)} ${iso.slice(11, 16)}` };
  }

  function textStamp(value) {
    const match = String(value || '').match(/^\d{4}-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (!match || Number(match[3]) > 23 || Number(match[4]) > 59) return null;
    return { clock: `${match[3]}:${match[4]}`, stamp: `${match[1]}-${match[2]} ${match[3]}:${match[4]}` };
  }

  function fileStamp(file) {
    const match = file.match(/\d{14}/) || file.match(/\d{12}/);
    if (!match) return { clock: '', stamp: '' };
    const s = match[0];
    const time = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}`;
    // Z9200 文件名采用 UTC，图片内标注采用北京时间。
    if (file.startsWith('Z_RADR_I_Z9200_')) return stamp(Date.parse(`${time}:00Z`)) || { clock: '', stamp: '' };
    return textStamp(time) || { clock: '', stamp: '' };
  }

  function productFrames(product, frames) {
    const limited = frames.slice(-FRAME_LIMIT);
    return { ...product, frames: limited, maintenance: !limited.length, latest: limited.at(-1)?.stamp || '' };
  }

  function failedProduct(product, errorNote = '官方数据暂不可用') {
    return { ...product, error: true, errorNote, maintenance: false, frames: [] };
  }

  async function dongguan(source) {
    return Promise.all(source.products.map(async (product) => {
      try {
        const data = await readJson(`https://dg121.com/Monitor/GetProductByType?type=${product.key}&t=${Date.now()}`);
        if (!Array.isArray(data?.Data)) throw new Error('数据格式无效');
        const files = data.Data.map((row) => String(row?.ListFn || '')).filter((file) => /^[A-Za-z0-9_.-]+\.(png|jpe?g)$/i.test(file));
        if (files.length && files.every((file) => /^default\.(png|jpe?g)$/i.test(file))) return productFrames(product, []);
        return productFrames(product, files.map((file) => ({ file, src: `https://dg121.com/data/product/${product.key}/${file}`, ...fileStamp(file) })));
      } catch (error) {
        return failedProduct(product);
      }
    }));
  }

  async function zhuhai(source) {
    const data = await readJson('https://weather.zhuhai.gov.cn/met');
    if (!Array.isArray(data?.rdrImgArr)) throw new Error('官方数据格式无效');
    const frames = data.rdrImgArr.map((row) => ({ file: String(row?.uri || '').split('/').pop(), time: Number(row?.dt) }))
      .filter((row) => /^[A-Za-z0-9_.-]+\.gif$/i.test(row.file) && row.time > 0 && stamp(row.time))
      .sort((a, b) => a.time - b.time)
      .map((row) => ({ file: row.file, src: `https://weather.zhuhai.gov.cn/files/rdr-img/${row.file}`, ...stamp(row.time) }));
    return [productFrames(source.products[0], frames)];
  }

  async function foshan(source) {
    const data = await readJson(`https://www.fs121.com/mpsp/web/SRadar/list?t=${Date.now()}`);
    if (!Array.isArray(data?.data?.FoShan)) throw new Error('官方数据格式无效');
    const frames = data.data.FoShan.map((row) => ({ path: String(row?.path || ''), time: String(row?.datetime || '') }))
      .filter((row) => /^\/image\/radar\/fs\/[A-Za-z0-9_.-]+\.png$/i.test(row.path) && textStamp(row.time))
      .sort((a, b) => a.time.localeCompare(b.time))
      .map((row) => ({ file: row.path.split('/').pop(), src: `https://www.fs121.com${row.path}`, ...textStamp(row.time) }));
    return [productFrames(source.products[0], frames)];
  }

  function checkImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const finish = (error) => {
        clearTimeout(timer);
        image.onload = image.onerror = null;
        if (error) {
          image.removeAttribute('src');
          reject(error);
        } else resolve();
      };
      const timer = setTimeout(() => finish(new Error('图片读取超时')), 15000);
      image.onload = () => finish();
      image.onerror = () => finish(new Error('图片读取失败'));
      image.src = src;
    });
  }

  async function macau(source) {
    const products = await Promise.all(source.products.map(async (product) => {
      try {
        const radar = product.key === 'moRadar';
        const api = radar ? 'radarMap' : 'lightning';
        const group = radar ? 'radarMap/240km' : 'lightning/prd';
        const pattern = radar ? /^radar\d{2}\.jpg$/ : /^llis\d{2}\.png$/;
        const data = await readJson(`https://www.dsmg.gov.mo/api/images/get-images/${api}?type=${api}`);
        const rows = data?.data?.[group]?.fileInfos;
        if (!Array.isArray(rows)) throw new Error('数据格式无效');
        const frames = rows.map((row) => ({ file: String(row?.file || ''), time: String(row?.time || '') }))
          .filter((row) => pattern.test(row.file) && textStamp(row.time))
          .sort((a, b) => a.time.localeCompare(b.time))
          .map((row) => ({ file: row.file, src: `https://cdn.dsmg.gov.mo/uploads/dsmg/${group}/${row.file}?v=${encodeURIComponent(row.time)}`, ...textStamp(row.time) }));
        if (rows.length && !frames.length) throw new Error('图片列表无效');
        if (frames.length) await checkImage(frames.at(-1).src);
        return productFrames(product, frames);
      } catch (error) {
        return failedProduct(product);
      }
    }));
    if (!products.some((product) => product.error)) return products;
    const backup = await radarSnapshot(source).catch((error) => source.products.map((product) => failedProduct(product, `官方直连失败 · ${error.message}`)));
    return products.map((product) => {
      if (!product.error) return product;
      const saved = backup.find((item) => item.key === product.key);
      return { ...saved, fallback: !saved.error };
    });
  }

  async function snapshot(name, ttl) {
    let data;
    try {
      data = await readJson(`data/radar-${name}.json?t=${Date.now()}`);
    } catch (error) {
      throw new Error('快照暂不可用');
    }
    const fetchedAt = Date.parse(data?.fetchedAt || '');
    const now = Date.now();
    if (!Number.isFinite(fetchedAt) || fetchedAt > now + 60e3) throw new Error('快照时间无效');
    if (now - fetchedAt >= ttl) throw new Error('快照已过期，等待自动更新');
    return { data, snapshotAt: Math.min(fetchedAt, now), validUntil: Math.min(fetchedAt, now) + ttl };
  }

  function validSnapshotFrame(key, product, frame) {
    if (!frame || typeof frame.src !== 'string' || typeof frame.file !== 'string') return false;
    if (key === 'gz') {
      return /^\d{8}\/[A-Za-z0-9_.-]+\.png$/.test(frame.file)
        && frame.src === `https://www.gzqxfw.com.cn/data/swanmcrHttp/GZ/${frame.file}`;
    }
    const pattern = {
      jmsc: /^scradar(?:[1-9]|10)\.png$/,
      jmjm: /^ZWCR(?:[1-9]|10)\.png$/,
      jmgd: /^NEW_AWS_GD_CAPPI_[1-8]\.PNG$/,
      moRadar: /^radar(?:0[1-9]|10)\.jpg$/,
      moLight: /^llis(?:0[1-9]|10)\.png$/,
    }[product.key];
    return Boolean(pattern?.test(frame.file)) && frame.src.split('?')[0] === `data/radar/${product.key}-${frame.file}`
      && /^\?v=\d+$/.test(frame.src.slice(frame.src.indexOf('?')));
  }

  async function radarSnapshot(source) {
    const { data, snapshotAt, validUntil } = await snapshot(source.key, RADAR_TTL);
    if (!Array.isArray(data.products)) throw new Error('快照格式无效');
    return source.products.map((product) => {
      const row = data.products.find((item) => item?.key === product.key);
      if (!row || row.error || !Array.isArray(row.frames)) return failedProduct(product, '该站快照更新失败');
      const frames = row.frames.filter((frame) => validSnapshotFrame(source.key, product, frame))
        .map((frame) => ({ file: frame.file, src: frame.src, clock: String(frame.clock || ''), stamp: String(frame.stamp || '') }));
      if (frames.length !== row.frames.length) return failedProduct(product, '快照图片地址无效');
      return { ...productFrames(product, frames), maintenance: Boolean(row.maintenance), stale: Boolean(row.stale), partial: Boolean(row.partial), snapshotAt, validUntil };
    });
  }

  async function load(source) {
    try {
      if (source.key === 'dg') return await dongguan(source);
      if (source.key === 'zh') return await zhuhai(source);
      if (source.key === 'fs') return await foshan(source);
      if (source.key === 'mo') return await macau(source);
      return await radarSnapshot(source);
    } catch (error) {
      const note = ['gz', 'jm'].includes(source.key) ? error.message : '官方数据暂不可用';
      return source.products.map((product) => failedProduct(product, note));
    }
  }

  async function loadNews(page) {
    const { data, snapshotAt, validUntil } = await snapshot('news', NEWS_TTL);
    if (!Array.isArray(data.items)) throw new Error('资讯快照格式无效');
    const items = data.items.filter((item) => item && typeof item.title === 'string' && item.title.trim()
      && typeof item.time === 'string' && typeof item.url === 'string' && item.url.startsWith('https://www.gd121.cn/'));
    if (items.length !== data.items.length) throw new Error('资讯快照格式无效');
    const totalPages = Math.max(1, Math.ceil(items.length / 12));
    const current = Math.max(1, Math.min(totalPages, page));
    return { items: items.slice((current - 1) * 12, current * 12), page: current, totalPages, snapshotAt, validUntil };
  }

  window.LocalRadarData = { load, loadNews, stamp };
})();
