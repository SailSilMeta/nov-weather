const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');

const SOURCE = '浙江省水利厅';
const OUT = path.join(__dirname, '..', 'data', 'typhoons.json');

function beijingYear() {
  return new Date(Date.now() + 8 * 3600e3).getUTCFullYear();
}

function validYear(value) {
  return /^\d{4}$/.test(String(value)) && Number(value) >= 1949 && Number(value) <= beijingYear();
}

function validId(value) {
  const id = String(value);
  return /^(?:\d{6}|\d{8})$/.test(id) && validYear(id.slice(0, 4));
}

function validKey(kind, key) {
  return kind === 'list' ? validYear(key) : kind === 'detail' && validId(key);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Official timestamps without an offset are Beijing time; never rewrite the source fields.
function typhoonTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) return NaN;
  const iso = value.replace(' ', 'T');
  return Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(iso) ? iso : `${iso}+08:00`);
}

function validStorm(storm) {
  return isObject(storm) && validId(storm.tfid) && typeof storm.name === 'string'
    && ['0', '1', 0, 1].includes(storm.isactive)
    && Number.isFinite(typhoonTime(storm.starttime))
    && (Number.isFinite(typhoonTime(storm.endtime))
      || (String(storm.isactive) === '1' && (storm.endtime == null || storm.endtime === '')));
}

function validCoordinate(value, min, max) {
  return (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
    && Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max;
}

function validPoint(point) {
  return isObject(point) && Number.isFinite(typhoonTime(point.time))
    && validCoordinate(point.lng, -180, 180) && validCoordinate(point.lat, -90, 90);
}

function validData(kind, key, data) {
  if (!validKey(kind, key)) return false;
  if (kind === 'list') {
    return Array.isArray(data)
      && data.every((storm) => validStorm(storm) && String(storm.tfid).slice(0, 4) === String(key))
      && new Set(data.map((storm) => String(storm.tfid))).size === data.length;
  }
  return validStorm(data) && String(data.tfid) === String(key) && Array.isArray(data.points)
    && data.points.every((point) => validPoint(point)
      && (point.forecast == null || (Array.isArray(point.forecast) && point.forecast.every((forecast) =>
        isObject(forecast) && typeof forecast.tm === 'string'
        && Array.isArray(forecast.forecastpoints) && forecast.forecastpoints.every(validPoint)))));
}

async function fetchTyphoon(kind, key) {
  if (!validKey(kind, key)) throw new Error('非法台风年份或编号');
  const endpoint = kind === 'list' ? 'TyphoonList' : 'TyphoonInfo';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const response = await fetch(`https://typhoon.slt.zj.gov.cn/Api/${endpoint}/${key}`, {
      signal: ctrl.signal,
      redirect: 'error',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`台风上游 HTTP ${response.status}`);
    const data = await response.json();
    if (!validData(kind, key, data)) throw new Error('台风上游数据结构不符');
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// A failed fetch/write must leave the previous valid file untouched.
async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}

function selectStorms(list) {
  const active = list.filter((storm) => String(storm.isactive) === '1');
  const ended = list.filter((storm) => String(storm.isactive) === '0')
    .sort((a, b) => typhoonTime(b.endtime) - typhoonTime(a.endtime)
      || String(b.tfid).localeCompare(String(a.tfid)))
    .slice(0, 3);
  return [...active, ...ended];
}

function trimForecasts(detail) {
  return {
    ...detail,
    points: detail.points.map((point, index) => {
      if (index === detail.points.length - 1) return point;
      const copy = { ...point };
      delete copy.forecast;
      return copy;
    }),
  };
}

async function main(args = process.argv.slice(2)) {
  if (args.length > 1 || (args.length === 1 && !validYear(args[0]))) {
    throw new Error(`年份须为 1949 至北京时间 ${beijingYear()} 年内的四位数字（仅接受一个年份参数）`);
  }
  const year = args.length ? Number(args[0]) : beijingYear();
  const list = await fetchTyphoon('list', year);
  const selected = selectStorms(list);
  const details = new Array(selected.length);
  let cursor = 0;
  async function worker() {
    while (cursor < selected.length) {
      const index = cursor++;
      const id = String(selected[index].tfid);
      details[index] = [id, trimForecasts(await fetchTyphoon('detail', id))];
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, selected.length) }, worker));
  const snapshot = { source: SOURCE, fetchedAt: new Date().toISOString(), year, list, storms: Object.fromEntries(details) };
  await writeJsonAtomic(OUT, snapshot);
  console.log(`台风快照：${year} 年，列表 ${list.length} 条，详情 ${details.length} 个（活跃 ${selected.filter((storm) => String(storm.isactive) === '1').length} 个）`);
}

module.exports = { SOURCE, beijingYear, validYear, validId, validKey, validData, fetchTyphoon, writeJsonAtomic };

if (require.main === module) {
  main().catch((err) => {
    console.error(`台风快照未更新：${err.message}`);
    process.exitCode = 1;
  });
}
