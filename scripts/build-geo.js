const fs = require('fs');
const path = require('path');
const polygonClipping = require('polygon-clipping');

const DATA = path.join(__dirname, '..', 'data');
const PROVINCES = [
  { adcode: 440000, name: '广东', full: '广东省' },
  { adcode: 430000, name: '湖南', full: '湖南省' },
  { adcode: 450000, name: '广西', full: '广西壮族自治区' },
  { adcode: 360000, name: '江西', full: '江西省' },
  { adcode: 350000, name: '福建', full: '福建省' },
];

const readJSON = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

function shortName(name) {
  if (name.endsWith('自治州')) {
    const m = name.match(/^(.+?)(土家族|苗族|壮族|侗族|瑶族|白族|彝族)/);
    if (m) return m[1];
  }
  return name.replace(/(市|地区|盟|特别行政区)$/, '');
}

// Douglas-Peucker
function sqSegDist(p, a, b) {
  let x = a[0], y = a[1];
  let dx = b[0] - x, dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; }
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p[0] - x; dy = p[1] - y;
  return dx * dx + dy * dy;
}
function rdp(points, tolSq) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = first + 1; i < last; i++) {
      const d = sqSegDist(points[i], points[first], points[last]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tolSq && idx > 0) {
      keep[idx] = 1;
      stack.push([first, idx], [idx, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(a) / 2;
}
function simplifyRing(ring, tol, minArea) {
  if (ringArea(ring) < minArea) return null;
  const out = rdp(ring, tol * tol);
  if (out.length < 4) return null;
  const first = out[0], last = out[out.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) out.push(first);
  return out.map(([x, y]) => [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000]);
}
function simplifyGeometry(geom, tol, minArea) {
  if (geom.type === 'Polygon') {
    const rings = geom.coordinates.map((r) => simplifyRing(r, tol, minArea)).filter(Boolean);
    return rings.length ? { type: 'Polygon', coordinates: rings } : null;
  }
  if (geom.type === 'MultiPolygon') {
    const polys = geom.coordinates
      .map((poly) => poly.map((r) => simplifyRing(r, tol, minArea)).filter(Boolean))
      .filter((p) => p.length);
    return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null;
  }
  return null;
}

function buildProvinceClip(file) {
  const polygons = [];
  for (const feature of readJSON(file).features) {
    const geometry = simplifyGeometry(feature.geometry, 0.01, 0.0002);
    if (!geometry) continue;
    if (geometry.type === 'Polygon') polygons.push(geometry.coordinates);
    else polygons.push(...geometry.coordinates);
  }
  return polygons.length ? polygons : null;
}

// Clip city fills to the exact displayed province outline so no color can spill
// into the sea or neighbouring provinces at high zoom.
function clipGeometryToProvince(geometry, clip) {
  if (!clip) return null;
  try {
    const clipped = polygonClipping.intersection(geometry.coordinates, clip);
    if (!clipped || !clipped.length) return null;
    const cleaned = polygonClipping.union(clipped);
    if (!cleaned || !cleaned.length) return null;
    return simplifyGeometry({ type: 'MultiPolygon', coordinates: cleaned }, 0.001, 0.005);
  } catch (e) {
    return null;
  }
}

const cityFeatures = [];
const provincesMeta = [];
const bbox = [Infinity, Infinity, -Infinity, -Infinity];

for (const p of PROVINCES) {
  const g = readJSON(`prov_${p.adcode}.json`);
  const provinceClip = buildProvinceClip(`border_${p.adcode}.json`);
  const cities = [];
  for (const f of g.features) {
    const props = f.properties;
    if (!props || !props.center) continue;
    const simplified = simplifyGeometry(f.geometry, 0.02, 0.0008);
    const geom = simplified && clipGeometryToProvince(simplified, provinceClip);
    if (!geom) continue;
    const sn = shortName(props.name);
    cityFeatures.push({
      type: 'Feature',
      properties: {
        name: props.name,
        short: sn,
        adcode: props.adcode,
        province: p.name,
        provinceAdcode: p.adcode,
        center: props.center.map((v) => Math.round(v * 10000) / 10000),
        level: 'city',
      },
      geometry: geom,
    });
    cities.push({
      name: props.name,
      short: sn,
      adcode: props.adcode,
      center: props.center.map((v) => Math.round(v * 10000) / 10000),
    });
    for (const poly of (geom.type==="Polygon"?[geom.coordinates]:geom.coordinates)) for (const ring of poly) for (const pt of ring) { bbox[0]=Math.min(bbox[0],pt[0]); bbox[1]=Math.min(bbox[1],pt[1]); bbox[2]=Math.max(bbox[2],pt[0]); bbox[3]=Math.max(bbox[3],pt[1]); }
    
    
    
  }
  provincesMeta.push({
    adcode: p.adcode,
    name: p.name,
    full: p.full,
    cities: cities.sort((a, b) => a.adcode - b.adcode),
  });
}

// Neighbour provinces as muted backdrop
const china = readJSON('china_light.json');
const ours = new Set(PROVINCES.map((p) => p.adcode));
const neighbourFeatures = [];
for (const f of china.features) {
  if (ours.has(f.properties.adcode)) continue;
  const geom = simplifyGeometry(f.geometry, 0.02, 0.002);
  if (!geom) continue;
  neighbourFeatures.push({
    type: 'Feature',
    properties: {
      name: `邻-${f.properties.name}`,
      short: '',
      adcode: f.properties.adcode,
      level: 'neighbour',
      center: f.properties.center || f.properties.centroid || [0, 0],
    },
    geometry: geom,
  });
}

// Province outlines for emphasis
const borders = [];
for (const p of PROVINCES) {
  const g = readJSON(`border_${p.adcode}.json`);
  const rings = [];
  for (const f of g.features) {
    const geom = simplifyGeometry(f.geometry, 0.01, 0.0002);
    if (!geom) continue;
    const coords = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat();
    coords.forEach((r) => rings.push(r));
  }
  borders.push({ adcode: p.adcode, name: p.name, rings });
}

const out = `window.MAP_DATA = ${JSON.stringify({
  cities: { type: 'FeatureCollection', features: cityFeatures },
  neighbours: { type: 'FeatureCollection', features: neighbourFeatures },
  provinces: provincesMeta,
  borders,
  bbox: [Math.round(bbox[0] * 100) / 100, Math.round(bbox[1] * 100) / 100, Math.round(bbox[2] * 100) / 100, Math.round(bbox[3] * 100) / 100],
})};\n`;
fs.writeFileSync(path.join(DATA, 'mapdata.js'), out);

const kb = (n) => `${(n / 1024).toFixed(0)}KB`;
console.log('cities:', cityFeatures.length, 'neighbours:', neighbourFeatures.length);
console.log('mapdata.js', kb(Buffer.byteLength(out)));
console.log('bbox', JSON.stringify(bbox.map((v) => Math.round(v * 100) / 100)));
console.log('province cities:', provincesMeta.map((p) => `${p.name}:${p.cities.length}`).join(' '));
