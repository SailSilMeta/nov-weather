const fs = require('fs');
const path = require('path');
const vm = require('vm');
const engine = require('../cold-air-engine');

const { buildState, prune, toKey } = engine;
const DATA = path.join(__dirname, '..', 'data');
const OUT = path.join(DATA, 'cold-air.js');
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Referer: 'http://www.nmc.cn/',
};

function loadPrev() {
  if (!fs.existsSync(OUT)) return {};
  try {
    const box = { window: {} };
    vm.runInNewContext(fs.readFileSync(OUT, 'utf8'), box);
    return box.window.COLD_AIR || {};
  } catch (e) {
    console.error('previous cold-air state unreadable:', e.message);
    return {};
  }
}

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (idx < items.length) {
        const i = idx++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

function cityList() {
  const box = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(DATA, 'mapdata.js'), 'utf8'), box);
  const prov = (box.window.MAP_DATA.provinces || []).find((p) => p.name === '广东');
  const stations = JSON.parse(fs.readFileSync(path.join(DATA, 'stations_AGD.json'), 'utf8'));
  const norm = (s) => String(s || '').replace(/(市|地区|盟)$/, '').trim();
  return prov.cities.map((city) => {
    const exact = stations.filter((s) => norm(s.city) === city.short);
    const station = exact.find((s) => s.city === city.short) || exact[0];
    return { ...city, station: station && station.code };
  }).filter((c) => c.station);
}

function parseSeries(j) {
  const passed = ((j.data && j.data.passedchart) || []).filter((p) => p && p.time).slice(0, 24);
  return passed.map((p) => ({
    t: toKey(p.time),
    temp: typeof p.temperature === 'number' && p.temperature > -999 && p.temperature !== 9999 ? p.temperature : null,
    dir: typeof p.windDirection === 'number' && p.windDirection >= 0 && p.windDirection <= 360 ? p.windDirection : null,
    spd: typeof p.windSpeed === 'number' && p.windSpeed >= 0 && p.windSpeed !== 9999 ? p.windSpeed : null,
    rain: typeof p.rain1h === 'number' && p.rain1h >= 0 ? p.rain1h : 0,
  }));
}

// rest/weather 的 real 就是地图顶部“实况 HH:MM”那份分钟级观测，城市卡同源显示
function parseReal(j) {
  const real = (j.data && j.data.real) || {};
  const weather = real.weather || {};
  const wind = real.wind || {};
  const num = (v) => (typeof v === 'number' && v > -999 && v !== 9999 ? v : null);
  const deg = num(wind.degree);
  return {
    pub: real.publish_time ? String(real.publish_time).trim() : '',
    temp: num(weather.temperature),
    rain: num(weather.rain),
    dir: deg != null && deg >= 0 && deg <= 360 ? deg : null,
    dirText: wind.direct && wind.direct !== '9999' ? wind.direct : '',
    power: wind.power && wind.power !== '9999' ? wind.power : '',
    spd: num(wind.speed),
  };
}

async function main() {
  const prev = loadPrev();
  const cities = cityList();
  if (!cities.length) throw new Error('no Guangdong cities with stations');

  let done = 0;
  const fetched = await pool(cities, 5, async (city) => {
    try {
      const j = await get(`http://www.nmc.cn/rest/weather?stationid=${city.station}`);
      done++;
      if (done % 7 === 0) process.stdout.write(`  fetched ${done}/${cities.length}\n`);
      return { adcode: city.adcode, series: parseSeries(j), real: parseReal(j) };
    } catch (e) {
      console.error(`fail ${city.short}: ${e.message}`);
      return null;
    }
  });

  const seriesByAdcode = {};
  for (const city of cities) {
    const fresh = fetched.find((f) => f && f.adcode === city.adcode);
    const map = new Map();
    const old = (prev.series && prev.series[city.adcode]) || [];
    for (const x of old) map.set(x.t, x);
    for (const x of (fresh && fresh.series) || []) map.set(x.t, x);
    seriesByAdcode[city.adcode] = prune([...map.values()].sort((a, b) => (a.t < b.t ? -1 : 1)));
  }

  const state = buildState(seriesByAdcode, prev);
  const live = {};
  let liveAt = '';
  for (const city of cities) {
    const f = fetched.find((x) => x && x.adcode === city.adcode);
    if (!f || !f.real || !f.real.pub) continue;
    live[city.adcode] = f.real;
    if (f.real.pub > liveAt) liveAt = f.real.pub;
  }
  // 站点号随快照下发，前端实时刷新时直接复用；live 为分钟级实况（整轮失败时沿用旧值）
  const payload = {
    ...state,
    stations: Object.fromEntries(cities.map((c) => [c.adcode, c.station])),
    live: liveAt ? live : prev.live || {},
    liveAt: liveAt || prev.liveAt || '',
  };
  const next = `window.COLD_AIR = ${JSON.stringify(payload)};\n`;
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (next === current) {
    console.log(`\ncold-air: unchanged (latest ${payload.updatedAt})`);
    return;
  }
  fs.writeFileSync(OUT, next);

  const ev = payload.event;
  console.log(`\ncold-air: ${cities.length} stations, latest ${payload.updatedAt}, gate ${payload.stats.gatePassed}/4, arrived ${payload.stats.arrived}`);
  console.log(`event ${ev.status}${ev.status === 'active' ? ` opened ${ev.openedAt} closes ${ev.closesAt}` : ''}, ${(fs.statSync(OUT).size / 1024).toFixed(0)}KB`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { ...engine, loadPrev };
