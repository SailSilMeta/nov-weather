const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const HK_RSS = 'https://rss.weather.gov.hk/rss/WeatherWarningSummaryv2_uc.xml';
const HK_JSON = 'https://www.hko.gov.hk/wxinfo/dailywx/wxwarntoday_uc.json';
const HK_ICON_BASE = 'https://www.hko.gov.hk/tc/wxinfo/dailywx/images/';
const HK_PAGE = 'https://www.hko.gov.hk/sc/wxinfo/dailywx/wxwarntoday.htm';
const MO_PAGE_SC = 'https://www.dsmg.gov.mo/zh-hans/zawarning';
const MO_PAGE_TC = 'https://www.dsmg.gov.mo/zh-hant/zawarning';

const T2S = {
  號: '号', 風: '风', 黃: '黄', 紅: '红', 熱: '热', 帶: '带', 氣: '气', 強: '强', 報: '报',
  別: '别', 凍: '冻', 傾: '倾', 瀉: '泻', 災: '灾', 險: '险', 嘯: '啸', 廣: '广', 東: '东',
  備: '备', 颶: '飓', 陸: '陆', 門: '门', 邊: '边', 灣: '湾', 島: '岛', 預: '预', 現: '现',
  時: '时', 無: '无', 訊: '讯', 稱: '称', 轉: '转', 懸: '悬', 掛: '挂', 級: '级', 區: '区',
};

function toSimplified(text) {
  return String(text || '').replace(/[號風黃紅熱帶氣強報別凍傾瀉災險嘯廣東備颶陸門邊灣島預現時無訊稱轉懸掛級區]/g, (c) => T2S[c] || c);
}

function toneOf(name) {
  if (/十号飓风/.test(name)) return '#991b1b';
  if (/九号/.test(name)) return '#b91c1c';
  if (/八号/.test(name)) return '#ea580c';
  if (/黑色/.test(name)) return '#1f2937';
  if (/红色/.test(name)) return '#dc2626';
  if (/橙色/.test(name)) return '#ea580c';
  if (/三号|黄色/.test(name)) return '#eab308';
  if (/一号|蓝色/.test(name)) return '#3b82f6';
  if (/雷暴|闪电/.test(name)) return '#6a5f9e';
  if (/寒冷/.test(name)) return '#2563eb';
  if (/酷热/.test(name)) return '#c56a23';
  if (/霜冻/.test(name)) return '#6a9db5';
  if (/山泥倾泻|泥石流/.test(name)) return '#8a5a3a';
  if (/火灾/.test(name)) return '#b5472b';
  if (/季候风/.test(name)) return '#5f8b9e';
  if (/水浸|风暴潮/.test(name)) return '#2f6fa8';
  if (/海啸/.test(name)) return '#0f766e';
  return '#64748b';
}

function rankOf(name) {
  if (/十号飓风/.test(name)) return 90;
  if (/九号/.test(name)) return 80;
  if (/八号/.test(name)) return 70;
  if (/黑色/.test(name)) return 60;
  if (/红色/.test(name)) return 50;
  if (/橙色/.test(name)) return 45;
  if (/三号|黄色/.test(name)) return 40;
  if (/一号|蓝色/.test(name)) return 30;
  return 20;
}

function hhmm(ms) {
  if (!ms) return '';
  const iso = new Date(ms + 8 * 3600e3).toISOString();
  return iso.slice(11, 16);
}

function clockOfText(text) {
  const m = String(text || '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}

async function fetchText(url, referer) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: referer || url, Accept: '*/*' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${url} ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function cdata(block, tag) {
  const re = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`);
  const m = re.exec(block);
  if (m) return m[1].trim();
  const plain = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block);
  return plain ? plain[1].trim() : '';
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchHk() {
  try {
    const text = await fetchText(HK_JSON, 'https://www.hko.gov.hk/');
    const data = JSON.parse(text);
    if (data && Array.isArray(data.WARNING_DATABASE)) return parseHkJson(data);
  } catch (e) {
    /* fall back to RSS */
  }
  const xml = await fetchText(HK_RSS, 'https://www.hko.gov.hk/');
  return parseHkRss(xml);
}

function parseHkTime(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]) - 8, Number(m[5]), Number(m[6] || 0));
  const c = String(value || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (c) return Date.UTC(Number(c[1]), Number(c[2]) - 1, Number(c[3]), Number(c[4]) - 8, Number(c[5]));
  return 0;
}

function parseHkJson(data) {
  const now = Date.now();
  const items = [];
  for (const row of data.WARNING_DATABASE || []) {
    const name = toSimplified(String((row && row.WarningName) || '').trim());
    if (!name) continue;
    const expire = parseHkTime(row.ExpireTime);
    if (expire && expire < now) continue;
    const iconFile = String((row && row.Icon) || '').split('/').pop();
    const ts = parseHkTime(row.IssueTime);
    items.push({
      name,
      clock: hhmm(ts),
      ts,
      tone: toneOf(name),
      rank: rankOf(name),
      icon: /^[A-Za-z0-9_.-]+\.gif$/i.test(iconFile) ? `${HK_ICON_BASE}${iconFile}` : '',
    });
  }
  items.sort((a, b) => b.rank - a.rank || b.ts - a.ts);
  return {
    key: 'hk',
    name: '香港',
    source: '香港天文台',
    url: HK_PAGE,
    updatedAt: items.length ? items[0].clock : '',
    items,
  };
}

function parseHkRss(xml) {
  const channel = (/<channel>([\s\S]*?)<\/channel>/.exec(xml) || [])[1] || xml;
  const blocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  const items = [];
  blocks.forEach((block) => {
    const rawTitle = cdata(block, 'title');
    if (!rawTitle || /現時並無警告生效|现时并无警告生效|no warning/i.test(rawTitle)) return;
    const name = toSimplified(rawTitle).replace(/\s*[（(]\s*\d{2}:\d{2}[\s\S]*$/, '').trim();
    if (!name) return;
    const ts = Date.parse(cdata(block, 'pubDate')) || 0;
    items.push({
      name,
      clock: hhmm(ts),
      ts,
      tone: toneOf(name),
      rank: rankOf(name),
      icon: '',
    });
  });
  items.sort((a, b) => b.rank - a.rank || b.ts - a.ts);
  return {
    key: 'hk',
    name: '香港',
    source: '香港天文台',
    url: HK_PAGE,
    updatedAt: items.length ? items[0].clock : '',
    items,
  };
}

async function fetchMo() {
  let html = '';
  try {
    html = await fetchText(MO_PAGE_SC, 'https://www.dsmg.gov.mo/');
  } catch (e) {
    html = await fetchText(MO_PAGE_TC, 'https://www.dsmg.gov.mo/');
  }
  return parseMoPage(html);
}

function parseMoPage(html) {
  const sections = html.split('class="container__section"').slice(1);
  const section = sections.find((part) => /澳[门門]/.test(part.slice(0, 400)));
  if (!section) throw new Error('mo section');
  const updatedRaw = (/footer__updateTime[^>]*>([\s\S]*?)<\/p>/.exec(section) || [])[1] || '';
  const updatedAt = clockOfText(stripHtml(updatedRaw));
  const noDetail = /contentList__item -no-detail">([\s\S]*?)<\/div>/.exec(section);
  const items = [];
  if (!noDetail) {
    const re = /(<div class="contentList__item[^"]*">[\s\S]*?)<span>([\s\S]*?)<\/span>\s*<\/div>/g;
    let m;
    while ((m = re.exec(section))) {
      const name = toSimplified(stripHtml(m[2]));
      if (!name) continue;
      const src = /<img[^>]+src="([^"]+)"/i.exec(m[1]);
      let icon = src ? src[1].trim() : '';
      if (icon.startsWith('/')) icon = `https://www.dsmg.gov.mo${icon}`;
      if (!/^https:\/\/(cdn|www)\.dsmg\.gov\.mo\//i.test(icon)) icon = '';
      items.push({ name, clock: '', ts: 0, tone: toneOf(name), rank: rankOf(name), icon });
    }
  } else {
    const text = stripHtml(noDetail[1]);
    if (text && !/没有预警|沒有預警|暂无|no warning/i.test(text)) {
      const name = toSimplified(text);
      items.push({ name, clock: '', ts: 0, tone: toneOf(name), rank: rankOf(name), icon: '' });
    }
  }
  items.sort((a, b) => b.rank - a.rank);
  return {
    key: 'mo',
    name: '澳门',
    source: '澳门地球物理气象局',
    url: MO_PAGE_TC,
    updatedAt,
    items,
  };
}

let cache = null;
let pending = null;
const TTL = 5 * 60e3;

function mockWarnings() {
  const now = Date.now();
  const item = (name, mins, rank, icon) => ({
    name,
    rank,
    tone: toneOf(name),
    icon,
    ts: now - mins * 60e3,
    clock: hhmm(now - mins * 60e3),
  });
  const hkItems = [
    item('八号东北烈风或暴风信号', 12, 70, `${HK_ICON_BASE}tc8ne.gif`),
    item('黑色暴雨警告信号', 40, 60, `${HK_ICON_BASE}rainb.gif`),
    item('雷暴警告', 75, 20, `${HK_ICON_BASE}ts.gif`),
    item('寒冷天气警告', 150, 20, `${HK_ICON_BASE}cold.gif`),
  ];
  const moItems = [
    item('八号东北风球', 20, 70, ''),
    item('黑色暴雨警告信号', 55, 60, ''),
    item('雷暴警告', 90, 20, ''),
  ];
  return {
    mock: true,
    fetchedAt: new Date().toISOString(),
    regions: [
      { key: 'hk', name: '香港', source: '香港天文台', url: HK_PAGE, updatedAt: hkItems[0].clock, items: hkItems },
      { key: 'mo', name: '澳门', source: '澳门地球物理气象局', url: MO_PAGE_TC, updatedAt: hhmm(now), items: moItems },
    ],
  };
}

function failed(key, name, source, url) {
  return { key, name, source, url, updatedAt: '', items: [], error: true };
}

async function getWarnings(force = false) {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.result;
  if (pending) return pending;
  pending = Promise.allSettled([fetchHk(), fetchMo()])
    .then(([hk, mo]) => {
      const result = {
        fetchedAt: new Date().toISOString(),
        regions: [
          hk.status === 'fulfilled' ? hk.value : failed('hk', '香港', '香港天文台', HK_PAGE),
          mo.status === 'fulfilled' ? mo.value : failed('mo', '澳门', '澳门地球物理气象局', MO_PAGE_TC),
        ],
      };
      cache = { at: Date.now(), result };
      return result;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

module.exports = { HK_RSS, HK_JSON, HK_PAGE, MO_PAGE_SC, MO_PAGE_TC, toSimplified, toneOf, rankOf, parseHkJson, parseHkRss, parseMoPage, getWarnings, mockWarnings };
