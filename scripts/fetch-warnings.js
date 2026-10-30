const fs = require('fs/promises');
const path = require('path');

const PROVINCES = ['广东省', '广西壮族自治区', '湖南省', '江西省', '福建省'];
const MAP_URL = 'https://forecast.weather.com.cn/api/v1/traffic/alarm/alarmMap';
const NMC_URL = 'https://www.nmc.cn/rest/findAlarm';
const OUT = path.join(__dirname, '..', 'data', 'warnings.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

function extractObject(html, marker) {
  const found = html.indexOf(marker);
  if (found < 0) return null;
  const start = html.indexOf('{', found);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch (e) {
          return null;
        }
      }
    }
  }
  return null;
}

async function fetchText(url, referer) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Referer: referer, Accept: '*/*' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function mapLimit(items, limit, work) {
  const result = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        result[index] = await work(items[index]);
      } catch (e) {
        result[index] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return result;
}

async function fetchNmc() {
  try {
    const firstText = await fetchText(`${NMC_URL}?pageNo=1&pageSize=100&_=${Date.now()}`, 'https://www.nmc.cn/publish/alarm.html');
    const first = JSON.parse(firstText).data.page;
    const total = Math.min(8, Number(first.totalPage) || 1);
    const rest = await mapLimit(Array.from({ length: Math.max(0, total - 1) }, (_, i) => i + 2), 3, (page) =>
      fetchText(`${NMC_URL}?pageNo=${page}&pageSize=100&_=${Date.now()}${page}`, 'https://www.nmc.cn/publish/alarm.html').then((t) => JSON.parse(t).data.page)
    );
    return [first, ...rest.filter(Boolean)].flatMap((page) => page.list || []);
  } catch (e) {
    console.error('NMC list unavailable:', e.message);
    return [];
  }
}

async function main() {
  const mapText = await fetchText(MAP_URL, 'https://www.weather.com.cn/alarm/');
  const map = JSON.parse(mapText);
  const rows = ((map.result && map.result.data) || []).filter((row) => PROVINCES.some((p) => String(row[0] || '').startsWith(p)));
  const cityCodes = Array.from(new Set(rows.map((row) => String(row[1] || '').split('-')[0]).filter((code) => /^\d{9}$/.test(code))));
  const cityData = await mapLimit(cityCodes, 5, async (code) => {
    const html = await fetchText(`https://d1.weather.com.cn/weather_index/${code}.html?_=${Date.now()}`, 'https://www.weather.com.cn/');
    return extractObject(html, 'alarmDZ');
  });
  const byCity = new Map(cityCodes.map((code, i) => [code, cityData[i]]));

  const merged = new Map();
  for (const row of rows) {
    const fileName = String(row[1] || '');
    const alertId = String(row[4] || '');
    const title = String(row[6] || '');
    const place = String(row[0] || '');
    const cityCode = fileName.split('-')[0];
    const cityWarnings = (byCity.get(cityCode) && byCity.get(cityCode).w) || [];
    const item = cityWarnings.find((w) => String(w.w16 || '') === alertId) || cityWarnings.find((w) => String(w.w13 || '') === title) || null;
    if (!alertId) continue;
    merged.set(alertId, {
      id: alertId,
      place,
      title,
      fileName,
      lon: Number(row[2]) || null,
      lat: Number(row[3]) || null,
      issuedAt: item ? String(item.w8 || '') : '',
      unit: item ? [item.w1, item.w2, item.w3].filter(Boolean).join('') : '',
      text: item ? String(item.w9 || '').trim() : '',
    });
  }
  const nmcRows = await fetchNmc();
  for (const row of nmcRows) {
    const title = String(row.title || '');
    const place = String(title.split('气象台')[0].split('发布')[0] || '').trim();
    if (!PROVINCES.some((p) => place.startsWith(p) || title.includes(p))) continue;
    const id = String(row.alertid || '');
    if (!id) continue;
    if (merged.has(id)) {
      const current = merged.get(id);
      if (!current.text) current.text = '';
      continue;
    }
    merged.set(id, {
      id,
      place,
      title,
      fileName: '',
      lon: null,
      lat: null,
      issuedAt: String(row.issuetime || ''),
      unit: '',
      text: '',
    });
  }
  const alerts = [...merged.values()].filter((a) => a.id && a.title).sort((a, b) => String(b.issuedAt).localeCompare(String(a.issuedAt)) || String(a.id).localeCompare(String(b.id)));
  const payload = {
    updatedAt: new Date().toISOString(),
    source: '国家预警信息发布中心 / 中国天气网',
    provinces: PROVINCES,
    count: alerts.length,
    alerts,
  };
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`warnings snapshot: ${alerts.length} alerts -> ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
