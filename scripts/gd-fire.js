const { writeJsonAtomic } = require('./fetch-typhoons');

const SOURCE = '广东省气象局';
const BASE = 'https://wxc.gd121.cn/gdecloud/servlet/servletcityweatherall4';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const CITIES = [
  [440100, '广州市'], [440200, '韶关市'], [440300, '深圳市'], [440400, '珠海市'], [440500, '汕头市'],
  [440600, '佛山市'], [440700, '江门市'], [440800, '湛江市'], [440900, '茂名市'], [441200, '肇庆市'],
  [441300, '惠州市'], [441400, '梅州市'], [441500, '汕尾市'], [441600, '河源市'], [441700, '阳江市'],
  [441800, '清远市'], [441900, '东莞市'], [442000, '中山市'], [445100, '潮州市'], [445200, '揭阳市'],
  [445300, '云浮市'],
];

async function fetchCity(code) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(`${BASE}?DISTRICTCODE=${code}&FROM=binfen`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Referer: 'https://wxc.gd121.cn/', Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return (Array.isArray(json.rows) ? json.rows : []).flatMap((row) => (Array.isArray(row.yjrows) ? row.yjrows : []));
  } finally {
    clearTimeout(timer);
  }
}

function normalize(row, cityName) {
  if (!row || typeof row !== 'object') return null;
  const title = String(row.yjtitle || '').trim();
  const category = String(row.category_cnname || '');
  if (!title || (!category.includes('森林火险') && !title.includes('森林火险') && !title.includes('火险'))) return null;
  const id = String(row.indentifier || row.identifier || '').trim();
  if (!id) return null;
  const district = String(row.SUBAREANAME || '').trim();
  const place = district && district !== cityName ? `${cityName} · ${district}` : cityName;
  return {
    id: `gd-${id}`,
    title,
    place,
    province: '广东省',
    city: cityName,
    district,
    level: String(row.yjseverity_cnname || '').trim(),
    publishdate: String(row.publishdate || '').trim(),
    content: String(row.content || '').trim(),
    sender: String(row.sender_cnname || '').trim(),
    url: String(row.yjurl || 'https://www.gd121.cn/').trim(),
    icon: String(row.yjicon || '').trim(),
  };
}

async function fetchGdFire() {
  const alerts = [];
  let cursor = 0;
  let ok = 0;
  async function worker() {
    while (cursor < CITIES.length) {
      const [code, cityName] = CITIES[cursor++];
      try {
        const rows = await fetchCity(code);
        ok++;
        for (const row of rows) {
          const item = normalize(row, cityName);
          if (item) alerts.push(item);
        }
      } catch (e) {
        /* A failed city leaves the other cities usable. */
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  if (!ok) throw new Error('广东森林火险接口不可用');
  const unique = new Map();
  for (const item of alerts) {
    const prev = unique.get(item.id);
    if (!prev || String(item.publishdate) > String(prev.publishdate)) unique.set(item.id, item);
  }
  const list = [...unique.values()].sort((a, b) => String(b.publishdate).localeCompare(String(a.publishdate)));
  return {
    source: SOURCE,
    fetchedAt: new Date().toISOString(),
    citiesOk: ok,
    citiesTotal: CITIES.length,
    partial: ok < CITIES.length,
    count: list.length,
    alerts: list,
  };
}

module.exports = { SOURCE, BASE, CITIES, fetchGdFire, writeJsonAtomic };
