(function () {
  'use strict';

  const PROVINCES = ['广东省', '广西壮族自治区', '湖南省', '江西省', '福建省'];
  const PROVINCE_SHORT = { 广东省: '广东', 广西壮族自治区: '广西', 湖南省: '湖南', 江西省: '江西', 福建省: '福建' };
  const NMC_ALARM = 'https://www.nmc.cn/rest/findAlarm';
  const GD_FIRE_API = 'api/gd-fire';
  const GD_FIRE_SNAPSHOT = 'data/gd-fire.json';
  const GD_LEVELS = { 红色: 'red', 橙色: 'orange', 黄色: 'yellow', 蓝色: 'blue', 白色: 'white' };
  const PAGE_SIZE = 100;
  const MAX_PAGES = 8;
  const TYPE_DEFS = [
    { key: 'typhoon', name: '台风', aliases: ['台风'], tone: '#1f7896', icon: 'typhoon', scene: 'typhoon' },
    { key: 'rain', name: '暴雨', aliases: ['暴雨'], tone: '#2f6fa8', icon: 'rain', scene: 'rain' },
    { key: 'cold', name: '寒潮 / 寒冷', aliases: ['寒潮', '寒冷'], tone: '#5a86a8', icon: 'cold', scene: 'cold' },
    { key: 'wind', name: '大风 / 雷雨大风', aliases: ['海上雷雨大风', '雷雨大风', '海上大风', '大风'], tone: '#5f8b9e', icon: 'wind', scene: 'wind' },
    { key: 'heat', name: '高温', aliases: ['高温'], tone: '#c56a23', icon: 'heat', scene: 'heat' },
    { key: 'drought', name: '干旱', aliases: ['干旱'], tone: '#a67b3b', icon: 'drought', scene: 'drought' },
    { key: 'fire', name: '森林火险', aliases: ['森林草原火险', '森林火险', '草原火险', '火险'], tone: '#b5472b', icon: 'fire', scene: 'fire' },
    { key: 'lightning', name: '雷电', aliases: ['雷电'], tone: '#6a5f9e', icon: 'lightning', scene: 'lightning' },
    { key: 'hail', name: '冰雹', aliases: ['冰雹'], tone: '#5685a6', icon: 'hail', scene: 'hail' },
    { key: 'frost', name: '霜冻', aliases: ['霜冻'], tone: '#6a9db5', icon: 'frost', scene: 'frost' },
    { key: 'fog', name: '大雾', aliases: ['大雾'], tone: '#7a8f9a', icon: 'fog', scene: 'fog' },
    { key: 'haze', name: '霾 / 灰霾', aliases: ['灰霾', '霾'], tone: '#9a7c3c', icon: 'haze', scene: 'haze' },
    { key: 'ice', name: '道路结冰', aliases: ['道路结冰', '道路冰雪'], tone: '#4f88a4', icon: 'ice', scene: 'ice' },
    { key: 'other', name: '其他 / 地方信号', aliases: ['强对流', '低温', '地质灾害', '渍涝'], tone: '#8a5a3a', icon: 'fire', scene: 'fire' },
  ];
  const LEVELS = {
    white: { key: 'white', label: '白色', rank: 0, grade: '提示', color: '#e6f0f5' },
    blue: { key: 'blue', label: '蓝色', rank: 1, grade: 'Ⅳ级 / 一般', color: '#3b82f6' },
    yellow: { key: 'yellow', label: '黄色', rank: 2, grade: 'Ⅲ级 / 较重', color: '#eab308' },
    orange: { key: 'orange', label: '橙色', rank: 3, grade: 'Ⅱ级 / 严重', color: '#f97316' },
    red: { key: 'red', label: '红色', rank: 4, grade: 'Ⅰ级 / 特别严重', color: '#dc2626' },
  };
  const ALIASES = TYPE_DEFS.flatMap((def) => def.aliases.map((alias) => ({ alias, key: def.key }))).sort((a, b) => b.alias.length - a.alias.length);
  const GUIDE = {
    typhoon: ['停止露天、高空和海上危险作业', '加固门窗、广告牌和临时搭建物', '远离海边、河口和低洼易涝区域'],
    rain: ['避免涉水行走或驾车，地下空间及时转移', '检查排水口，防范山洪、滑坡和内涝', '暂停不必要的户外活动'],
    cold: ['注意防寒保暖，关注老人和儿童', '农业、水产和畜禽做好防冻措施', '安全使用取暖设备，防范一氧化碳中毒'],
    wind: ['远离广告牌、临时搭建物和高空坠物区', '停止高空和水上作业，关好门窗', '妥善安置阳台和户外易坠物品'],
    heat: ['避开午后高温时段，及时补水', '户外作业做好防晒和轮换休息', '关注中暑征兆，照顾好老人儿童'],
    drought: ['节约用水，合理安排农业灌溉', '关注土壤墒情和官方旱情通报', '林区严格控制野外用火'],
    lightning: ['尽量留在室内，关好门窗', '远离金属物体、高处和大树', '不要在空旷地带打伞或使用手机'],
    hail: ['减少外出，车辆停入有遮挡处', '农业设施和露天作物做好防护', '远离玻璃幕墙和易碎悬挂物'],
    frost: ['农作物、果树和苗木做好覆盖防霜', '清晨路面湿滑，注意出行安全', '关注低温对水产和畜禽的影响'],
    fog: ['驾车减速、开启雾灯并保持车距', '减少晨练和长时间户外活动', '留意高速、机场和轮渡的管制信息'],
    haze: ['减少户外运动，敏感人群戴口罩', '关闭门窗，开启空气净化设备', '关注空气质量变化和官方提示'],
    fire: ['严禁在林区及周边野外用火，停止用火审批', '进入林区不携带火种，发现火情立即报警', '关注当地森林火险等级和应急、林草部门通告'],
    ice: ['减少驾车，避开结冰路面和桥面', '步行注意防滑，远离结冰水面', '关注交通管制和道路封闭信息'],
    other: ['关注当地气象台和应急部门的最新通报', '减少不必要的户外活动', '按当地发布的防御指引做好防范'],
  };
  const ICONS = {
    typhoon: '<circle cx="12" cy="12" r="2.2"/><path d="M12 9.8c3.4-4.7 8.6-4.5 8.6-1.1 0 3.8-5.7 4.8-8.6 3.3"/><path d="M12 14.2c-3.4 4.7-8.6 4.5-8.6 1.1 0-3.8 5.7-4.8 8.6-3.3"/>',
    rain: '<path d="M7 14.5a3.6 3.6 0 0 1-.3-7.2 5.1 5.1 0 0 1 9.6 1.1A3.2 3.2 0 0 1 17.2 15H7Z"/><path d="M8.5 17.5 7.6 20M12 17.5l-.9 2.5M15.5 17.5l-.9 2.5"/>',
    cold: '<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/><path d="m9.5 5 2.5 2 2.5-2M9.5 19l2.5-2 2.5 2M5.1 9.7l3 .4.4-3M18.9 14.3l-3-.4-.4 3M18.9 9.7l-3 .4-.4-3M5.1 14.3l3-.4.4 3"/>',
    wind: '<path d="M3 8.5h11.5a2.8 2.8 0 1 0-2.7-3.5M3 12h16a2.6 2.6 0 1 1-2.5 3.3M3 15.5h7.5a2.3 2.3 0 1 1-2.2 3"/>',
    heat: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M4.5 12H2.3M21.7 12h-2.2M6.7 6.7 5.1 5.1M18.9 18.9l-1.6-1.6M17.3 6.7l1.6-1.6M5.1 18.9l1.6-1.6"/>',
    drought: '<circle cx="7" cy="6.5" r="2.7"/><path d="M3 21h18M5 21c1.8-3.2 3.8-4.8 6-4.8 2.6 0 4.2 1.8 5.5 4.8M9 21v-2.7M15 21v-3.5"/>',
    lightning: '<path d="M13.5 2.5 5.5 13h5l-1 8.5L18.5 10h-5.2l.2-7.5Z"/>',
    hail: '<path d="M7 12.5a3.6 3.6 0 0 1-.3-7.2 5.1 5.1 0 0 1 9.6 1.1A3.2 3.2 0 0 1 17.2 13H7Z"/><circle cx="8" cy="17" r="1.1"/><circle cx="12" cy="19" r="1.1"/><circle cx="16" cy="17" r="1.1"/>',
    frost: '<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/><path d="m9.7 5.2 2.3 1.8 2.3-1.8M9.7 18.8l2.3-1.8 2.3 1.8"/>',
    fog: '<path d="M3 8h18M5.5 12h13M3 16h18M6.5 20h11"/>',
    haze: '<path d="M3 8h18M5 12h14M3 16h18"/><circle cx="7" cy="6" r=".8"/><circle cx="17" cy="5" r="1"/><circle cx="12" cy="18.5" r=".8"/>',
    ice: '<path d="M4 19.5h16M5 17l2.7-8.5h8.6L19 17"/><path d="M9 8.5V6M15 8.5V6M12 4v-1.5M8.5 12h7M8 14.5h8"/>',
    fire: '<path d="M12 21c-3.6 0-6-2.4-6-5.5 0-2.2 1.2-4 3-5.6.4 2 1.4 3 2.4 3.6-.2-3.2.8-6.2 3.3-8.5.2 3 1.4 4.2 2.4 5.7.8 1 1.5 2.3 1.5 4.8 0 3.1-2.4 5.5-6.6 5.5Z"/>',
  };
  function iconSvg(key) {
    const body = ICONS[key] || ICONS.other;
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const state = {
    alerts: [],
    groups: [],
    snapshotById: new Map(),
    snapshotByTitle: new Map(),
    snapshotByKey: new Map(),
    snapshotAt: 0,
    updatedAt: 0,
    source: '中央气象台',
    loading: false,
    seq: 0,
    timer: null,
    open: false,
    lastLoad: 0,
    filters: new Map(),
    sheetReturn: null,
    sheetGroup: null,
    sheetKey: null,
    sheetPage: 0,
    sheetProvince: 'all',
    sheetCity: 'all',
    sheetLevel: 'all',
  };
  const pageEl = $('#warningPage');
  const listEl = $('#warningList');
  const sheetEl = $('#warningSheet');
  const sheetBodyEl = $('#warningSheetBody');

  function parseTime(value) {
    const m = /^(\d{4})[/-](\d{2})[/-](\d{2})\s+(\d{2}):(\d{2})/.exec(String(value || '').trim());
    if (!m) return 0;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]) - 8, Number(m[5]));
  }

  function fmtTime(ts) {
    if (!ts) return '—';
    const iso = new Date(ts + 8 * 3600e3).toISOString();
    return `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
  }

  function fmtClock(ts) {
    if (!ts) return '—';
    return new Date(ts + 8 * 3600e3).toISOString().slice(11, 16);
  }

  function detectLevel(title) {
    for (const key of ['white', 'blue', 'yellow', 'orange', 'red']) {
      if (title.includes(LEVELS[key].label)) return LEVELS[key];
    }
    return LEVELS.blue;
  }

  function detectType(title) {
    const hit = ALIASES.find((item) => title.includes(item.alias));
    return TYPE_DEFS.find((def) => def.key === (hit ? hit.key : 'other')) || TYPE_DEFS[TYPE_DEFS.length - 1];
  }

  function placeFromTitle(title) {
    let place = title.split('气象台')[0];
    if (place === title) place = title.split('发布')[0];
    return place.replace(/发布.*$/, '').trim();
  }

  function normalizeAlert(raw, fallbackSource) {
    const title = String(raw.title || '').trim();
    if (!title) return null;
    const place = String(raw.place || placeFromTitle(title)).trim();
    const province = PROVINCES.find((p) => place.startsWith(p)) || PROVINCES.find((p) => title.includes(p));
    if (!province) return null;
    const typeDef = detectType(title);
    const level = detectLevel(title);
    const ts = parseTime(raw.issuetime || raw.issuedAt || '');
    return {
      id: String(raw.alertid || raw.id || title),
      title,
      place,
      province,
      typeKey: typeDef.key,
      typeName: typeDef.name,
      tone: typeDef.tone,
      icon: typeDef.icon,
      scene: typeDef.scene,
      levelKey: level.key,
      levelLabel: level.label,
      levelRank: level.rank,
      levelGrade: level.grade,
      ts,
      source: fallbackSource || 'live',
      url: raw.url ? `https://www.nmc.cn${String(raw.url).startsWith('/') ? '' : '/'}${raw.url}` : `https://www.nmc.cn/publish/alarm/${encodeURIComponent(String(raw.alertid || raw.id || ''))}.html`,
    };
  }

  function placeShort(place) {
    let rest = place;
    for (const prov of PROVINCES) {
      if (rest.startsWith(prov)) {
        rest = rest.slice(prov.length);
        break;
      }
    }
    if (!rest) {
      const region = place.replace(/(壮族自治区|回族自治区|维吾尔自治区|自治区|省|市)$/, '');
      return region ? `${region}全省` : '全省';
    }
    rest = rest.replace(/[·\s]+/g, '');
    const m = rest.match(/^(.+?(?:市|自治州|州(?!市)|盟))(.*?(?:自治县|县|区|市|旗))?$/);
    if (!m) return rest.slice(-10);
    const cityRaw = m[1];
    const city = cityRaw
      .replace(/^湘西土家族苗族自治州$/, '湘西州')
      .replace(/^博尔塔拉蒙古自治州$/, '博州')
      .replace(/^巴音郭楞蒙古自治州$/, '巴州')
      .replace(/^伊犁哈萨克自治州$/, '伊犁州')
      .replace(/^黔东南苗族侗族自治州$/, '黔东南州')
      .replace(/^黔南布依族苗族自治州$/, '黔南州')
      .replace(/^黔西南布依族苗族自治州$/, '黔西南州')
      .replace(/^恩施土家族苗族自治州$/, '恩施州')
      .replace(/^延边朝鲜族自治州$/, '延边州');
    const county = m[2] || '';
    return county ? `${city} · ${county}` : city;
  }

  function dedupe(list) {
    const map = new Map();
    for (const item of list) {
      if (!item) continue;
      const key = `${item.typeKey}|${item.place}`;
      const prev = map.get(key);
      if (!prev || item.levelRank > prev.levelRank || (item.levelRank === prev.levelRank && item.ts > prev.ts)) map.set(key, item);
    }
    return [...map.values()];
  }

  function groupAlerts(alerts) {
    return TYPE_DEFS.map((def) => {
      const items = alerts
        .filter((a) => a.typeKey === def.key)
        .sort((a, b) => b.levelRank - a.levelRank || b.ts - a.ts);
      const max = items[0] || null;
      return { ...def, alerts: items, max };
    }).sort((a, b) => {
      const active = (b.alerts.length > 0) - (a.alerts.length > 0);
      if (active) return active;
      if (a.alerts.length && b.alerts.length) {
        const diff = b.max.levelRank - a.max.levelRank;
        if (diff) return diff;
      }
      return TYPE_DEFS.findIndex((d) => d.key === a.key) - TYPE_DEFS.findIndex((d) => d.key === b.key);
    });
  }

  function beltSvg(key) {
    const uid = key;
    const step = `<polygon points="80,240 124,254 124,247 80,233" fill="url(#riser-${uid})" stroke="#1b3344" stroke-width=".4"/><polygon points="64,245 108,259 124,254 80,240" fill="url(#tread-${uid})" stroke="#e1eff7" stroke-opacity=".35" stroke-width=".55"/>${Array.from({ length: 9 }, (_, k) => {
      const x1 = 68.4 + k * 4.4;
      const y1 = 246.4 + k * 1.4;
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${(x1 + 16).toFixed(1)}" y2="${(y1 - 5).toFixed(1)}" stroke="#29495a" stroke-width="0.55" opacity=".4"/>`;
    }).join('')}<line x1="64" y1="245" x2="108" y2="259" stroke="#e3c176" stroke-width="1.15"/><line x1="80" y1="240" x2="124" y2="254" stroke="#ebf5fa" stroke-width="0.65" opacity=".55"/>`;
    const steps = Array.from({ length: 18 }, (_, idx) => {
      const i = idx - 2;
      return `<g transform="translate(${i * 16} ${i * -12})">${step}</g>`;
    }).join('');
    return `<svg class="esc-belt-svg" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <linearGradient id="tread-${uid}" x1="0" y1="0" x2=".2" y2="1"><stop stop-color="#dbe9f0"/><stop offset=".5" stop-color="#9db4c2"/><stop offset="1" stop-color="#678595"/></linearGradient>
        <linearGradient id="riser-${uid}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#526b7b"/><stop offset="1" stop-color="#213a4a"/></linearGradient>
        <clipPath id="beltclip-${uid}"><polygon points="64,245 272,89 316,103 108,259"/></clipPath>
      </defs>
      <g clip-path="url(#beltclip-${uid})"><g class="esc-belt-steps">${steps}</g></g>
    </svg>`;
  }

  function stepHtml(alert, index, total, scrub = false) {
    const level = LEVELS[alert.levelKey] || LEVELS.blue;
    const delay = -(index * (30 / Math.max(1, total))).toFixed(1);
    const style = scrub ? `--accent:${level.color}` : `--delay:${delay}s;--accent:${level.color}`;
    return `<button class="wcard-sign${scrub ? ' wcard-scrub-sign' : ''}" type="button" data-sign-index="${index}" data-level="${esc(alert.levelKey)}" data-warning-id="${esc(alert.id)}" style="${style}" title="${esc(alert.place)} · ${esc(alert.levelLabel)}预警" aria-label="${esc(placeShort(alert.place))}，${esc(alert.levelLabel)}预警，查看详情">
      <span class="wcard-plate"><span class="wcard-plate-copy"><b>${esc(placeShort(alert.place))}</b><small>${esc(alert.levelLabel)} · ${esc(fmtClock(alert.ts))}</small></span><span class="wcard-lamp" aria-hidden="true"></span></span>
    </button>`;
  }

  function cardScene(group) {
    if (group.key !== 'other') return group.scene;
    const title = group.max ? group.max.title : '';
    if (/暴雪/.test(title)) return 'snow';
    if (/沙尘暴/.test(title)) return 'sand';
    if (/低温|寒冷/.test(title)) return 'cold';
    if (/霾/.test(title)) return 'haze';
    if (/强对流|雷电/.test(title)) return 'lightning';
    return 'fire';
  }

  function cardFilter(key) {
    return state.filters.get(key) || 'all';
  }

  function filterName(key) {
    const filter = cardFilter(key);
    return filter === 'all' ? '全部省份' : PROVINCE_SHORT[filter] || filter;
  }

  function cardAlerts(group) {
    const filter = cardFilter(group.key);
    return filter === 'all' ? group.alerts : group.alerts.filter((alert) => alert.province === filter);
  }

  function countText(group, list) {
    if (!group.alerts.length) return '待机';
    return `${list.length} 条 · 预 警`;
  }

  function levelAccent(list, group) {
    const top = list[0] || group.max;
    return top ? (LEVELS[top.levelKey] || LEVELS.blue).color : '#3b82f6';
  }

  function shownSignCount() {
    return window.innerWidth <= 520 ? 2 : 3;
  }

  function listPageSize() {
    return window.innerWidth <= 520 ? 6 : 10;
  }

  function clampPage(page, pages) {
    const total = Math.max(1, pages);
    const value = Number.isFinite(page) ? page : 0;
    return Math.max(0, Math.min(total - 1, value));
  }

  function pageItems(pages, current, max) {
    if (pages <= max) return Array.from({ length: pages }, (_, i) => i + 1);
    const items = [];
    const mid = Math.max(1, max - 4);
    if (current <= max - 2) {
      for (let i = 1; i <= max - 1; i++) items.push(i);
      items.push(0, pages);
    } else if (current >= pages - max + 3) {
      items.push(1, 0);
      for (let i = pages - max + 2; i <= pages; i++) items.push(i);
    } else {
      const start = current - Math.floor(mid / 2);
      items.push(1, 0);
      for (let i = start; i < start + mid; i++) items.push(i);
      items.push(0, pages);
    }
    return items;
  }

  function pagerHtml({ pages, page, kind, label, info = '', light = false }) {
    if (pages <= 1) return '';
    const current = clampPage(page, pages);
    const max = window.innerWidth <= 520 ? 4 : 7;
    const numbers = pageItems(pages, current + 1, max).map((value) => {
      if (!value) return '<span class="wx-pager-gap" aria-hidden="true">…</span>';
      const active = value === current + 1;
      return `<button class="wx-pager-btn" type="button" data-page="${value - 1}"${active ? ' aria-current="page"' : ''} aria-label="第 ${value} 页${active ? '（当前页）' : ''}">${value}</button>`;
    }).join('');
    return `<nav class="wx-pager${light ? ' wx-pager--light' : ''}" data-pager="${esc(kind)}" data-pages="${pages}" aria-label="${esc(label)}">
      <button class="wx-pager-btn wx-pager-arrow" type="button" data-page="prev" aria-label="上一页"${current <= 0 ? ' disabled' : ''}>‹</button>
      ${numbers}
      <button class="wx-pager-btn wx-pager-arrow" type="button" data-page="next" aria-label="下一页"${current >= pages - 1 ? ' disabled' : ''}>›</button>
      ${info ? `<span class="wx-pager-info">${esc(info)}</span>` : ''}
    </nav>`;
  }

  function scrubSigns(card) {
    return card.querySelectorAll('.wcard-scrub-sign');
  }

  function updateScrubVisual(card, value) {
    const signs = scrubSigns(card);
    const n = signs.length;
    const progress = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    card._warningProgress = progress;
    if (!n) return;
    const visible = Math.max(1, Math.min(shownSignCount(), n));
    const denom = visible - 1 || 1;
    const travel = n + denom - 1;
    const front = progress * travel;
    signs.forEach((sign, index) => {
      const frac = (front - index) / denom;
      const on = frac >= -0.02 && frac <= 1.02;
      sign.style.display = on ? 'flex' : 'none';
      sign.tabIndex = on ? 0 : -1;
      sign.setAttribute('aria-hidden', on ? 'false' : 'true');
      if (!on) return;
      const t = Math.max(0, Math.min(1, frac));
      sign.style.left = `${(24.75 + 48 * t).toFixed(3)}%`;
      sign.style.top = `${(77 - 48 * t).toFixed(3)}%`;
      sign.style.opacity = '1';
    });
    const rail = card.querySelector('.wcard-rail');
    if (!rail || rail.hidden) return;
    const height = rail.clientHeight;
    const thumb = rail.querySelector('.wcard-rail-thumb');
    if (!height || !thumb) return;
    const thumbHeight = Math.max(20, Math.min(Math.round(height * 0.6), Math.round(height * Math.min(1, visible / n))));
    thumb.style.height = `${thumbHeight}px`;
    thumb.style.top = `${Math.round((1 - progress) * (height - thumbHeight))}px`;
    rail.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
    rail.setAttribute('aria-valuetext', `第 ${Math.min(n, Math.floor(progress * (n - 1)) + 1)} 条，共 ${n} 条预警`);
  }

  function paintCard(card) {
    if (!card) return;
    const rail = card.querySelector('.wcard-rail');
    const count = scrubSigns(card).length;
    if (rail) rail.hidden = count <= 1;
    updateScrubVisual(card, card._warningProgress || 0);
  }

  function playBelt(card, direction) {
    const belt = card.querySelector('.esc-belt-steps');
    if (!belt || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    belt.style.animationDirection = direction < 0 ? 'reverse' : 'normal';
    belt.style.animationPlayState = 'running';
    clearTimeout(card._beltTimer);
    card._beltTimer = setTimeout(() => { belt.style.animationPlayState = 'paused'; }, 280);
  }

  function setCardProgress(card, value, animate) {
    const previous = card._warningProgress || 0;
    const next = Math.max(0, Math.min(1, value));
    updateScrubVisual(card, next);
    if (animate && Math.abs(next - previous) > 0.0001) playBelt(card, next > previous ? 1 : -1);
  }

  function startScrub(card) {
    const scrub = card && card.querySelector('.wcard-scrub');
    if (!scrub || scrub.children.length < 2) return false;
    card.classList.add('is-scrubbing');
    scrub.hidden = false;
    const belt = card.querySelector('.esc-belt-steps');
    if (belt) belt.style.animationPlayState = 'paused';
    clearTimeout(card._scrubEndTimer);
    return true;
  }

  function endScrub(card) {
    if (!card || !card.classList.contains('is-scrubbing')) return;
    card.classList.remove('is-scrubbing');
    const scrub = card.querySelector('.wcard-scrub');
    if (scrub) scrub.hidden = true;
    const belt = card.querySelector('.esc-belt-steps');
    if (belt) {
      belt.style.animationPlayState = '';
      belt.style.animationDirection = '';
    }
    clearTimeout(card._beltTimer);
    clearTimeout(card._scrubEndTimer);
    if (card._scrubLeave) {
      card.removeEventListener('mouseleave', card._scrubLeave);
      card._scrubLeave = null;
    }
    card._warningProgress = 0;
    updateScrubVisual(card, 0);
  }

  function scheduleScrubEnd(card, delay) {
    clearTimeout(card._scrubEndTimer);
    card._scrubEndTimer = setTimeout(() => endScrub(card), delay);
  }

  function holdScrubUntilLeave(card) {
    if (card._scrubLeave) card.removeEventListener('mouseleave', card._scrubLeave);
    card._scrubLeave = () => endScrub(card);
    card.addEventListener('mouseleave', card._scrubLeave, { once: true });
  }

  function railProgress(rail, clientY) {
    const rect = rail.getBoundingClientRect();
    const thumb = rail.querySelector('.wcard-rail-thumb');
    const thumbHeight = parseFloat(thumb && thumb.style.height) || 24;
    const usable = Math.max(1, rect.height - thumbHeight);
    return Math.max(0, Math.min(1, 1 - (clientY - rect.top - thumbHeight / 2) / usable));
  }

  function cardHtml(group) {
    const active = group.alerts.length > 0;
    const list = cardAlerts(group);
    const shown = list.slice(0, shownSignCount());
    const filter = cardFilter(group.key);
    const accent = levelAccent(list, group);
    const options = [['all', '全部省份'], ...PROVINCES.map((p) => [p, PROVINCE_SHORT[p]])]
      .map(([value, label]) => `<option value="${esc(value)}"${filter === value ? ' selected' : ''}>${esc(label)}</option>`)
      .join('');
    return `<article class="wcard${active ? ' is-live' : ' is-idle'}" data-type="${group.key}" style="--bg:url('assets/warnings/${cardScene(group)}.webp');--tone:${group.tone};--accent:${accent}">
      <div class="wcard-bg"></div>
      <header class="wcard-head">
        <span class="wcard-name">${iconSvg(group.icon)}<span>${esc(group.name)}</span></span>
        <span class="wcard-filter"><select data-type-filter="${group.key}" aria-label="${esc(group.name)}预警按省份筛选">${options}</select></span>
      </header>
      <div class="wcard-track">
        <div class="wcard-belt">${beltSvg(group.key)}</div>
        <div class="wcard-esc"><img src="assets/escalator/escalator-frame-clear.svg" alt="" width="400" height="300" draggable="false"></div>
        <div class="wcard-signs">${shown.map((alert, i) => stepHtml(alert, i, shown.length)).join('')}</div>
        ${list.length > 1 ? `<div class="wcard-scrub" hidden>${list.map((alert, i) => stepHtml(alert, i, list.length, true)).join('')}</div>` : ''}
        ${list.length > 1 ? `<div class="wcard-rail" data-type-rail="${group.key}" role="slider" tabindex="0" aria-orientation="vertical" title="上下拖动查看全部预警信号" aria-label="上下浏览${esc(group.name)}全部预警信号" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="wcard-rail-thumb"></span></div>` : ''}
        ${active && !list.length ? `<div class="wcard-empty"><span>${esc(filterName(group.key))}暂无此类预警</span></div>` : ''}
      </div>
      <div class="wcard-bar"><span class="wcard-count">${esc(countText(group, list))}</span><button class="wcard-detail" type="button" data-type-detail="${group.key}" aria-label="查看${esc(group.name)}的全部预警地点">详情<b>${list.length}</b></button></div>
      ${active ? '' : '<div class="wcard-idle"><span>本轮暂无预警</span></div>'}
    </article>`;
  }

  function applyCardFilter(typeKey, filter) {
    state.filters.set(typeKey, filter);
    const group = state.groups.find((g) => g.key === typeKey);
    const card = listEl.querySelector(`.wcard[data-type="${typeKey}"]`);
    if (!group || !card) return;
    const list = cardAlerts(group);
    const active = group.alerts.length > 0;
    const shown = list.slice(0, shownSignCount());
    endScrub(card);
    card.style.setProperty('--accent', levelAccent(list, group));
    card.querySelector('.wcard-signs').innerHTML = shown.map((alert, i) => stepHtml(alert, i, shown.length)).join('');
    if (group.alerts.length > 1) {
      let scrub = card.querySelector('.wcard-scrub');
      if (!scrub) {
        scrub = document.createElement('div');
        scrub.className = 'wcard-scrub';
        scrub.hidden = true;
        card.querySelector('.wcard-track').appendChild(scrub);
      }
      scrub.innerHTML = list.map((alert, i) => stepHtml(alert, i, list.length, true)).join('');
      scrub.hidden = true;
    }
    card.querySelector('.wcard-count').textContent = countText(group, list);
    const detail = card.querySelector('.wcard-detail b');
    if (detail) detail.textContent = String(list.length);
    const select = card.querySelector('[data-type-filter]');
    if (select) select.value = filter;
    const rail = card.querySelector('.wcard-rail');
    if (rail) rail.hidden = list.length <= 1;
    card._warningProgress = 0;
    paintCard(card);
    let empty = card.querySelector('.wcard-empty');
    if (active && !list.length) {
      if (!empty) {
        empty = document.createElement('div');
        empty.className = 'wcard-empty';
        empty.innerHTML = '<span></span>';
        card.querySelector('.wcard-track').appendChild(empty);
      }
      empty.querySelector('span').textContent = `${filterName(typeKey)}暂无此类预警`;
    } else if (empty) {
      empty.remove();
    }
  }

  function notifyUpdate() {
    document.dispatchEvent(new CustomEvent('warnings:update'));
  }

  function render() {
    const total = state.alerts.length;
    const activeTypes = state.groups.filter((g) => g.alerts.length).length;
    $('#warningTotal').textContent = String(total);
    $('#warningTypes').textContent = String(activeTypes);
    $('#warningSource').textContent = state.source;
    $('#warningUpdated').textContent = state.updatedAt ? `更新 ${fmtClock(state.updatedAt)}` : '连接中…';
    const banner = total
      ? ''
      : '<div class="warning-empty-all">当前五省暂无生效预警，所有扶梯处于待机状态。</div>';
    listEl.innerHTML = banner + state.groups.map(cardHtml).join('');
    listEl.querySelectorAll('.wcard').forEach(paintCard);
    notifyUpdate();
  }

  function renderLoading() {
    listEl.innerHTML = '<div class="warning-loading">正在读取全国预警…</div>';
    $('#warningTotal').textContent = '—';
    $('#warningTypes').textContent = '—';
    notifyUpdate();
  }

  function renderError() {
    listEl.innerHTML = '<div class="warning-empty-all">预警数据暂时不可用，请稍后点击右上角刷新。</div>';
    $('#warningTotal').textContent = '—';
    $('#warningTypes').textContent = '—';
    notifyUpdate();
  }

  async function fetchNmcPage(page) {
    const url = `${NMC_ALARM}?pageNo=${page}&pageSize=${PAGE_SIZE}&_=${Date.now()}${page}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`NMC ${res.status}`);
    const json = await res.json();
    const pageData = json && json.data && json.data.page;
    if (!pageData || !Array.isArray(pageData.list)) throw new Error('NMC bad payload');
    return pageData;
  }

  async function loadSnapshot() {
    try {
      const res = await fetch(`data/warnings.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('snapshot');
      const json = await res.json();
      const byId = new Map();
      const byTitle = new Map();
      const byKey = new Map();
      for (const item of json.alerts || []) {
        if (!item || !item.id) continue;
        byId.set(String(item.id), item);
        byTitle.set(String(item.title || '').replace(/气象台/g, '').replace(/\s/g, ''), item);
        const typeDef = detectType(item.title || '');
        const level = detectLevel(item.title || '');
        byKey.set(`${typeDef.key}|${item.place}|${level.key}`, item);
      }
      state.snapshotById = byId;
      state.snapshotByTitle = byTitle;
      state.snapshotByKey = byKey;
      state.snapshotAt = Date.parse(json.updatedAt || '') || Date.now();
      return json;
    } catch (e) {
      return null;
    }
  }

  async function loadGdFire() {
    let payload = null;
    let mode = 'live';
    try {
      const res = await fetch(GD_FIRE_API, { cache: 'no-store' });
      if (res.ok) {
        payload = await res.json();
        mode = payload.stale ? 'cache' : 'live';
      }
    } catch (e) {
      /* Static deployment or proxy unavailable: use the snapshot below. */
    }
    if (!payload || !Array.isArray(payload.alerts)) {
      try {
        const res = await fetch(`${GD_FIRE_SNAPSHOT}?t=${Date.now()}`, { cache: 'no-store' });
        if (res.ok) {
          const snapshot = await res.json();
          if (snapshot && Array.isArray(snapshot.alerts)) {
            payload = snapshot;
            mode = 'snapshot';
          }
        }
      } catch (e) {
        return null;
      }
    }
    if (!payload || !Array.isArray(payload.alerts)) return null;
    return { alerts: payload.alerts, mode, fetchedAt: Date.parse(payload.fetchedAt) || Date.now() };
  }

  function normalizeGdFire(row, mode) {
    if (!row || !row.id) return null;
    const ts = parseTime(row.publishdate);
    if (!ts) return null;
    const typeDef = TYPE_DEFS.find((item) => item.key === 'fire');
    const level = LEVELS[GD_LEVELS[String(row.level || '').trim()]] || detectLevel(row.title || '');
    return {
      id: String(row.id),
      title: String(row.title || '森林火险预警'),
      place: String(row.place || row.city || '广东省'),
      province: String(row.province || '广东省'),
      typeKey: 'fire',
      typeName: typeDef.name,
      tone: typeDef.tone,
      icon: typeDef.icon,
      scene: typeDef.scene,
      levelKey: level.key,
      levelLabel: level.label,
      levelRank: level.rank,
      levelGrade: level.grade,
      ts,
      source: mode,
      publisher: '广东省气象局',
      url: String(row.url || 'https://www.gd121.cn/'),
      text: String(row.content || '').trim(),
    };
  }

  function gdFireAlerts(gd) {
    if (!gd) return [];
    return gd.alerts.map((row) => normalizeGdFire(row, gd.mode)).filter(Boolean);
  }

  async function loadAlerts(force) {
    if (state.loading) return;
    if (!force && state.lastLoad && Date.now() - state.lastLoad < 90e3) return;
    const seq = ++state.seq;
    state.loading = true;
    if (!state.alerts.length) renderLoading();
    const snapshotPromise = loadSnapshot();
    const gdPromise = loadGdFire();
    try {
      const first = await fetchNmcPage(1);
      const totalPages = Math.min(MAX_PAGES, Number(first.totalPage) || 1);
      const rest = await Promise.all(Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) => fetchNmcPage(i + 2).catch(() => null)));
      if (seq !== state.seq) return;
      const raw = [first, ...rest.filter(Boolean)].flatMap((p) => p.list || []);
      state.alerts = dedupe(raw.map((item) => normalizeAlert(item, 'live')).filter(Boolean));
      state.source = '中央气象台';
      state.updatedAt = Date.now();
      state.groups = groupAlerts(state.alerts);
      state.lastLoad = Date.now();
      render();
      const gd = await gdPromise;
      if (seq !== state.seq) return;
      const extra = gdFireAlerts(gd);
      if (extra.length) {
        state.alerts = dedupe([...state.alerts, ...extra]);
        state.source = '中央气象台 / 广东省气象局';
        state.updatedAt = Math.max(state.updatedAt, gd.fetchedAt || 0);
        state.groups = groupAlerts(state.alerts);
        render();
      }
      await snapshotPromise;
      if (seq !== state.seq) return;
    } catch (e) {
      const [snapshot, gd] = await Promise.all([snapshotPromise, gdPromise]);
      if (seq !== state.seq) return;
      const extra = gdFireAlerts(gd);
      if (snapshot && snapshot.alerts && snapshot.alerts.length) {
        state.alerts = dedupe([...snapshot.alerts.map((item) => normalizeAlert(item, 'snapshot')).filter(Boolean), ...extra]);
        state.source = extra.length ? '中国天气网快照 / 广东省气象局' : '中国天气网快照';
        state.updatedAt = Math.max(state.snapshotAt || Date.now(), gd ? gd.fetchedAt || 0 : 0);
        state.groups = groupAlerts(state.alerts);
        state.lastLoad = Date.now();
        render();
      } else if (extra.length) {
        state.alerts = dedupe(extra);
        state.source = '广东省气象局';
        state.updatedAt = gd.fetchedAt || Date.now();
        state.groups = groupAlerts(state.alerts);
        state.lastLoad = Date.now();
        render();
      } else if (!state.alerts.length) {
        renderError();
      }
    } finally {
      if (seq === state.seq) {
        state.loading = false;
        notifyUpdate();
      }
    }
  }

  function findDetail(alert) {
    return state.snapshotById.get(alert.id)
      || state.snapshotByTitle.get(String(alert.title || '').replace(/气象台/g, '').replace(/\s/g, ''))
      || state.snapshotByKey.get(`${alert.typeKey}|${alert.place}|${alert.levelKey}`)
      || null;
  }

  function openSheet(alert, returnTo) {
    if (!alert) return;
    state.sheetReturn = returnTo || null;
    const detail = findDetail(alert);
    const text = alert.text || (detail && detail.text) || '';
    const fileLink = detail && detail.fileName ? `https://www.weather.com.cn/alarm/newalarmcontent.shtml?file=${encodeURIComponent(detail.fileName)}` : '';
    const official = alert.publisher ? (alert.url || fileLink) : (fileLink || alert.url);
    const publisher = alert.publisher || '国家预警信息发布中心';
    const guide = GUIDE[alert.typeKey] || GUIDE.other;
    const level = LEVELS[alert.levelKey] || LEVELS.blue;
    sheetBodyEl.innerHTML = `<div class="ws-head">
      <span class="ws-icon" style="--wl-tone:${alert.tone}">${iconSvg(alert.icon)}</span>
      <div><span class="ws-eyebrow" style="--wl-tone:${alert.tone}">${esc(alert.typeName)} · ${esc(alert.levelLabel)}预警</span><h2 id="warningSheetTitle">${esc(alert.place)}</h2><p class="ws-time">${esc(fmtTime(alert.ts))} · ${esc(publisher)}</p></div>
    </div>
    <div class="ws-levels"><span class="ws-lamp-lg" style="--accent:${level.color}" aria-hidden="true"></span><div class="ws-level-text"><b>${esc(level.label)}预警</b><span>${esc(level.grade)}</span></div></div>
    ${text ? `<p class="ws-text">${esc(text)}</p>` : '<p class="ws-sync">官方正文同步中，以下为通用防御指引；可点击下方官方原文查看。</p>'}
    <div class="ws-guide"><h3>防御指引</h3><ul>${guide.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div>
    <div class="ws-meta"><span>${esc(alert.typeName)}</span><span>${esc(alert.levelLabel)}</span><span>${esc(alert.place)}</span><span>${text ? '官方全文已同步' : '通用指引'}</span></div>
    <div class="ws-actions"><a class="ws-btn primary" href="${esc(official)}" target="_blank" rel="noopener">查看官方原文</a>${returnTo ? '<button class="ws-btn" type="button" data-warning-back>返回列表</button>' : ''}<button class="ws-btn" type="button" data-warning-close>关闭</button></div>`;
    showSheet();
  }

  function showSheet() {
    sheetEl.classList.add('open');
    sheetEl.setAttribute('aria-hidden', 'false');
    document.body.classList.add('warning-sheet-open');
    sheetBodyEl.scrollTop = 0;
    const closeBtn = $('.warning-sheet-close', sheetEl);
    if (closeBtn) closeBtn.focus({ preventScroll: true });
  }

  function alertCity(alert) {
    const cut = String(alert.place || '').split(' · ')[0];
    const rest = cut.replace(/^.*?(省|自治区)/, '');
    const index = rest.indexOf('市');
    return (index >= 0 ? rest.slice(0, index + 1) : rest).trim() || cut.trim();
  }

  function renderTypeSheet() {
    const group = state.sheetGroup;
    if (!group) return;
    const base = cardAlerts(group);
    const provinces = PROVINCES.filter((province) => base.some((alert) => alert.province === province));
    if (state.sheetProvince !== 'all' && !provinces.includes(state.sheetProvince)) state.sheetProvince = 'all';
    const byProvince = state.sheetProvince === 'all' ? base : base.filter((alert) => alert.province === state.sheetProvince);
    const cities = [...new Set(byProvince.map(alertCity))].sort((a, b) => a.localeCompare(b, 'zh'));
    if (state.sheetCity !== 'all' && !cities.includes(state.sheetCity)) state.sheetCity = 'all';
    const byCity = state.sheetCity === 'all' ? byProvince : byProvince.filter((alert) => alertCity(alert) === state.sheetCity);
    const levelKeys = ['red', 'orange', 'yellow', 'blue', 'white'].filter((key) => byCity.some((alert) => alert.levelKey === key));
    if (state.sheetLevel !== 'all' && !levelKeys.includes(state.sheetLevel)) state.sheetLevel = 'all';
    const list = state.sheetLevel === 'all' ? byCity : byCity.filter((alert) => alert.levelKey === state.sheetLevel);

    const provinceOptions = `<option value="all">全部省份</option>${provinces.map((province) => `<option value="${esc(province)}"${province === state.sheetProvince ? ' selected' : ''}>${esc(PROVINCE_SHORT[province] || province)}</option>`).join('')}`;
    const cityOptions = `<option value="all">全部地级市</option>${cities.map((city) => `<option value="${esc(city)}"${city === state.sheetCity ? ' selected' : ''}>${esc(city)}</option>`).join('')}`;
    const levelCounts = {};
    for (const alert of byCity) levelCounts[alert.levelKey] = (levelCounts[alert.levelKey] || 0) + 1;
    const colorChips = ['all', ...levelKeys].map((key) => {
      const label = key === 'all' ? '全部' : LEVELS[key].label;
      const count = key === 'all' ? byCity.length : levelCounts[key] || 0;
      const swatch = key === 'all' ? '' : `<i style="--c:${LEVELS[key].color}" aria-hidden="true"></i>`;
      return `<button type="button" data-sheet-level="${key}" aria-pressed="${state.sheetLevel === key}">${swatch}${label}<b>${count}</b></button>`;
    }).join('');

    const size = listPageSize();
    const pages = Math.max(1, Math.ceil(list.length / size));
    const page = clampPage(state.sheetPage, pages);
    state.sheetPage = page;
    const rows = list.slice(page * size, page * size + size).map((alert) => {
      const level = LEVELS[alert.levelKey] || LEVELS.blue;
      return `<button class="wt-row" type="button" data-warning-id="${esc(alert.id)}" style="--accent:${level.color}">
        <span class="wt-main"><b>${esc(alert.place)}</b><small>${esc(alert.levelLabel)}预警 · ${esc(alert.levelGrade)}</small></span>
        <span class="wt-lamp" aria-hidden="true"></span>
        <span class="wt-right"><time>${esc(fmtTime(alert.ts))}</time><span>查看 ›</span></span>
      </button>`;
    }).join('');
    const range = list.length ? `${page * size + 1}–${page * size + Math.min(size, list.length - page * size)} / ${list.length}` : '';
    const scope = state.sheetCity !== 'all'
      ? state.sheetCity
      : state.sheetProvince !== 'all'
        ? (PROVINCE_SHORT[state.sheetProvince] || state.sheetProvince)
        : filterName(group.key);
    sheetBodyEl.innerHTML = `<div class="ws-head">
      <span class="ws-icon" style="--wl-tone:${group.tone}">${iconSvg(group.icon)}</span>
      <div><span class="ws-eyebrow" style="--wl-tone:${group.tone}">${esc(group.name)}预警 · 信号灯一览</span><h2 id="warningSheetTitle">${esc(scope)} · ${list.length} 处</h2><p class="ws-time">按预警等级和发布时间排序 · 更新 ${esc(fmtClock(state.updatedAt))}</p></div>
    </div>
    <div class="wt-filters">
      <label class="wt-filter"><span>省份</span><select data-sheet-filter="province" aria-label="按省份筛选预警">${provinceOptions}</select></label>
      <label class="wt-filter"><span>地级市</span><select data-sheet-filter="city" aria-label="按地级市筛选预警">${cityOptions}</select></label>
      <div class="wt-colors" role="group" aria-label="按预警颜色筛选">${colorChips}</div>
    </div>
    <div class="wt-list">${rows || '<p class="wt-empty">当前筛选下暂无此类预警信号，可调整省份、城市或颜色。</p>'}</div>
    ${pagerHtml({ pages, page, kind: 'sheet', label: `${group.name}预警列表分页`, info: range })}
    <div class="ws-actions"><button class="ws-btn primary" type="button" data-warning-close>关闭</button></div>`;
  }

  function openTypeSheet(group, keepPage) {
    if (!group) return;
    if (!keepPage || state.sheetKey !== group.key) {
      state.sheetPage = 0;
      state.sheetProvince = 'all';
      state.sheetCity = 'all';
      state.sheetLevel = 'all';
    }
    state.sheetKey = group.key;
    state.sheetGroup = group;
    state.sheetReturn = null;
    renderTypeSheet();
    showSheet();
  }

  function closeSheet() {
    sheetEl.classList.remove('open');
    sheetEl.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('warning-sheet-open');
    state.sheetReturn = null;
  }

  function open() {
    if (state.open) return;
    state.open = true;
    try { localStorage.setItem('qxksh.warningView', 'escalator'); } catch (e) { /* ignore */ }
    pageEl.setAttribute('aria-hidden', 'false');
    document.body.classList.add('warning-open');
    loadAlerts(false);
    clearInterval(state.timer);
    state.timer = setInterval(() => loadAlerts(true), 5 * 60e3);
  }

  function close() {
    state.open = false;
    clearInterval(state.timer);
    state.timer = null;
    closeSheet();
    pageEl.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('warning-open');
  }

  function bind() {
    let railDrag = null;
    const hoverCapable = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    $('#warningBack').addEventListener('click', () => {
      location.hash = '#/center';
    });
    $('#warningRefresh').addEventListener('click', () => loadAlerts(true));
    listEl.addEventListener('change', (event) => {
      const select = event.target.closest('[data-type-filter]');
      if (select) applyCardFilter(select.dataset.typeFilter, select.value);
    });
    listEl.addEventListener('pointerdown', (event) => {
      const rail = event.target.closest('.wcard-rail');
      if (!rail) return;
      const card = rail.closest('.wcard');
      if (!card || rail.hidden || !startScrub(card)) return;
      event.preventDefault();
      try { rail.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
      railDrag = { rail, card, id: event.pointerId, touch: event.pointerType !== 'mouse' };
      setCardProgress(card, railProgress(rail, event.clientY), false);
      if (!railDrag.touch) holdScrubUntilLeave(card);
    });
    listEl.addEventListener('pointermove', (event) => {
      if (!railDrag || railDrag.id !== event.pointerId) return;
      if (!railDrag.card.classList.contains('is-scrubbing')) return;
      event.preventDefault();
      setCardProgress(railDrag.card, railProgress(railDrag.rail, event.clientY), true);
    });
    const endRailDrag = (event) => {
      if (!railDrag || railDrag.id !== event.pointerId) return;
      const { card, touch } = railDrag;
      railDrag = null;
      if (touch) scheduleScrubEnd(card, 1600);
    };
    listEl.addEventListener('pointerup', endRailDrag);
    listEl.addEventListener('pointercancel', endRailDrag);
    listEl.addEventListener('wheel', (event) => {
      const rail = event.target.closest('.wcard-rail');
      if (!rail) return;
      const card = rail.closest('.wcard');
      if (!card || rail.hidden || !startScrub(card)) return;
      event.preventDefault();
      const count = scrubSigns(card).length;
      const step = Math.max(0.06, 1 / Math.max(4, count - 1));
      setCardProgress(card, (card._warningProgress || 0) + (event.deltaY < 0 ? step : -step), true);
      if (hoverCapable()) holdScrubUntilLeave(card);
      else scheduleScrubEnd(card, 1500);
    }, { passive: false });
    listEl.addEventListener('keydown', (event) => {
      const rail = event.target.closest('.wcard-rail');
      if (!rail) return;
      const card = rail.closest('.wcard');
      if (!card || rail.hidden || !startScrub(card)) return;
      const count = scrubSigns(card).length;
      const step = event.shiftKey ? 0.25 : 0.08;
      let next = card._warningProgress || 0;
      if (event.key === 'ArrowUp' || event.key === 'ArrowRight') next += step;
      else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') next -= step;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = 1;
      else return;
      event.preventDefault();
      setCardProgress(card, next, true);
      scheduleScrubEnd(card, 1600);
    });
    let warningResizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(warningResizeTimer);
      warningResizeTimer = setTimeout(() => listEl.querySelectorAll('.wcard').forEach(paintCard), 150);
    });
    listEl.addEventListener('click', (event) => {
      const detailBtn = event.target.closest('[data-type-detail]');
      if (detailBtn) {
        openTypeSheet(state.groups.find((g) => g.key === detailBtn.dataset.typeDetail));
        return;
      }
      const step = event.target.closest('.wcard-sign[data-warning-id]');
      if (!step) return;
      const alert = state.alerts.find((a) => a.id === step.dataset.warningId);
      if (alert) openSheet(alert);
    });
    sheetEl.addEventListener('click', (event) => {
      if (event.target.closest('[data-warning-close]')) {
        closeSheet();
        return;
      }
      if (event.target.closest('[data-warning-back]')) {
        if (state.sheetReturn) openTypeSheet(state.sheetReturn, true);
        return;
      }
      const colorChip = event.target.closest('[data-sheet-level]');
      if (colorChip && state.sheetGroup) {
        const level = colorChip.dataset.sheetLevel;
        if (level !== state.sheetLevel) {
          state.sheetLevel = level;
          state.sheetPage = 0;
          renderTypeSheet();
          sheetBodyEl.scrollTop = 0;
          const active = sheetBodyEl.querySelector(`[data-sheet-level="${level}"]`);
          if (active) active.focus({ preventScroll: true });
        }
        return;
      }
      const pager = event.target.closest('.wx-pager[data-pager="sheet"]');
      if (pager) {
        const button = event.target.closest('button[data-page]');
        if (!button || button.disabled || !state.sheetGroup) return;
        const pages = Number(pager.dataset.pages) || 1;
        const raw = button.dataset.page;
        const target = raw === 'prev' ? state.sheetPage - 1 : raw === 'next' ? state.sheetPage + 1 : Number(raw);
        const page = clampPage(target, pages);
        if (page === state.sheetPage) return;
        state.sheetPage = page;
        renderTypeSheet();
        sheetBodyEl.scrollTop = 0;
        const active = sheetBodyEl.querySelector('.wx-pager button[aria-current="page"]');
        if (active) active.focus({ preventScroll: true });
        return;
      }
      const row = event.target.closest('.wt-row[data-warning-id]');
      if (row) {
        const alert = state.alerts.find((a) => a.id === row.dataset.warningId);
        if (alert) openSheet(alert, state.sheetGroup);
      }
    });
    sheetEl.addEventListener('change', (event) => {
      const select = event.target.closest('[data-sheet-filter]');
      if (!select || !state.sheetGroup) return;
      if (select.dataset.sheetFilter === 'province') {
        state.sheetProvince = select.value;
        state.sheetCity = 'all';
      } else if (select.dataset.sheetFilter === 'city') {
        state.sheetCity = select.value;
      } else {
        return;
      }
      state.sheetPage = 0;
      renderTypeSheet();
      sheetBodyEl.scrollTop = 0;
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && sheetEl.classList.contains('open')) closeSheet();
    });
  }

  bind();
  window.WarningPage = { open, close, load: loadAlerts, ensureData: loadAlerts, state, openSheet, openTypeSheet, closeSheet, iconSvg, constants: { PROVINCES, PROVINCE_SHORT }, utils: { pagerHtml, listPageSize, clampPage } };
})();
