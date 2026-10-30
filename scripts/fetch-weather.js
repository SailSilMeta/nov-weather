const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'data', 'mapdata.js'), 'utf8'), sandbox);
const { provinces } = sandbox.window.MAP_DATA;

const cities = provinces.flatMap((p) => p.cities);
const lats = cities.map((c) => c.center[1].toFixed(4)).join(',');
const lons = cities.map((c) => c.center[0].toFixed(4)).join(',');

const url =
  'https://api.open-meteo.com/v1/forecast' +
  `?latitude=${lats}&longitude=${lons}` +
  '&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m' +
  '&daily=precipitation_sum,temperature_2m_max,temperature_2m_min' +
  '&past_days=1&forecast_days=1&timezone=Asia%2FShanghai&wind_speed_unit=ms';

const round = (v, d = 1) => (typeof v === 'number' ? Math.round(v * 10 ** d) / 10 ** d : null);

(async () => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const json = await res.json();
  const list = Array.isArray(json) ? json : [json];
  if (list.length !== cities.length) throw new Error(`expected ${cities.length} locations, got ${list.length}`);

  const out = {};
  let fetchedAt = null;
  cities.forEach((c, i) => {
    const r = list[i];
    const cur = r.current || {};
    fetchedAt = fetchedAt || cur.time;
    const daily = r.daily || {};
    out[c.adcode] = {
      t: round(cur.temperature_2m),
      feels: round(cur.apparent_temperature),
      rh: round(cur.relative_humidity_2m, 0),
      wind: round(cur.wind_speed_10m),
      dir: round(cur.wind_direction_10m, 0),
      code: cur.weather_code ?? 0,
      precipNow: round(cur.precipitation),
      precipToday: round(daily.precipitation_sum ? daily.precipitation_sum[1] : null),
      tmax: round(daily.temperature_2m_max ? daily.temperature_2m_max[1] : null),
      tmin: round(daily.temperature_2m_min ? daily.temperature_2m_min[1] : null),
    };
  });

  const payload = { fetchedAt, cities: out };
  fs.writeFileSync(
    path.join(__dirname, '..', 'data', 'snapshot.js'),
    `window.WEATHER_SNAPSHOT = ${JSON.stringify(payload)};\n`
  );
  const temps = Object.values(out).map((c) => c.t).filter((v) => v != null);
  console.log(`snapshot: ${Object.keys(out).length} cities @ ${fetchedAt}`);
  console.log(`temp ${Math.min(...temps)} ~ ${Math.max(...temps)}°C, file ${(fs.statSync(path.join(__dirname, '..', 'data', 'snapshot.js')).size / 1024).toFixed(0)}KB`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
