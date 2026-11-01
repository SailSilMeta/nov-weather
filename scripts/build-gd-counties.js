const fs = require('fs');
const path = require('path');

const BASE = 'https://geo.datav.aliyun.com/areas_v3/bound';
const CITY_ADCODES = [
  440100, 440200, 440300, 440400, 440500, 440600, 440700, 440800, 440900,
  441200, 441300, 441400, 441500, 441600, 441700, 441800, 441900, 442000,
  445100, 445200, 445300,
];
const OUT = path.join(__dirname, '..', 'data', 'gd-counties.js');

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

function roundRing(ring, digits) {
  const step = 10 ** digits;
  return ring.map(([x, y]) => [Math.round(x * step) / step, Math.round(y * step) / step]);
}

function compactGeometry(geom, digits) {
  if (!geom) return null;
  if (geom.type === 'Polygon') return { type: 'Polygon', coordinates: geom.coordinates.map((ring) => roundRing(ring, digits)) };
  if (geom.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: geom.coordinates.map((poly) => poly.map((ring) => roundRing(ring, digits))) };
  return null;
}

(async () => {
  const province = await getJson(`${BASE}/440000_full.json`);
  const cities = new Map(province.features.map((f) => [Number(f.properties.adcode), f]));
  const out = [];

  for (const adcode of CITY_ADCODES) {
    const city = cities.get(adcode);
    if (!city) {
      console.warn('city missing', adcode);
      continue;
    }
    let counties = [];
    try {
      const json = await getJson(`${BASE}/${adcode}_full.json`);
      counties = (json.features || []).filter((f) => f.properties.level === 'district' && f.geometry);
    } catch (e) {
      console.warn('county fail', adcode, e.message);
    }
    if (!counties.length) {
      counties = [{
        type: 'Feature',
        properties: { adcode, name: city.properties.name, level: 'city' },
        geometry: city.geometry,
      }];
    }
    for (const f of counties) {
      const p = f.properties;
      out.push({
        type: 'Feature',
        properties: {
          adcode: String(p.adcode),
          name: p.name,
          city: city.properties.name,
          cityAdcode: String(adcode),
          provinceAdcode: '440000',
        },
        geometry: f.geometry.type === 'GeometryCollection'
          ? (f.geometry.geometries.find((g) => g.type === 'Polygon' || g.type === 'MultiPolygon') || { type: 'Polygon', coordinates: [] })
          : f.geometry,
      });
    }
    console.log(adcode, city.properties.name, counties.length);
    await new Promise((r) => setTimeout(r, 120));
  }

  const digits = 5;
  const features = out.map((f) => ({
    type: 'Feature',
    properties: f.properties,
    geometry: compactGeometry(f.geometry, digits),
  })).filter((f) => f.geometry);

  const payload = `window.GD_COUNTIES = ${JSON.stringify({ type: 'FeatureCollection', features })};\n`;
  fs.writeFileSync(OUT, payload);
  console.log('counties', features.length, 'bytes', Buffer.byteLength(payload));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
