const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DATA = path.join(__dirname, '..', 'data');
const PROVINCE_CODES = { 广东: 'AGD', 广西: 'AGX', 福建: 'AFJ', 江西: 'AJX', 湖南: 'AHN' };
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Referer: 'http://www.nmc.cn/',
};

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(DATA, 'mapdata.js'), 'utf8'), sandbox);
const { provinces } = sandbox.window.MAP_DATA;

const norm = (s) => String(s || '').replace(/(市|地区|盟|特别行政区|自治区|自治州)$/, '').trim();

const get = async (url, tries = 3) => {
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
};

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (idx < items.length) {
        const i = idx++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

const valid = (v) => typeof v === 'number' && v > -999 && v !== 9999;
const num = (v) => (valid(v) ? v : null);

function parseWeather(j, station) {
  const d = j.data || {};
  const real = d.real || {};
  const w = real.weather || {};
  const wind = real.wind || {};
  const predict = (d.predict && d.predict.detail) || [];
  const today = predict[0] || {};
  const passed = (d.passedchart || [])
    .filter((p) => p && p.time)
    .slice(0, 24)
    .reverse()
    .map((p) => ({
      time: p.time.slice(11, 16),
      t: valid(p.temperature) ? p.temperature : null,
      rain: valid(p.rain1h) ? p.rain1h : null,
      wind: valid(p.windSpeed) ? p.windSpeed : null,
    }));
  const air = d.air || {};
  const rawPassed = (d.passedchart && d.passedchart[0]) || {};
  const sun = real.sunriseSunset || {};
  const warn = real.warn || {};
  const alert = warn.alert && warn.alert !== '9999' ? { title: warn.alert, level: warn.signallevel, type: warn.signaltype } : null;
  return {
    station: station.code,
    stationName: station.city,
    pub: real.publish_time || '',
    t: valid(w.temperature) ? w.temperature : null,
    feels: valid(w.feelst) ? w.feelst : null,
    rh: valid(w.humidity) ? w.humidity : null,
    rainNow: valid(w.rain) ? w.rain : null,
    info: w.info && w.info !== '9999' ? w.info : '',
    img: w.img || '',
    windSpeed: valid(wind.speed) ? wind.speed : null,
    windDir: wind.direct && wind.direct !== '9999' ? wind.direct : '',
    windPower: wind.power && wind.power !== '9999' ? wind.power : '',
    aqi: valid(air.aqi) ? air.aqi : null,
    aqiText: air.text && air.text !== '9999' ? air.text : '',
    pressure: num(rawPassed.pressure) != null ? num(rawPassed.pressure) : num(weather.airpressure),
    sunrise: sun.sunrise && sun.sunrise !== '9999' ? sun.sunrise : '',
    sunset: sun.sunset && sun.sunset !== '9999' ? sun.sunset : '',
    tmax: today.day && today.day.weather ? Number(today.day.weather.temperature) || null : null,
    tmin: today.night && today.night.weather ? Number(today.night.weather.temperature) || null : null,
    precipToday: valid(today.precipitation) ? today.precipitation : 0,
    hourly: passed,
    alert,
    forecastPub: (d.predict && d.predict.publish_time) || "",
    forecast: predict.slice(0, 7).map((p) => ({
      date: p.date,
      dayText: p.day && p.day.weather ? p.day.weather.info : '',
      nightText: p.night && p.night.weather ? p.night.weather.info : '',
      dayImg: (p.day && p.day.weather && p.day.weather.img) || '',
      nightImg: (p.night && p.night.weather && p.night.weather.img) || '',
      tmax: p.day && p.day.weather ? Number(p.day.weather.temperature) : null,
      tmin: p.night && p.night.weather ? Number(p.night.weather.temperature) : null,
    })),
  };
}

(async () => {
  const stationsByProvince = {};
  for (const [name, code] of Object.entries(PROVINCE_CODES)) {
    const file = path.join(DATA, `stations_${code}.json`);
    stationsByProvince[name] = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, 'utf8'))
      : await get(`http://www.nmc.cn/rest/province/${code}`);
  }

  const assignments = [];
  const missing = [];
  for (const p of provinces) {
    const list = stationsByProvince[p.name] || [];
    for (const c of p.cities) {
      const short = c.short;
      const exact = list.filter((s) => norm(s.city) === short);
      const chosen =
        exact.find((s) => s.city === short) ||
        exact.find((s) => s.city === `${short}市`) ||
        exact[0] ||
        list.find((s) => norm(s.city).startsWith(short) || short.startsWith(norm(s.city)));
      if (!chosen) {
        missing.push(`${p.name}/${c.name}`);
        continue;
      }
      assignments.push({ province: p.name, city: c, station: chosen });
    }
  }
  if (missing.length) console.log('missing stations:', missing);
  console.log(`matched ${assignments.length}/${assignments.length + missing.length} cities`);

  let done = 0;
  const results = await pool(assignments, 5, async (a) => {
    try {
      const j = await get(`http://www.nmc.cn/rest/weather?stationid=${a.station.code}`);
      done++;
      if (done % 15 === 0) process.stdout.write(`  fetched ${done}\n`);
      if (!j.data) return null;
      return { adcode: a.city.adcode, data: parseWeather(j, a.station) };
    } catch (e) {
      console.error(`fail ${a.city.name}: ${e.message}`);
      return null;
    }
  });

  const cities = {};
  let fetchedAt = '';
  let failed = 0;
  for (const r of results) {
    if (!r) { failed++; continue; }
    cities[r.adcode] = r.data;
    if (r.data.pub > fetchedAt) fetchedAt = r.data.pub;
  }

  const payload = { source: 'nmc', fetchedAt: fetchedAt.replace(' ', 'T'), cities };
  fs.writeFileSync(path.join(DATA, 'snapshot.js'), `window.WEATHER_SNAPSHOT = ${JSON.stringify(payload)};\n`);

  const temps = Object.values(cities).map((c) => c.t).filter((v) => v != null);
  console.log(`\nsnapshot: ${Object.keys(cities).length} cities, failed ${failed}, pub ${fetchedAt}`);
  console.log(`temp ${Math.min(...temps)} ~ ${Math.max(...temps)}°C, ${(fs.statSync(path.join(DATA, 'snapshot.js')).size / 1024).toFixed(0)}KB`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
