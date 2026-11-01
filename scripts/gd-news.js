const BASE = 'https://www.gd121.cn';
const SOURCE = 'https://www.gd121.cn/zx/qxzx/list.shtml';
const PAGE_COUNT = 10;
const PAGE_SIZE = 12;

function pageUrl(page) {
  return page <= 1 ? SOURCE : `https://www.gd121.cn/zx/qxzx/list_${page}.shtml`;
}

const NAMED = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  mdash: '—', ndash: '–', hellip: '…', middot: '·', times: '×',
};

function decode(text) {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, code) => {
      if (code[0] === '#') {
        const hex = code[1] === 'x' || code[1] === 'X';
        const value = hex ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(value) ? String.fromCodePoint(value) : all;
      }
      const key = code.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED, key) ? NAMED[key] : all;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function parse(html) {
  const anchor = html.indexOf('class="waringList"');
  const chunk = anchor >= 0 ? html.slice(anchor) : html;
  const items = [];
  const re = /<li>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<div class="list-time">([^<]+)<\/div>/g;
  let match;
  while ((match = re.exec(chunk))) {
    const title = decode(match[2]);
    const time = match[3].trim();
    if (!title || !/^\d{4}-\d{2}-\d{2}/.test(time)) continue;
    const href = /^https?:/i.test(match[1]) ? match[1] : BASE + match[1];
    if (!href.startsWith(`${BASE}/`)) continue;
    items.push({ title, time, url: href });
  }
  return items;
}

async function fetchNews(page) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(pageUrl(page), {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
        Referer: SOURCE,
      },
    });
    if (!res.ok) throw new Error(`gd121 ${res.status}`);
    const html = await res.text();
    const items = parse(html);
    if (!items.length) throw new Error('gd121 empty list');
    return items;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchIndex() {
  const pages = await Promise.all(Array.from({ length: PAGE_COUNT }, (_, i) => fetchNews(i + 1)));
  const seen = new Set();
  const items = [];
  for (const list of pages) {
    for (const item of list) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      items.push(item);
    }
  }
  if (!items.length) throw new Error('gd121 empty index');
  return items;
}

module.exports = { SOURCE, PAGE_COUNT, PAGE_SIZE, pageUrl, parse, fetchNews, fetchIndex };
