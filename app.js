(function () {
  'use strict';

  const MAP = window.MAP_DATA;
  const SNAP = window.WEATHER_SNAPSHOT;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

  /* ---------------- data index ---------------- */
  const CITY_BY_ADCODE = new Map();
  const CITY_BY_NAME = new Map();
  const PROVINCE_OF = new Map();
  const CAPITALS = new Set([440100, 430100, 450100, 360100, 350100]);

  MAP.provinces.forEach((p) => {
    p.cities.forEach((c) => {
      const entry = { ...c, province: p.name, provinceFull: p.full };
      CITY_BY_ADCODE.set(c.adcode, entry);
      CITY_BY_NAME.set(c.name, entry);
      PROVINCE_OF.set(c.adcode, p);
    });
  });

  const bbox = MAP.bbox;
  const ASPECT = ((bbox[2] - bbox[0]) * Math.cos((((bbox[1] + bbox[3]) / 2) * Math.PI) / 180)) / (bbox[3] - bbox[1]);
  const INITIAL_CENTER = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];

  const isMobile = () => window.innerWidth < 860;

  /* ---------------- weather helpers ---------------- */
  const BEAUFORT = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
  const WIND_NAMES = ['无风', '软风', '轻风', '微风', '和风', '清风', '强风', '疾风', '大风', '烈风', '狂风', '暴风', '飓风'];
  function beaufort(ms) {
    if (typeof ms !== 'number') return null;
    let level = 0;
    while (level < BEAUFORT.length && ms >= BEAUFORT[level]) level++;
    return level;
  }
  const num = (v) => (typeof v === 'number' && v !== 9999 && v > -999 ? v : null);
  const weatherText = (w) => (w && w.info && w.info !== '9999' && w.info !== '-' ? w.info : '');
  const fix1 = (v) => (v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1));

  function normalize(raw) {
    const cities = {};
    Object.entries(raw.cities || {}).forEach(([ad, c]) => {
      if (!c) return;
      const hourly = Array.isArray(c.hourly) ? c.hourly : [];
      const rains = hourly.map((h) => (typeof h.rain === 'number' ? h.rain : 0));
      const temps = hourly.map((h) => h.t).filter((v) => typeof v === 'number');
      const rain24h = Math.round(rains.reduce((a, b) => a + b, 0) * 10) / 10;
      const rain6h = Math.round(rains.slice(-6).reduce((a, b) => a + b, 0) * 10) / 10;
      const rain1h = typeof c.rainNow === 'number' ? c.rainNow : rains.length ? rains[rains.length - 1] : null;
      const firstT = hourly.find((h) => typeof h.t === 'number');
      cities[ad] = {
        ...c,
        precip24h: rain24h,
        rain24h,
        rain6h,
        rain1h,
        tmax24: temps.length ? Math.max(...temps) : c.tmax,
        tmin24: temps.length ? Math.min(...temps) : c.tmin,
        dtemp24: typeof c.t === 'number' && firstT && hourly.length >= 20 ? Math.round((c.t - firstT.t) * 10) / 10 : null,
      };
    });
    return { ...raw, cities };
  }

  /* ---------------- metrics ---------------- */
  const TEMP_BANDS = [
    { min: -Infinity, label: '≤-5', color: '#8fa8e6' },
    { min: -5, label: '-5', color: '#7ea4e2' },
    { min: 0, label: '0', color: '#6fbde6' },
    { min: 5, label: '5', color: '#6fd0d4' },
    { min: 10, label: '10', color: '#8bdcb4' },
    { min: 15, label: '15', color: '#c2e69a' },
    { min: 20, label: '20', color: '#f2e489' },
    { min: 25, label: '25', color: '#f8c778' },
    { min: 30, label: '30', color: '#f2a066' },
    { min: 35, label: '35', color: '#e87563' },
    { min: 40, label: '≥40', color: '#cf4c4c' },
  ];
  const DTEMP_BANDS = [
    { min: -Infinity, label: '≤-8', color: '#3d63b8' },
    { min: -8, label: '-8', color: '#5f8cd8' },
    { min: -6, label: '-6', color: '#93b5e8' },
    { min: -4, label: '-4', color: '#c8dcf3' },
    { min: -2, label: '-2', color: '#eef1e9' },
    { min: 2, label: '2', color: '#f7d8a4' },
    { min: 4, label: '4', color: '#f2b071' },
    { min: 6, label: '6', color: '#e5825c' },
    { min: 8, label: '≥8', color: '#c94848' },
  ];
  const WIND_BANDS = [
    { min: 0, label: '0', color: '#e8f4f1' },
    { min: 2, label: '2', color: '#b7e2d9' },
    { min: 4, label: '4', color: '#7ecbbc' },
    { min: 6, label: '6', color: '#4eaeb8' },
    { min: 8, label: '8', color: '#4a83c0' },
    { min: 10, label: '10', color: '#5b62b4' },
    { min: 12, label: '≥12', color: '#5a4a9e' },
  ];
  const RAIN_BANDS = {
    r1: [
      { min: 0, label: '0', color: '#ffffff' },
      { min: 0.1, label: '0.1', color: '#d7edfb' },
      { min: 2, label: '2', color: '#a9d8f2' },
      { min: 5, label: '5', color: '#74bce8' },
      { min: 10, label: '10', color: '#4396d6' },
      { min: 20, label: '20', color: '#2a6cba' },
      { min: 50, label: '≥50', color: '#6a4aa8' },
    ],
    r6: [
      { min: 0, label: '0', color: '#ffffff' },
      { min: 0.1, label: '0.1', color: '#d7edfb' },
      { min: 5, label: '5', color: '#a9d8f2' },
      { min: 10, label: '10', color: '#74bce8' },
      { min: 25, label: '25', color: '#4396d6' },
      { min: 50, label: '50', color: '#2a6cba' },
      { min: 100, label: '≥100', color: '#6a4aa8' },
    ],
    r24: [
      { min: 0, label: '0', color: '#ffffff' },
      { min: 0.1, label: '0.1', color: '#d7edfb' },
      { min: 10, label: '10', color: '#a9d8f2' },
      { min: 25, label: '25', color: '#74bce8' },
      { min: 50, label: '50', color: '#4396d6' },
      { min: 100, label: '100', color: '#2a6cba' },
      { min: 250, label: '≥250', color: '#6a4aa8' },
    ],
  };

  const tempFormat = (v) => (v == null ? '—' : v.toFixed(1));
  const signedFormat = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`);
  const rainFormat = (v) => (v == null ? '—' : v > 0 ? v.toFixed(1) : '0');

  const METRICS = {
    temp: {
      tab: '气温',
      title: '整点气温',
      unit: '°C',
      accent: '#d96a1c',
      kind: 'temp',
      bands: TEMP_BANDS,
      value: (c) => c.t,
      format: tempFormat,
      unitShort: '°C',
      mid: '20',
    },
    tmax: {
      tab: '最高温',
      title: '24小时最高温',
      unit: '°C',
      accent: '#d96a1c',
      kind: 'temp',
      bands: TEMP_BANDS,
      value: (c) => c.tmax24,
      format: tempFormat,
      unitShort: '°C',
      mid: '20',
    },
    tmin: {
      tab: '最低温',
      title: '24小时最低温',
      unit: '°C',
      accent: '#d96a1c',
      kind: 'temp',
      bands: TEMP_BANDS,
      value: (c) => c.tmin24,
      format: tempFormat,
      unitShort: '°C',
      mid: '20',
    },
    dtemp: {
      tab: '变温',
      title: '24小时变温',
      unit: '°C',
      accent: '#b04a6b',
      kind: 'dtemp',
      bands: DTEMP_BANDS,
      value: (c) => c.dtemp24,
      format: signedFormat,
      unitShort: '°C',
      mid: '0',
    },
    wind: {
      tab: '风力',
      title: '风力等级',
      unit: '级',
      accent: '#177f86',
      kind: 'wind',
      bands: WIND_BANDS,
      value: (c) => beaufort(c.windSpeed),
      format: (v) => (v == null ? '—' : String(v)),
      unitShort: '级',
      mid: '6',
    },
    rain1h: {
      tab: '1h降水',
      title: '1小时降水',
      unit: 'mm',
      accent: '#1c5fa8',
      kind: 'rain',
      bands: RAIN_BANDS.r1,
      value: (c) => c.rain1h,
      format: rainFormat,
      unitShort: 'mm',
      mid: '5',
    },
    rain6h: {
      tab: '6h降水',
      title: '6小时降水',
      unit: 'mm',
      accent: '#1c5fa8',
      kind: 'rain',
      bands: RAIN_BANDS.r6,
      value: (c) => c.rain6h,
      format: rainFormat,
      unitShort: 'mm',
      mid: '25',
    },
    rain24h: {
      tab: '24h降水',
      title: '24小时降水',
      unit: 'mm',
      accent: '#1c5fa8',
      kind: 'rain',
      bands: RAIN_BANDS.r24,
      value: (c) => c.rain24h,
      format: rainFormat,
      unitShort: 'mm',
      mid: '25',
    },
  };
  const METRIC_ORDER = ['temp', 'tmax', 'tmin', 'dtemp', 'wind', 'rain1h', 'rain6h', 'rain24h'];

  const RANK_PROVINCES = new Set(['广东', '广西', '湖南', '江西', '福建']);
  const RANK_API = {
    temp: { mode: 'hour', path: 'getTemperature', extra: '&type=ET1' },
    dtemp: { mode: 'hour', path: 'getDiffTemperature' },
    tmax: { mode: 'day', path: 'getMaxTemperature' },
    tmin: { mode: 'day', path: 'getMinTemperature' },
  };
  const RANK_CACHE = new Map();
  const RANK_INFLIGHT = new Map();
  let rankSeq = 0;

  function bandColor(metric, v) {
    if (v == null) return '#f1f5f7';
    const bands = metric.bands;
    for (let i = bands.length - 1; i >= 0; i--) {
      if (v >= bands[i].min) return bands[i].color;
    }
    return bands[0].color;
  }

  const state = {
    metric: 'temp',
    data: null,
    zoom: 1,
    detailed: !isMobile(),
    labelsAll: false,
    sheet: null,
    sheetOpenedAt: 0,
    refreshing: false,
    rank: {
      metric: null,
      scope: 'city',
      province: 'all',
      city: [],
      stations: [],
      meta: '',
      source: '',
      loading: true,
      supportsAll: false,
    },
  };

  /* ---------------- icons ---------------- */
  const ICONS = {
    sun: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="6.2" fill="#f6b544"/><g stroke="#f6b544" stroke-width="2.1" stroke-linecap="round"><path d="M16 3.2v3.1M16 25.7v3.1M3.2 16h3.1M25.7 16h3.1M7 7l2.2 2.2M22.8 22.8 25 25M25 7l-2.2 2.2M9.2 22.8 7 25"/></g></svg>',
    partly: '<svg viewBox="0 0 32 32"><circle cx="12" cy="11.5" r="5" fill="#f6b544"/><g stroke="#f6b544" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.6v2.4M3.2 11.5h2.4M6.1 5.6l1.7 1.7M6.1 17.4l1.7-1.7"/></g><path d="M10.5 25.4h12.3a4.6 4.6 0 0 0 .7-9.15A6.6 6.6 0 0 0 10.7 15a4.4 4.4 0 0 0-.2 10.4Z" fill="#d6e4ed"/></svg>',
    cloud: '<svg viewBox="0 0 32 32"><path d="M8.6 25.4h14.2a5.2 5.2 0 0 0 .8-10.3A7.2 7.2 0 0 0 9.2 13.9a5 5 0 0 0-.6 11.5Z" fill="#c8d8e3"/></svg>',
    overcast: '<svg viewBox="0 0 32 32"><path d="M12.5 22.8h11.8a4.3 4.3 0 0 0 .6-8.56 6 6 0 0 0-11.4-1.1 4.2 4.2 0 0 0-1 9.66Z" fill="#b9cad6"/><path d="M7.4 27.4h12.3a4 4 0 0 0 .5-7.96 5.6 5.6 0 0 0-10.6-.9 3.9 3.9 0 0 0-2.2 8.86Z" fill="#d5e2eb"/></svg>',
    shower: '<svg viewBox="0 0 32 32"><circle cx="12" cy="10.8" r="4.2" fill="#f6b544"/><path d="M9.6 21.6h13.1a4.6 4.6 0 0 0 .7-9.15 6.6 6.6 0 0 0-12.5-.8 4.4 4.4 0 0 0-1.3 9.95Z" fill="#cddde8"/><g stroke="#4d9fd6" stroke-width="2" stroke-linecap="round"><path d="M12.6 24.4 11.4 27.6M17 24.4l-1.2 3.2M21.4 24.4 20.2 27.6"/></g></svg>',
    rain: '<svg viewBox="0 0 32 32"><path d="M8.8 21.4h14.4a4.8 4.8 0 0 0 .7-9.55A7 7 0 0 0 9.6 11a4.6 4.6 0 0 0-.8 10.4Z" fill="#c8dae6"/><g stroke="#3f95d3" stroke-width="2.1" stroke-linecap="round"><path d="M11.4 24.2 10.3 28M16 24.2 14.9 28M20.6 24.2 19.5 28"/></g></svg>',
    heavyRain: '<svg viewBox="0 0 32 32"><path d="M8.8 20.4h14.4a4.8 4.8 0 0 0 .7-9.55A7 7 0 0 0 9.6 10a4.6 4.6 0 0 0-.8 10.4Z" fill="#a9c2d3"/><g stroke="#2c7fc4" stroke-width="2.3" stroke-linecap="round"><path d="M10.2 23.2 8.8 28.4M14.8 23.2l-1.4 5.2M19.4 23.2l-1.4 5.2M24 23.2l-1.4 5.2"/></g></svg>',
    thunder: '<svg viewBox="0 0 32 32"><path d="M8.8 19.8h14.4a4.8 4.8 0 0 0 .7-9.55A7 7 0 0 0 9.6 9.4a4.6 4.6 0 0 0-.8 10.4Z" fill="#b3c6d4"/><path d="m17.4 20.4-4.2 6.2h3.2l-1.6 4.4 5-6.4h-3.2l1.8-4.2Z" fill="#f2a63a"/></svg>',
    snow: '<svg viewBox="0 0 32 32"><path d="M8.8 20.6h14.4a4.8 4.8 0 0 0 .7-9.55A7 7 0 0 0 9.6 10.2a4.6 4.6 0 0 0-.8 10.4Z" fill="#d2e2ec"/><g fill="#7fb9de"><circle cx="11.6" cy="24.6" r="1.5"/><circle cx="16" cy="27.2" r="1.5"/><circle cx="20.4" cy="24.6" r="1.5"/><circle cx="16" cy="22.6" r="1.2"/></g></svg>',
    sleet: '<svg viewBox="0 0 32 32"><path d="M8.8 20.2h14.4a4.8 4.8 0 0 0 .7-9.55A7 7 0 0 0 9.6 9.8a4.6 4.6 0 0 0-.8 10.4Z" fill="#cddfe9"/><g stroke="#4d9fd6" stroke-width="1.9" stroke-linecap="round"><path d="M11.6 23.4v3.8M9.8 25.3h3.6"/></g><circle cx="19.4" cy="25.4" r="1.5" fill="#8cc3e3"/><circle cx="22.6" cy="27.6" r="1.2" fill="#8cc3e3"/></svg>',
    fog: '<svg viewBox="0 0 32 32"><path d="M8.8 18.8h14.4a4.8 4.8 0 0 0 .7-9.55A7 7 0 0 0 9.6 8.4a4.6 4.6 0 0 0-.8 10.4Z" fill="#cfdde7"/><g stroke="#a2b6c4" stroke-width="2" stroke-linecap="round"><path d="M7 22.6h18M9.4 26.4h14M7.8 30h17"/></g></svg>',
    haze: '<svg viewBox="0 0 32 32"><circle cx="13" cy="11.6" r="4.8" fill="#e8c98a"/><g stroke="#c8b493" stroke-width="1.9" stroke-linecap="round"><path d="M5.2 20.4h20M8 24.2h15M5.8 28h17"/></g></svg>',
    dust: '<svg viewBox="0 0 32 32"><g stroke="#c9a978" stroke-width="1.9" stroke-linecap="round"><path d="M5 12.4h20M8 16.6h15M4.6 20.8h19M8.4 25h15"/></g><g fill="#c9a978"><circle cx="9" cy="8.4" r="1.2"/><circle cx="17" cy="9.6" r="1"/><circle cx="24" cy="7.8" r="1.1"/></g></svg>',
  };

  const IMG_KEY = {
    0: 'sun', 1: 'partly', 2: 'overcast', 3: 'shower', 4: 'thunder', 5: 'thunder', 6: 'sleet',
    7: 'rain', 8: 'rain', 9: 'rain', 10: 'heavyRain', 11: 'heavyRain', 12: 'heavyRain',
    13: 'snow', 14: 'snow', 15: 'snow', 16: 'snow', 17: 'snow', 18: 'fog', 19: 'sleet',
    20: 'dust', 21: 'rain', 22: 'rain', 23: 'heavyRain', 24: 'heavyRain', 25: 'heavyRain',
    26: 'snow', 27: 'snow', 28: 'snow', 29: 'dust', 30: 'dust', 31: 'dust', 53: 'haze', 99: 'cloud',
  };

  function iconKey(imgCode, text) {
    const code = Number(imgCode);
    if (IMG_KEY[code]) return IMG_KEY[code];
    const t = text || '';
    if (t.includes('雷')) return 'thunder';
    if (t.includes('雪')) return t.includes('雨') ? 'sleet' : 'snow';
    if (t.includes('雨')) return t.includes('大雨') || t.includes('暴雨') ? 'heavyRain' : 'rain';
    if (t.includes('雾')) return 'fog';
    if (t.includes('霾') || t.includes('沙') || t.includes('尘')) return 'haze';
    if (t.includes('阴')) return 'overcast';
    if (t.includes('云')) return 'partly';
    if (t.includes('晴')) return 'sun';
    return 'partly';
  }
  const iconSvg = (code, text) => ICONS[iconKey(code, text)] || ICONS.partly;

  /* ---------------- legend ---------------- */
  function renderTabs() {
    const radarBtn =
      '<button class="tab tab-radar" type="button" data-action="radar" aria-label="打开雷达拼图">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="4.6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 12l6-4.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/></svg>雷达</button>';
    $('#metricTabs').innerHTML =
      METRIC_ORDER.map(
        (k) =>
          `<button class="tab${k === state.metric ? ' active' : ''}" data-metric="${k}" role="tab" aria-selected="${k === state.metric}" type="button">${METRICS[k].tab}</button>`
      ).join('') + radarBtn;
  }

  function renderLegend() {
    const m = METRICS[state.metric];
    const legend = $('#legend');
    if (isMobile()) {
      const mid = m.bands[Math.floor(m.bands.length / 2)];
      legend.innerHTML = `<div class="legend-h">
        <div class="legend-h-head"><span>单位：${m.unit}</span><span>低 → 高</span></div>
        <div class="legend-h-bar">${m.bands.map((b) => `<i style="background:${b.color}"></i>`).join('')}</div>
        <div class="legend-h-ticks"><span>${m.bands[0].label}</span><span>${m.mid || mid.label}</span><span>${m.bands[m.bands.length - 1].label}</span></div>
      </div>`;
    } else {
      legend.innerHTML = `<span class="legend-unit">单位：${m.unit}</span>
        <div class="legend-bands">${[...m.bands]
          .reverse()
          .map((b) => `<div class="legend-row"><span class="legend-sw" style="background:${b.color}"></span><span class="legend-label">${b.label}</span></div>`)
          .join('')}</div>`;
    }
  }

  /* ---------------- chart ---------------- */
  const mapEl = $('#map');
  let chart = null;

  const geoJSON = {
    type: 'FeatureCollection',
    features: [...MAP.cities.features, ...MAP.neighbours.features],
  };
  echarts.registerMap('south-china', geoJSON);

  function cityRegions() {
    const m = METRICS[state.metric];
    const items = [];
    CITY_BY_ADCODE.forEach((city, ad) => {
      const w = state.data.cities[ad];
      const v = w ? m.value(w) : null;
      const color = bandColor(m, v);
      items.push({
        name: city.name,
        itemStyle: { areaColor: color, borderColor: '#a9b6c0', borderWidth: 0.55 },
      });
    });
    return items;
  }

  function currentGeoZoom() {
    if (!chart) return 1;
    const opt = chart.getOption();
    return (opt.geo && opt.geo[0] && opt.geo[0].zoom) || 1;
  }

  function labelLayoutForZoom(zoom) {
    // At low zoom overlap hiding avoids clutter; once zoomed in there is room
    // for every visible city, so keep all labels instead of hiding most of them.
    return { hideOverlap: zoom < 2, moveOverlap: 'none' };
  }

  function labelSeriesData() {
    const m = METRICS[state.metric];
    const mobile = isMobile();
    const items = [];
    CITY_BY_ADCODE.forEach((city, ad) => {
      if (CAPITALS.has(ad)) return;
      const w = state.data.cities[ad];
      const v = w ? m.value(w) : null;
      items.push({
        name: city.name,
        value: city.center,
        adcode: ad,
        short: city.short,
        mv: m.format(v),
        detailed: state.detailed,
        mobile,
        label: { position: state.detailed ? (ad % 2 ? 'bottom' : 'top') : 'bottom' },
      });
    });
    return items;
  }

  function capSeriesData() {
    const m = METRICS[state.metric];
    const items = [];
    CAPITALS.forEach((ad) => {
      const city = CITY_BY_ADCODE.get(ad);
      if (!city) return;
      const w = state.data.cities[ad];
      const v = w ? m.value(w) : null;
      items.push({
        name: city.name,
        value: city.center,
        adcode: ad,
        short: city.short,
        mv: m.format(v),
        label: { position: 'top' },
      });
    });
    return items;
  }

  function labelRich() {
    const accent = METRICS[state.metric].accent;
    const mobile = isMobile();
    return {
      v: {
        fontSize: mobile ? 11.5 : 11.5,
        fontWeight: 700,
        color: accent,
        lineHeight: mobile ? 13.5 : 14,
        textBorderColor: 'rgba(255,255,255,.92)',
        textBorderWidth: 2.5,
      },
      n: {
        fontSize: 10.5,
        fontWeight: 600,
        color: '#3f5563',
        lineHeight: mobile ? 12 : 12.5,
        textBorderColor: 'rgba(255,255,255,.92)',
        textBorderWidth: 2.5,
      },
      vCap: {
        fontSize: mobile ? 12.5 : 13,
        fontWeight: 800,
        color: accent,
        lineHeight: mobile ? 14 : 15,
        textBorderColor: 'rgba(255,255,255,.95)',
        textBorderWidth: 3,
      },
      nCap: {
        fontSize: mobile ? 11 : 11.5,
        fontWeight: 700,
        color: '#223c4b',
        lineHeight: mobile ? 12.5 : 13,
        textBorderColor: 'rgba(255,255,255,.95)',
        textBorderWidth: 3,
      },
    };
  }

  function labelFormatter(p) {
    const d = p.data;
    if (!d) return '';
    if (d.mobile && !d.detailed) return '';
    return d.detailed ? `{v|${d.mv}}\n{n|${d.short}}` : `{n|${d.short}}`;
  }

  function capFormatter(p) {
    const d = p.data;
    if (!d) return '';
    return `{vCap|${d.mv}}\n{nCap|${d.short}}`;
  }

  const neighbourLabels = MAP.neighbours.features
    .map((f) => {
      const name = (f.properties.name || '').replace(/^邻-/, '').replace(/(省|市|壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区)$/, '');
      const c = f.properties.center;
      if (!c || !c[0]) return null;
      if (c[0] < bbox[0] - 0.8 || c[0] > bbox[2] + 0.8 || c[1] < bbox[1] - 0.8 || c[1] > bbox[3] + 0.8) return null;
      if (name.includes('香港') || name.includes('澳门')) return null;
      return { name, value: c };
    })
    .filter(Boolean);

  function buildOption() {
    return {
      animationDuration: 600,
      animationDurationUpdate: 0,
      tooltip: {
        trigger: 'item',
        show: !isMobile(),
        triggerOn: isMobile() ? 'click' : 'mousemove|click',
        backgroundColor: 'rgba(255,255,255,.97)',
        borderColor: 'rgba(20,60,80,.08)',
        borderWidth: 1,
        padding: 12,
        textStyle: { color: '#14303f', fontSize: 12 },
        extraCssText: 'box-shadow:0 16px 40px rgba(16,60,90,.18);border-radius:13px;',
        formatter: tooltipFormatter,
      },
      geo: {
        map: 'south-china',
        roam: true,
        scaleLimit: { min: 0.9, max: 8 },
        boundingCoords: [[bbox[0], bbox[3]], [bbox[2], bbox[1]]],
        center: INITIAL_CENTER,
        zoom: 1,
        silent: false,
        itemStyle: { areaColor: '#ffffff', borderColor: '#c9d5dd', borderWidth: 0.6 },
        regions: cityRegions(),
        tooltip: { show: true, trigger: 'item', formatter: tooltipFormatter },
        emphasis: { disabled: true },
        cursor: 'pointer',
        z: 1,
      },
      series: [
        {
          id: 'borders',
          type: 'lines',
          coordinateSystem: 'geo',
          geoIndex: 0,
          polyline: true,
          silent: true,
          z: 3,
          lineStyle: { color: 'rgba(58,82,96,.6)', width: 1.1 },
          data: MAP.borders.flatMap((b) => b.rings.map((r) => ({ coords: r }))),
        },
        {
          id: 'provinceLabels',
          type: 'scatter',
          coordinateSystem: 'geo',
          geoIndex: 0,
          silent: true,
          z: 1.5,
          symbolSize: 0,
          label: {
            show: true,
            position: 'inside',
            formatter: (p) => p.name,
            color: 'rgba(96,112,122,.55)',
            fontSize: isMobile() ? 11 : 19,
            fontWeight: 600,
          },
          data: neighbourLabels,
        },
        {
          id: 'labels',
          type: 'scatter',
          coordinateSystem: 'geo',
          geoIndex: 0,
          silent: true,
          z: 4,
          symbol: 'circle',
          symbolSize: 3.2,
          itemStyle: { color: '#ffffff', borderColor: 'rgba(52,72,85,.62)', borderWidth: 1 },
          label: {
            show: true,
            distance: 2,
            formatter: labelFormatter,
            rich: labelRich(),
          },
          labelLayout: labelLayoutForZoom(1),
          emphasis: { scale: 1.8 },
          cursor: 'pointer',
          tooltip: { show: true },
          data: labelSeriesData(),
        },
        {
          id: 'capLabels',
          type: 'scatter',
          coordinateSystem: 'geo',
          geoIndex: 0,
          silent: true,
          z: 5,
          symbol: 'circle',
          symbolSize: 4.4,
          itemStyle: { color: '#ffffff', borderColor: 'rgba(40,64,80,.7)', borderWidth: 1.2 },
          label: {
            show: true,
            distance: 2,
            formatter: capFormatter,
            rich: labelRich(),
          },
          emphasis: { scale: 1.8 },
          cursor: 'pointer',
          tooltip: { show: true },
          data: capSeriesData(),
        },
      ],
    };
  }

  function tooltipFormatter(p) {
    const d = p.data;
    const city = (d && d.adcode && CITY_BY_ADCODE.get(d.adcode)) || CITY_BY_NAME.get(p.name);
    if (!city) return '';
    const ad = city.adcode;
    const w = state.data.cities[ad];
    const m = METRICS[state.metric];
    const v = w ? m.value(w) : null;
    const valueText = v == null ? '—' : m.format(v);
    const sub = w
      ? `${weatherText(w) || '天气实况'} · 湿度 ${w.rh == null ? '—' : w.rh + '%'} · ${w.windDir || ''}${beaufort(w.windSpeed) == null ? '' : beaufort(w.windSpeed) + '级'}`
      : '暂无实况';
    return `<div class="tt">
      <div class="tt-head"><strong>${city.short}</strong><span>${city.province}</span></div>
      <div class="tt-value" style="color:${m.accent}">${valueText}<small>${m.unitShort}</small></div>
      <div class="tt-sub">${sub}</div>
      <div class="tt-tip">点击进入气象台</div>
    </div>`;
  }

  function fitMap() {
    if (!chart) return;
    if (isMobile()) {
      mapEl.style.width = '';
      mapEl.style.height = '';
      chart.resize();
      return;
    }
    const wrap = $('#mapCanvas');
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (!w || !h) return;
    let mw = w;
    let mh = w / ASPECT;
    if (mh > h) {
      mh = h;
      mw = h * ASPECT;
    }
    mapEl.style.width = `${Math.floor(mw)}px`;
    mapEl.style.height = `${Math.floor(mh)}px`;
    if (chart) chart.resize();
  }

  function refreshLabels() {
    if (!chart) return;
    const zoom = currentGeoZoom();
    chart.setOption({
      geo: { regions: cityRegions() },
      series: [
        { id: 'labels', data: labelSeriesData(), label: { rich: labelRich() }, labelLayout: labelLayoutForZoom(zoom) },
        { id: 'capLabels', data: capSeriesData(), label: { rich: labelRich() } },
      ],
    });
  }

  let labelDensityTimer = null;

  function scheduleLabelDensity(delay = 220) {
    clearTimeout(labelDensityTimer);
    labelDensityTimer = setTimeout(updateLabelDensity, delay);
  }

  function updateLabelDensity() {
    if (!chart) return;
    const zoom = currentGeoZoom();
    const detailed = isMobile() ? zoom >= 1.3 : true;
    const labelsAll = zoom >= 2;
    state.zoom = zoom;
    if (detailed === state.detailed && labelsAll === state.labelsAll) return;
    state.detailed = detailed;
    state.labelsAll = labelsAll;
    chart.setOption({
      series: [
        { id: 'labels', data: labelSeriesData(), label: { rich: labelRich() }, labelLayout: labelLayoutForZoom(zoom) },
        { id: 'capLabels', data: capSeriesData(), label: { rich: labelRich() } },
      ],
    });
  }

  function renderHint() {
    $('#mapHint').textContent = isMobile() ? '双指缩放 · 点击城市进入气象台' : '滚轮缩放 · 拖动平移 · 点击城市进入气象台';
  }

  function renderOverview() {
    const el = $('#overview');
    if (!el) return;
    const m = METRICS[state.metric];
    const cards = MAP.provinces
      .map((p) => {
        const rows = p.cities.map((c) => state.data.cities[c.adcode]).filter(Boolean);
        const levels = rows.map((r) => beaufort(r.windSpeed)).filter((v) => v != null);
        const rain24 = rows.map((r) => r.rain24h).filter((v) => v != null);
        const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
        const vals = rows.map((r) => m.value(r)).filter((v) => v != null);
        const avgT = avg(rows.map((r) => r.t).filter((v) => v != null));
        const avgW = avg(levels);
        const maxW = levels.length ? Math.max(...levels) : null;
        const maxP = rain24.length ? Math.max(...rain24) : null;
        const sumRain = m.kind === 'rain' ? vals.reduce((x, y) => x + y, 0) : rain24.reduce((x, y) => x + y, 0);
        const rainCities = rain24.filter((v) => v > 0.05).length;
        const alerts = rows.filter((r) => r.alert).length;
        let main = '—';
        let label = '';
        if (m.kind === 'rain') {
          main = `${sumRain.toFixed(1)}mm`;
          label = '累计降水';
        } else if (m.kind === 'wind') {
          main = avgW == null ? '—' : `${avgW.toFixed(1)}级`;
          label = '平均风力';
        } else if (m.kind === 'dtemp') {
          const avgD = avg(vals);
          main = avgD == null ? '—' : `${avgD > 0 ? '+' : ''}${avgD.toFixed(1)}°`;
          label = '平均变温';
        } else {
          const avgV = avg(vals);
          main = avgV == null ? '—' : `${avgV.toFixed(1)}°`;
          label = state.metric === 'tmax' ? '平均最高' : state.metric === 'tmin' ? '平均最低' : '均温';
        }
        let sub;
        if (m.kind === 'rain') {
          sub = `最多 <b>${maxP == null ? '—' : maxP.toFixed(1)} mm</b> · 均温 ${avgT == null ? '—' : avgT.toFixed(0)}°`;
        } else if (m.kind === 'dtemp') {
          const maxIn = vals.length ? Math.max(...vals) : null;
          const minIn = vals.length ? Math.min(...vals) : null;
          sub = `升温 <b>${maxIn == null ? '—' : `${maxIn > 0 ? '+' : ''}${maxIn.toFixed(1)}°`}</b> · 降温 <b>${minIn == null ? '—' : `${minIn.toFixed(1)}°`}</b>`;
        } else {
          sub = `最大 <b>${maxW == null ? '—' : maxW} 级</b> · <b>${rainCities}</b> 市有雨`;
        }
        return `<div class="prov-card" role="button" tabindex="0" data-province="${p.adcode}">
          <span class="prov-top"><b>${p.name}</b><span>${p.cities.length} 市</span>${alerts ? `<span class="alert">预警 ${alerts}</span>` : ''}<button class="prov-radar" type="button" data-radar-prov="${p.name}" aria-label="查看${p.name}雷达">雷达</button></span>
          <span class="prov-main"><strong>${main}</strong><span>${label}</span></span>
          <span class="prov-sub">${sub}</span>
        </div>`;
      })
      .join('');
    el.innerHTML = `<h2>五省概览</h2><p class="ov-hint">点击省份可放大地图 · 点“雷达”看本省回波 · 数值为各市站点统计</p><div class="grid">${cards}</div>`;
    $$('.prov-card', el).forEach((card) => {
      card.addEventListener('click', (e) => {
        const rb = e.target.closest('.prov-radar');
        if (rb) {
          e.stopPropagation();
          openRadarForProvince(rb.dataset.radarProv);
          return;
        }
        zoomToProvince(Number(card.dataset.province));
      });
      card.addEventListener('keydown', (e) => {
        if (e.target.closest('.prov-radar')) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          zoomToProvince(Number(card.dataset.province));
        }
      });
    });
  }

  function zoomToProvince(adcode) {
    if (!chart) return;
    const prov = MAP.provinces.find((p) => p.adcode === adcode);
    if (!prov) return;
    const lons = prov.cities.map((c) => c.center[0]);
    const lats = prov.cities.map((c) => c.center[1]);
    const west = Math.min(...lons) - 0.2;
    const east = Math.max(...lons) + 0.2;
    const south = Math.min(...lats) - 0.2;
    const north = Math.max(...lats) + 0.2;
    const zoom = Math.min((bbox[2] - bbox[0]) / (east - west), (bbox[3] - bbox[1]) / (north - south)) * 0.8;
    chart.setOption({ geo: { center: [(west + east) / 2, (south + north) / 2], zoom: Math.max(1.3, Math.min(5, zoom)) } });
    setTimeout(updateLabelDensity, 80);
    const canvas = $('#mapCanvas');
    if (canvas) canvas.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ---------------- ranking ---------------- */
  const rankSheetEl = $('#rankSheet');

  function shanghaiStamp(offsetHours = 0) {
    const d = new Date(Date.now() + 8 * 3600e3 + offsetHours * 3600e3);
    const iso = d.toISOString();
    return { ymd: iso.slice(0, 10).replace(/-/g, ''), ymdh: iso.slice(0, 13).replace(/[-T]/g, '') };
  }

  async function fetchRankJson(url, ms = 8000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchRankRaw(metric, force) {
    if (RANK_INFLIGHT.has(metric)) return RANK_INFLIGHT.get(metric);
    const job = (async () => {
      const cfg = RANK_API[metric];
      const cached = RANK_CACHE.get(metric);
      if (!force && cached && Date.now() - cached.ts < 8 * 60 * 1000) return cached.value;
      const offsets = cfg.mode === 'hour' ? [0, 1, 2] : [1, 2, 3];
      for (const off of offsets) {
        const stamp = shanghaiStamp(cfg.mode === 'hour' ? -off : -off * 24);
        const url =
          cfg.mode === 'hour'
            ? `https://www.nmc.cn/rest/wxapi/${cfg.path}?ymdh=${stamp.ymdh}${cfg.extra || ''}`
            : `https://www.nmc.cn/rest/wxapi/${cfg.path}?ymd=${stamp.ymd}`;
        try {
          const json = await fetchRankJson(url);
          const data = json && json.data;
          if (!data || !Array.isArray(data.stations) || !data.stations.length) continue;
          const value = {
            formatTime: data.formatTime || '',
            time: data.time || stamp.ymdh,
            stations: data.stations.filter(
              (s) => RANK_PROVINCES.has(s[0]) && typeof s[5] === 'number' && s[5] > -99 && s[5] !== 9999
            ),
          };
          if (!value.stations.length) continue;
          RANK_CACHE.set(metric, { ts: Date.now(), value });
          return value;
        } catch (e) {
          /* try previous slot */
        }
      }
      throw new Error('rank unavailable');
    })();
    RANK_INFLIGHT.set(metric, job);
    try {
      return await job;
    } finally {
      RANK_INFLIGHT.delete(metric);
    }
  }

  async function prefetchRanks() {
    for (const m of ['dtemp', 'tmax', 'tmin']) {
      try {
        await fetchRankRaw(m);
      } catch (e) {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 700));
    }
  }

  function prettyRankTime(t) {
    const text = String(t || "");
    return /^d{4}年d{1,2}月d{1,2}$/.test(text) ? `${text}日` : text;
  }

  function rankCityRows(stations) {
    const norm = (s) => String(s || '').replace(/(市|地区|自治州|盟)$/, '');
    const byName = new Map();
    stations.forEach((s) => {
      const key = s[0] + '|' + norm(s[1]);
      if (!byName.has(key)) byName.set(key, s);
    });
    const rows = [];
    CITY_BY_ADCODE.forEach((city, ad) => {
      let hit = byName.get(city.province + '|' + norm(city.short)) || byName.get(city.province + '|' + norm(city.name));
      let dist = 0;
      if (!hit) {
        let best = Infinity;
        stations.forEach((s) => {
          if (s[0] !== city.province) return;
          const dx = (s[3] - city.center[0]) * 0.9;
          const dy = s[4] - city.center[1];
          const d = Math.hypot(dx, dy);
          if (d < best) {
            best = d;
            hit = s;
          }
        });
        dist = best;
      }
      if (!hit || dist > 0.5) return;
      rows.push({ adcode: ad, city: city.short, province: city.province, station: hit[1], value: hit[5], near: dist });
    });
    return rows.sort((a, b) => b.value - a.value);
  }

  function localRankRows(metric) {
    const m = METRICS[metric];
    const rows = [];
    CITY_BY_ADCODE.forEach((city, ad) => {
      const w = state.data.cities[ad];
      if (!w) return;
      const v = m.value(w);
      if (v == null) return;
      rows.push({ adcode: ad, city: city.short, province: city.province, station: w.stationName || '', value: v, near: 0 });
    });
    return rows.sort((a, b) => b.value - a.value);
  }

  function rankBarWidth(v, min, max) {
    if (!(max > min)) return 55;
    return Math.max(4, Math.min(100, ((v - min) / (max - min)) * 100));
  }

  function rankRowHtml(row, idx, min, max, metric, opts = {}) {
    const m = METRICS[metric];
    const isStation = !!opts.station;
    const clickable = !isStation && row.adcode;
    const name = isStation ? row.name : row.city;
    const extra = !isStation && row.near > 0.05 ? `<i>${row.station}站</i>` : '';
    const title = !isStation && row.near > 0.05 ? ` title="数值取自最近国家站：${row.station}"` : '';
    return `<li class="rank-row${idx < 3 ? ' top' : ''}${clickable ? '' : ' static'}"${clickable ? ` data-ad="${row.adcode}"` : ''}${title}>
      <span class="rk">${idx + 1}</span>
      <span class="rn"><b>${name}</b><i>${row.province}</i>${extra}</span>
      <span class="rv" style="color:${m.accent}">${m.format(row.value)}<small>${m.unitShort}</small></span>
      <span class="rbar" style="width:${rankBarWidth(row.value, min, max).toFixed(1)}%;background:${m.accent}"></span>
    </li>`;
  }

  function rankingRows(scope) {
    const all = scope === 'station' ? state.rank.stations : state.rank.city;
    return state.rank.province === 'all' ? all : all.filter((r) => r.province === state.rank.province);
  }

  function renderRankChips() {
    const chips = [{ key: 'all', label: '全部' }, ...MAP.provinces.map((p) => ({ key: p.name, label: p.name }))];
    const html = chips
      .map(
        (c) =>
          `<button type="button" class="rank-chip${state.rank.province === c.key ? ' active' : ''}" data-prov="${c.key}">${c.label}</button>`
      )
      .join('');
    ['#rankChips', '#rankChipsSheet'].forEach((sel) => {
      const el = $(sel);
      if (el) el.innerHTML = html;
    });
  }

  function renderRankCard() {
    const metric = state.rank.metric || state.metric;
    const m = METRICS[metric];
    $('#rankTitle').textContent = m.title;
    renderRankChips();
    const filtered = rankingRows('city');
    const baseMeta = state.rank.meta || '加载中…';
    $('#rankMeta').textContent =
      state.rank.loading || state.rank.province === 'all'
        ? baseMeta
        : `${baseMeta} · ${state.rank.province} ${filtered.length} 城`;
    const list = $('#rankList');
    const openBtn = $('#rankOpen');
    if (state.rank.loading) {
      list.innerHTML = '<div class="rank-skeleton"></div>'.repeat(6);
      openBtn.textContent = '加载中…';
      openBtn.disabled = true;
      return;
    }
    openBtn.disabled = false;
    const rows = filtered.slice(0, 10);
    if (!rows.length) {
      list.innerHTML = '<li class="rank-empty">该省份暂无排行数据</li>';
      openBtn.textContent = '查看完整排行';
      return;
    }
    const vals = filtered.map((r) => r.value);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    list.innerHTML = rows.map((r, i) => rankRowHtml(r, i, min, max, metric)).join('');
    openBtn.textContent = `查看全部 ${filtered.length} 城`;
  }

  async function loadRanking(metric, force = false) {
    if (!METRICS[metric]) return;
    const seq = ++rankSeq;
    const keepScope = state.rank.scope;
    const keepProvince = state.rank.province || 'all';
    state.rank.metric = metric;
    if (!RANK_API[metric]) {
      const city = localRankRows(metric);
      state.rank = {
        metric,
        scope: 'city',
        province: keepProvince,
        city,
        stations: [],
        meta: `${fmtTime(state.data.fetchedAt) || '—'} 实况 · 本站 ${city.length} 城统计`,
        source: 'local',
        loading: false,
        supportsAll: false,
      };
      renderRankCard();
      if (rankSheetEl.classList.contains('open')) renderRankSheet();
      return;
    }
    state.rank = { ...state.rank, metric, loading: true, meta: '正在获取中央气象台排行…' };
    renderRankCard();
    if (rankSheetEl.classList.contains('open')) renderRankSheet();
    try {
      const raw = await fetchRankRaw(metric, force);
      if (seq !== rankSeq) return;
      const city = rankCityRows(raw.stations);
      const stations = raw.stations
        .map((s) => ({ province: s[0], name: s[1], value: s[5], lon: s[3], lat: s[4], id: s[2] }))
        .sort((a, b) => b.value - a.value);
      state.rank = {
        metric,
        scope: keepScope === 'station' ? 'station' : 'city',
        province: keepProvince,
        city,
        stations,
        meta: `${prettyRankTime(raw.formatTime || raw.time)} · ${metric === "tmax" || metric === "tmin" ? "官方日极值" : "中央气象台官方排行"}`,
        source: 'api',
        loading: false,
        supportsAll: stations.length > 0,
      };
    } catch (e) {
      if (seq !== rankSeq) return;
      const city = localRankRows(metric);
      state.rank = {
        metric,
        scope: 'city',
        province: keepProvince,
        city,
        stations: [],
        meta: `${fmtTime(state.data.fetchedAt) || '—'} · 排行接口暂不可用，改用本站统计`,
        source: 'local',
        loading: false,
        supportsAll: false,
      };
    }
    renderRankCard();
    if (rankSheetEl.classList.contains('open')) renderRankSheet();
  }

  function openRankSheet() {
    if (!state.rank.metric) loadRanking(state.metric);
    if (state.rank.scope === 'station' && !state.rank.supportsAll) state.rank.scope = 'city';
    rankSheetEl.classList.add('open');
    rankSheetEl.setAttribute('aria-hidden', 'false');
    syncBodyLock();
    const input = $('#rankSearch');
    if (input) input.value = '';
    renderRankSheet();
  }

  function closeRankSheet() {
    rankSheetEl.classList.remove('open');
    rankSheetEl.setAttribute('aria-hidden', 'true');
    syncBodyLock();
  }

  function renderRankSheet() {
    const metric = state.rank.metric || state.metric;
    const m = METRICS[metric];
    const scope = state.rank.scope === 'station' && state.rank.supportsAll ? 'station' : 'city';
    state.rank.scope = scope;
    renderRankChips();
    const provinceLabel = state.rank.province === 'all' ? '五省' : state.rank.province;
    $('#rankSheetTitle').textContent = `${provinceLabel}${scope === 'station' ? '站点' : '城市'}排行 · ${m.title}`;
    $('#rankUpdated').textContent = state.rank.source === 'api' ? '中央气象台' : '本站统计';
    const cityCount = rankingRows('city').length;
    const stationCount = rankingRows('station').length;
    $$('#rankScope button').forEach((b) => {
      b.classList.toggle('active', b.dataset.scope === scope);
      if (b.dataset.scope === 'station') {
        b.disabled = !state.rank.supportsAll;
        b.textContent = state.rank.supportsAll ? `${stationCount} 站` : '全部站';
      } else {
        b.textContent = `${cityCount} 城`;
      }
    });
    const list = $('#rankFull');
    const meta = $('#rankSheetMeta');
    if (state.rank.loading) {
      list.innerHTML = '<div class="rank-skeleton"></div>'.repeat(8);
      meta.textContent = '正在获取中央气象台排行…';
      return;
    }
    const key = ($('#rankSearch').value || '').trim();
    if (scope === 'station') {
      const all = rankingRows('station');
      const rows = key ? all.filter((r) => (r.name + r.province).includes(key)) : all;
      const vals = all.map((r) => r.value);
      const min = vals.length ? Math.min(...vals) : 0;
      const max = vals.length ? Math.max(...vals) : 1;
      meta.textContent = `${state.rank.meta} · ${provinceLabel} 共 ${all.length} 站${key ? ` · 筛选 ${rows.length}` : ''}`;
      list.innerHTML = rows.length
        ? rows.map((r, i) => rankRowHtml(r, i, min, max, metric, { station: true })).join('')
        : '<li class="rank-empty">未找到匹配的站点</li>';
    } else {
      const all = rankingRows('city');
      const rows = key ? all.filter((r) => (r.city + r.province).includes(key)) : all;
      const vals = all.map((r) => r.value);
      const min = vals.length ? Math.min(...vals) : 0;
      const max = vals.length ? Math.max(...vals) : 1;
      meta.textContent = `${state.rank.meta} · ${provinceLabel} 共 ${all.length} 城${key ? ` · 筛选 ${rows.length}` : ''}`;
      list.innerHTML = rows.length
        ? rows.map((r, i) => rankRowHtml(r, i, min, max, metric)).join('')
        : '<li class="rank-empty">未找到匹配的城市</li>';
    }
  }

  /* ---------------- radar ---------------- */
  const radarSheetEl = $('#radarSheet');
  const radarStage = $('#radarStage');
  const RADAR_PAD = 12;
  const RADAR_PRODUCTS = {
    nation: {
      code: 'ACHN',
      count: 12,
      crop: { x: 650, y: 675, w: 505, h: 403 },
      label: '全国雷达拼图 · 五省视图',
    },
    south: {
      code: 'ASCN',
      count: 16,
      crop: null,
      label: '华南区域雷达拼图',
    },
    huazhong: {
      code: 'ACCN',
      count: 12,
      crop: null,
      label: '华中地区雷达拼图',
    },
    huadong: {
      code: 'AECN',
      count: 12,
      crop: null,
      label: '华东地区雷达拼图',
    },
  };
  const RADAR_PROVINCE_MODE = {
    广东: 'south',
    广西: 'south',
    海南: 'south',
    湖南: 'huazhong',
    江西: 'huazhong',
    福建: 'huadong',
  };
  const radarCache = Object.fromEntries(Object.keys(RADAR_PRODUCTS).map((k) => [k, { frames: [], loadedAt: 0 }]));
  const radarState = {
    mode: 'nation',
    frames: [],
    index: -1,
    playing: false,
    timer: null,
    loading: false,
    view: null,
    seq: 0,
  };

  const pad2 = (n) => String(n).padStart(2, '0');

  function radarSlots(count, code) {
    const base = new Date(Date.now() - 6 * 60e3);
    base.setUTCSeconds(0, 0);
    base.setUTCMinutes(Math.floor(base.getUTCMinutes() / 6) * 6);
    const slots = [];
    for (let i = 0; i < count; i++) {
      const t = new Date(base.getTime() - i * 6 * 60e3);
      const y = t.getUTCFullYear();
      const m = pad2(t.getUTCMonth() + 1);
      const d = pad2(t.getUTCDate());
      const stamp = `${y}${m}${d}${pad2(t.getUTCHours())}${pad2(t.getUTCMinutes())}00`;
      slots.push({
        time: t.getTime(),
        url: `https://image.nmc.cn/product/${y}/${m}/${d}/RDCP/SEVP_AOC_RDCP_SLDAS3_ECREF_${code}_L88_PI_${stamp}000.PNG`,
      });
    }
    return slots;
  }

  function fmtRadarTime(ms) {
    const iso = new Date(ms + 8 * 3600e3).toISOString();
    return `${iso.slice(5, 7)}/${iso.slice(8, 10)} ${iso.slice(11, 16)}`;
  }

  function loadRadarImage(url, ms = 15000) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const timer = setTimeout(() => {
        img.src = '';
        reject(new Error('timeout'));
      }, ms);
      img.onload = () => {
        clearTimeout(timer);
        resolve(img);
      };
      img.onerror = () => {
        clearTimeout(timer);
        reject(new Error('load error'));
      };
      img.src = url;
    });
  }

  function radarPlayLabel(playing) {
    const btn = $('#radarPlay');
    btn.textContent = playing ? '❚❚' : '▶';
    btn.setAttribute('aria-label', playing ? '暂停雷达动画' : '播放雷达动画');
  }

  function stopRadarPlay() {
    radarState.playing = false;
    if (radarState.timer) clearInterval(radarState.timer);
    radarState.timer = null;
    radarPlayLabel(false);
  }

  function renderRadarThumbs() {
    const el = $('#radarThumbs');
    if (!el) return;
    el.innerHTML = radarState.frames
      .map(
        (f, i) =>
          `<button class="radar-thumb" type="button" data-index="${i}"><img src="${f.url}" alt="${fmtRadarTime(f.time)}" loading="lazy" /><span>${fmtRadarTime(f.time).slice(6)}</span></button>`
      )
      .join('');
  }

  function renderRadarFrame(i) {
    const n = radarState.frames.length;
    if (!n) return;
    const idx = Math.max(0, Math.min(n - 1, i));
    const f = radarState.frames[idx];
    radarState.index = idx;
    const img = $('#radarImg');
    if (img.getAttribute('src') !== f.url) img.src = f.url;
    $('#radarTime').textContent = fmtRadarTime(f.time);
    $('#radarSlider').value = idx;
    $('#radarCount').textContent = `${idx + 1} / ${n}`;
    $$('#radarThumbs .radar-thumb').forEach((tb, ti) => tb.classList.toggle('active', ti === idx));
    const strip = $('#radarThumbs');
    const active = strip && strip.querySelector('.radar-thumb.active');
    if (active && strip.offsetParent !== null) {
      const left = active.offsetLeft;
      const right = left + active.offsetWidth;
      if (left < strip.scrollLeft) strip.scrollLeft = Math.max(0, left - 8);
      else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth + 8;
    }
  }

  function toggleRadarPlay() {
    if (radarState.frames.length < 2) return;
    if (radarState.playing) {
      stopRadarPlay();
      return;
    }
    radarState.playing = true;
    radarPlayLabel(true);
    if (radarState.index >= radarState.frames.length - 1) renderRadarFrame(0);
    radarState.timer = setInterval(() => {
      renderRadarFrame((radarState.index + 1) % radarState.frames.length);
    }, 700);
  }

  /* ----- radar pan / zoom ----- */
  function updateRadarClip() {
    const img = $('#radarImg');
    const v = radarState.view;
    const crop = RADAR_PRODUCTS[radarState.mode].crop;
    if (!img || !v || !crop) {
      if (img) img.style.clipPath = 'none';
      return;
    }
    if (v.scale > v.sCrop * 1.02) {
      img.style.clipPath = 'none';
      return;
    }
    const top = (crop.y / v.natH) * 100;
    const right = ((v.natW - crop.x - crop.w) / v.natW) * 100;
    const bottom = ((v.natH - crop.y - crop.h) / v.natH) * 100;
    const left = (crop.x / v.natW) * 100;
    img.style.clipPath = `inset(${top.toFixed(3)}% ${right.toFixed(3)}% ${bottom.toFixed(3)}% ${left.toFixed(3)}%)`;
  }

  function applyRadarView() {
    const v = radarState.view;
    if (!v) return;
    $('#radarImg').style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.scale})`;
    updateRadarClip();
  }

  function clampRadarView() {
    const v = radarState.view;
    if (!v) return;
    const sw = v.natW * v.scale;
    const sh = v.natH * v.scale;
    if (sw <= v.vw) v.tx = RADAR_PAD + (v.vw - sw) / 2;
    else v.tx = Math.min(RADAR_PAD, Math.max(RADAR_PAD + v.vw - sw, v.tx));
    if (sh <= v.vh) v.ty = RADAR_PAD + (v.vh - sh) / 2;
    else v.ty = Math.min(RADAR_PAD, Math.max(RADAR_PAD + v.vh - sh, v.ty));
  }

  function centerRadarCrop() {
    const v = radarState.view;
    if (!v) return;
    v.scale = v.sCrop;
    v.tx = RADAR_PAD + (v.vw - v.crop.w * v.sCrop) / 2 - v.crop.x * v.sCrop;
    v.ty = RADAR_PAD + (v.vh - v.crop.h * v.sCrop) / 2 - v.crop.y * v.sCrop;
    clampRadarView();
    applyRadarView();
  }

  function centerRadarWhole() {
    const v = radarState.view;
    if (!v) return;
    v.scale = v.sWhole;
    v.tx = RADAR_PAD + (v.vw - v.natW * v.sWhole) / 2;
    v.ty = RADAR_PAD + (v.vh - v.natH * v.sWhole) / 2;
    clampRadarView();
    applyRadarView();
  }

  function zoomRadar(factor, cx, cy) {
    const v = radarState.view;
    if (!v) return;
    const next = Math.min(v.maxScale, Math.max(v.minScale, v.scale * factor));
    const k = next / v.scale;
    v.tx = cx - (cx - v.tx) * k;
    v.ty = cy - (cy - v.ty) * k;
    v.scale = next;
    clampRadarView();
    applyRadarView();
  }

  function setupRadarView(reset) {
    const img = $('#radarImg');
    if (!img || !img.naturalWidth || !radarStage) return;
    const vw = Math.max(60, radarStage.clientWidth - RADAR_PAD * 2);
    const vh = Math.max(60, radarStage.clientHeight - RADAR_PAD * 2);
    const cfg = RADAR_PRODUCTS[radarState.mode];
    const crop = cfg.crop || { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
    const sCrop = Math.min(vw / crop.w, vh / crop.h);
    const sWhole = Math.min(vw / img.naturalWidth, vh / img.naturalHeight);
    if (reset || !radarState.view || radarState.view.natW !== img.naturalWidth) {
      radarState.view = {
        natW: img.naturalWidth,
        natH: img.naturalHeight,
        crop,
        vw,
        vh,
        sCrop,
        sWhole,
        minScale: sWhole,
        maxScale: sCrop * 5,
        scale: sCrop,
        tx: 0,
        ty: 0,
      };
      centerRadarCrop();
      return;
    }
    radarState.view.vw = vw;
    radarState.view.vh = vh;
    radarState.view.sCrop = sCrop;
    radarState.view.sWhole = sWhole;
    centerRadarCrop();
  }

  function setRadarNote() {
    const note = $('.radar-note');
    if (!note) return;
    const cfg = RADAR_PRODUCTS[radarState.mode];
    const frames = radarState.frames;
    const mins = frames.length > 1 ? Math.round((frames[frames.length - 1].time - frames[0].time) / 60000) : 0;
    note.textContent = `中央气象台${cfg.label} · ${mins ? `最近约 ${mins} 分钟 · ` : ''}每 6 分钟一帧 · 单位 dBZ · 含邻省缓冲`;
  }

  function updateRadarModeUI() {
    $$('#radarModes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === radarState.mode));
    const dbz = $('#radarDbz');
    if (dbz) dbz.classList.toggle('show', radarState.mode === 'nation');
    setRadarNote();
  }

  function useRadarFrames(mode) {
    const cache = radarCache[mode];
    radarState.seq++;
    radarState.mode = mode;
    radarState.frames = cache.frames;
    radarState.index = cache.frames.length - 1;
    radarState.loading = false;
    radarState.view = null;
    $('#radarLoading').classList.add('hidden');
    const slider = $('#radarSlider');
    slider.max = Math.max(0, cache.frames.length - 1);
    renderRadarThumbs();
    renderRadarFrame(radarState.index);
    updateRadarModeUI();
    const play = $('#radarPlay');
    play.disabled = cache.frames.length < 2;
    const img = $('#radarImg');
    if (img.complete && img.naturalWidth) setupRadarView(true);
  }

  async function loadRadarFrames(mode, force = false) {
    const cfg = RADAR_PRODUCTS[mode];
    const cache = radarCache[mode];
    if (!force && cache.frames.length && Date.now() - cache.loadedAt < 5 * 60 * 1000) {
      useRadarFrames(mode);
      return;
    }
    const seq = ++radarState.seq;
    radarState.loading = true;
    radarState.mode = mode;
    radarState.view = null;
    stopRadarPlay();
    const loading = $('#radarLoading');
    const progress = $('#radarProgress');
    const playBtn = $('#radarPlay');
    loading.classList.remove('hidden');
    progress.textContent = '正在加载雷达帧…';
    playBtn.disabled = true;
    $('#radarSlider').max = 0;
    $('#radarCount').textContent = '0 / 0';
    updateRadarModeUI();
    const slots = radarSlots(cfg.count, cfg.code);
    const results = [];
    let done = 0;
    let previewed = false;
    const queue = slots.slice();

    async function worker() {
      while (queue.length) {
        const slot = queue.shift();
        try {
          await loadRadarImage(slot.url);
          results.push(slot);
          if (!previewed) {
            previewed = true;
            $('#radarImg').src = slot.url;
            $('#radarTime').textContent = fmtRadarTime(slot.time);
          }
        } catch (e) {
          /* skip missing frame */
        }
        done++;
        progress.textContent = `正在加载雷达帧 ${done}/${slots.length}`;
      }
    }

    await Promise.all([worker(), worker(), worker()]);
    if (seq !== radarState.seq) return;
    radarState.loading = false;
    results.sort((a, b) => a.time - b.time);
    cache.frames = results;
    cache.loadedAt = Date.now();
    radarState.frames = results;
    const n = results.length;
    if (!n) {
      progress.textContent = '雷达数据暂不可用，请稍后重试';
      $('#radarCount').textContent = '0 / 0';
      return;
    }
    loading.classList.add('hidden');
    const slider = $('#radarSlider');
    slider.max = n - 1;
    renderRadarThumbs();
    renderRadarFrame(n - 1);
    setupRadarView(true);
    playBtn.disabled = n < 2;
    setRadarNote();
  }

  function switchRadarMode(mode) {
    if (!RADAR_PRODUCTS[mode] || (mode === radarState.mode && radarState.frames.length)) {
      updateRadarModeUI();
      return;
    }
    $$('#radarProvs button').forEach((b) => b.classList.remove('active'));
    stopRadarPlay();
    const cache = radarCache[mode];
    if (cache.frames.length && Date.now() - cache.loadedAt < 5 * 60 * 1000) useRadarFrames(mode);
    else loadRadarFrames(mode);
  }

  function openRadarSheet() {
    radarState.mode = 'nation';
    radarSheetEl.classList.add('open');
    radarSheetEl.setAttribute('aria-hidden', 'false');
    syncBodyLock();
    updateRadarModeUI();
    $$('#radarProvs button').forEach((b) => b.classList.remove('active'));
    const cache = radarCache[radarState.mode];
    if (cache.frames.length && Date.now() - cache.loadedAt < 5 * 60 * 1000) useRadarFrames(radarState.mode);
    else loadRadarFrames(radarState.mode);
  }

  function openRadarForProvince(name) {
    const mode = RADAR_PROVINCE_MODE[name] || 'nation';
    radarState.mode = mode;
    radarSheetEl.classList.add('open');
    radarSheetEl.setAttribute('aria-hidden', 'false');
    syncBodyLock();
    updateRadarModeUI();
    $$('#radarProvs button').forEach((b) => b.classList.toggle('active', b.dataset.prov === name));
    const cache = radarCache[mode];
    if (cache.frames.length && Date.now() - cache.loadedAt < 5 * 60 * 1000) useRadarFrames(mode);
    else loadRadarFrames(mode);
  }

  function closeRadarSheet() {
    stopRadarPlay();
    radarSheetEl.classList.remove('open');
    radarSheetEl.setAttribute('aria-hidden', 'true');
    syncBodyLock();
  }

  function syncBodyLock() {
    const any = ['sheet', 'rankSheet', 'radarSheet'].some((id) => {
      const el = document.getElementById(id);
      return el && el.classList.contains('open');
    });
    document.body.classList.toggle('sheet-open', any);
  }

  /* ---------------- function center ---------------- */
  const FEATURES = [
    {
      id: 'earthquake',
      title: '地震信息',
      desc: '全国及周边地震速报，查看震级、震中位置与影响范围。',
      category: '灾害与预警',
      accent: '#c4553b',
      icon: 'quake',
      tags: ['地震速报', '震中地图', '历史地震'],
      status: 'live',
      route: '#/earthquake',
      wide: true,
    },
    {
      id: 'warning',
      title: '气象预警',
      desc: '五省预警信号汇总（含森林火险），扶梯版与传统地图版可切换，按省份、地级市、类型、时间和颜色筛选。',
      category: '灾害与预警',
      accent: '#c98a1a',
      icon: 'warning',
      tags: ['扶梯/传统', '地图筛选', '官方详情'],
      status: 'live',
      route: '#/warning',
    },
    {
      id: 'typhoon',
      title: '台风路径',
      desc: '中央气象台官方实况路径、风圈与多机构预报。',
      category: '灾害与预警',
      accent: '#2f7fb6',
      icon: 'typhoon',
      tags: ['实况路径', '预报路径', '风圈范围'],
      status: 'live',
      route: '#/typhoon',
    },
  ];

  const FEATURE_ICONS = {
    quake:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M2.8 12h3.3l1.8-4.6 2.7 9.2 2.1-5.6 1.6 3h6.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    warning:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.2 21 20H3L12 4.2Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9.2v5.1" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1.1" fill="currentColor"/></svg>',
    typhoon:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3.2c4.8 0 8.8 3.9 8.8 8.8M12 20.8c-4.8 0-8.8-3.9-8.8-8.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M7.4 7.4c2.6-2.6 6.7-2.2 8.8.4M16.6 16.6c-2.6 2.6-6.7 2.2-8.8-.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  };

  const centerPageEl = $('#centerPage');
  const centerState = { query: '', filter: 'all', favs: new Set() };
  let centerFromMap = false;

  try {
    const saved = JSON.parse(localStorage.getItem('qxksh.featureFavorites') || '[]');
    if (Array.isArray(saved)) saved.forEach((id) => centerState.favs.add(id));
  } catch (e) {
    /* ignore */
  }

  function saveCenterFavs() {
    try {
      localStorage.setItem('qxksh.featureFavorites', JSON.stringify([...centerState.favs]));
    } catch (e) {
      /* ignore */
    }
  }

  function featureCardHtml(f) {
    const fav = centerState.favs.has(f.id);
    const statusText = f.status === 'live' ? '可用' : f.status === 'beta' ? '内测' : '规划中';
    const statusClass = f.status === 'live' ? ' live' : '';
    const footText = f.status === 'live' ? '进入 →' : '即将上线 →';
    return `<article class="feature-card${f.wide ? ' wide' : ''}" data-id="${f.id}" tabindex="0" role="button" style="--fc-accent:${f.accent}" aria-label="${f.title}（${statusText}）">
      <div class="fc-top">
        <span class="fc-icon">${FEATURE_ICONS[f.icon] || ''}</span>
        <span class="fc-status${statusClass}">${statusText}</span>
        <button class="fc-star${fav ? ' active' : ''}" type="button" data-fav="${f.id}" aria-label="${fav ? '取消收藏' : '收藏'}${f.title}">${fav ? '★' : '☆'}</button>
      </div>
      <h3>${f.title}</h3>
      <p>${f.desc}</p>
      <div class="fc-tags">${(f.tags || []).map((t) => `<span>${t}</span>`).join('')}</div>
      ${f.wide ? `<span class="fc-watermark">${FEATURE_ICONS[f.icon] || ''}</span>` : ''}
      <div class="fc-foot"><span>${f.category}</span><span class="fc-arrow">${footText}</span></div>
    </article>`;
  }

  function activateFeature(card) {
    if (!card) return;
    const feature = FEATURES.find((f) => f.id === card.dataset.id);
    if (!feature) return;
    if (feature.status === 'live' && feature.route) location.hash = feature.route;
    else toast(`${feature.title} · 即将上线`);
  }

  function renderCenterCards() {
    const grid = $('#centerGrid');
    if (!grid) return;
    $$('#centerChips button').forEach((b) => {
      b.classList.toggle('active', b.dataset.cat === centerState.filter);
      if (b.dataset.cat === 'fav') b.textContent = centerState.favs.size ? `★ 收藏 ${centerState.favs.size}` : '★ 收藏';
    });
    const q = centerState.query.trim();
    let list = FEATURES.slice();
    if (centerState.filter === 'fav') list = list.filter((f) => centerState.favs.has(f.id));
    else if (centerState.filter !== 'all') list = list.filter((f) => f.category === centerState.filter);
    if (q) list = list.filter((f) => (f.title + f.desc + f.category).includes(q));
    if (!list.length) {
      const msg =
        centerState.filter === 'fav' && !centerState.favs.size
          ? '还没有收藏，点卡片右上角 ☆ 收藏'
          : '没有找到匹配的功能';
      grid.innerHTML = `<div class="center-empty">${msg}</div>`;
      return;
    }
    grid.innerHTML = list.map(featureCardHtml).join('');
  }

  function openCenter() {
    if (document.body.classList.contains('center-open')) return;
    if ($('#sheet').classList.contains('open')) closeSheet();
    if (rankSheetEl.classList.contains('open')) closeRankSheet();
    if (radarSheetEl.classList.contains('open')) closeRadarSheet();
    centerFromMap = true;
    if (location.hash !== '#/center') location.hash = '#/center';
    else applyRoute();
  }

  function closeCenter() {
    if (centerFromMap) {
      centerFromMap = false;
      history.back();
    } else {
      history.replaceState(null, '', '#/map');
      applyRoute();
    }
  }

  function savedWarningView() {
    try { return localStorage.getItem('qxksh.warningView') || ''; } catch (e) { return ''; }
  }

  function applyRoute() {
    const route = location.hash.replace(/^#\/?/, '');
    if (route === 'warning' && savedWarningView() === 'classic') {
      history.replaceState(null, '', '#/warning-classic');
      applyRoute();
      return;
    }
    const isWarningClassic = route.startsWith('warning-classic');
    const isWarning = route.startsWith('warning') && !isWarningClassic;
    const isQuakeDetail = route.startsWith('earthquake/');
    const isQuake = route.startsWith('earthquake');
    const isCenter = route.startsWith('center');
    if (route === 'typhoon') {
      centerFromMap = false;
      closeQuakeDetail();
      closeQuakePage();
      if (window.WarningPage) window.WarningPage.close();
      if (window.WarningClassicPage) window.WarningClassicPage.close();
      document.body.classList.remove('center-open', 'quake-open', 'warning-classic-open');
      centerPageEl.setAttribute('aria-hidden', 'true');
      document.title = '台风路径 · 华南气象';
      if (window.TyphoonPage) window.TyphoonPage.open({ local: usesLocalMapProxy(), project: wgs84ToGcj02 });
      return;
    }
    if (window.TyphoonPage) window.TyphoonPage.close();
    if (isWarningClassic) {
      centerFromMap = false;
      closeQuakeDetail();
      closeQuakePage();
      if (window.WarningPage) window.WarningPage.close();
      document.body.classList.remove('center-open', 'quake-open', 'warning-open');
      centerPageEl.setAttribute('aria-hidden', 'true');
      document.body.classList.add('warning-classic-open');
      document.title = '气象预警 · 华南气象';
      if (window.WarningClassicPage) window.WarningClassicPage.open();
      return;
    }
    if (window.WarningClassicPage) window.WarningClassicPage.close();
    document.body.classList.remove('warning-classic-open');
    if (isWarning) {
      centerFromMap = false;
      closeQuakeDetail();
      closeQuakePage();
      document.body.classList.remove('center-open', 'quake-open');
      centerPageEl.setAttribute('aria-hidden', 'true');
      document.title = '气象预警 · 华南气象';
      if (window.WarningPage) window.WarningPage.open();
      return;
    }
    if (window.WarningPage) window.WarningPage.close();
    document.body.classList.remove('warning-open');
    if (isQuakeDetail) {
      centerFromMap = false;
      document.body.classList.remove('center-open');
      document.body.classList.add('quake-open', 'quake-detail-open');
      centerPageEl.setAttribute('aria-hidden', 'true');
      document.title = '震中详情 · 华南气象';
      openQuakeDetail(decodeURIComponent(route.slice('earthquake/'.length)));
      return;
    }
    if (isQuake) {
      centerFromMap = false;
      closeQuakeDetail();
      document.body.classList.remove('center-open');
      document.body.classList.add('quake-open');
      centerPageEl.setAttribute('aria-hidden', 'true');
      document.title = '地震信息 · 华南气象';
      openQuakePage();
      return;
    }
    closeQuakeDetail();
    closeQuakePage();
    document.body.classList.remove('quake-open');
    if (isCenter) {
      renderCenterCards();
      document.title = '功能中心 · 华南气象';
      document.body.classList.add('center-open');
      centerPageEl.setAttribute('aria-hidden', 'false');
      centerPageEl.scrollTop = 0;
      window.scrollTo(0, 0);
      return;
    }
    centerFromMap = false;
    document.title = '华南五省气象图 · 粤湘桂赣闽';
    document.body.classList.remove('center-open');
    centerPageEl.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      if (!chart) return;
      chart.resize();
      updateLabelDensity();
    }, 60);
  }

  /* ---------------- earthquake page ---------------- */
  const QUAKE_CENC = 'https://api.wolfx.jp/cenc_eqlist.json';
  const QUAKE_EEW_FEEDS = [
    { url: 'https://api.wolfx.jp/cenc_eew.json', label: 'CENC 预警' },
    { url: 'https://api.wolfx.jp/fj_eew.json', label: '福建预警' },
  ];
  const QUAKE_USGS = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
  const QUAKE_BOX = { lon: [73, 135], lat: [18, 54] };
  const QUAKE_SOUTH = { lon: [104, 120.5], lat: [20, 30.5] };
  const QUAKE_HIGHLIGHT = ['广东省', '广西壮族自治区', '湖南省', '江西省', '福建省'];

  const quakeState = {
    events: [],
    eew: null,
    scope: 'all',
    selectedId: null,
    source: '中国地震台网',
    updatedAt: 0,
    loading: false,
    seq: 0,
    chart: null,
    mapReady: false,
    mapLoading: false,
    timer: null,
    chinaGeo: null,
  };

  const quakePageEl = $('#quakePage');

  function parseQuakeTs(value) {
    const text = String(value || '').trim();
    if (!text) return 0;
    const ts = new Date(text.replace(' ', 'T') + '+08:00').getTime();
    return Number.isFinite(ts) ? ts : 0;
  }

  function fmtQuakeTime(ts) {
    const iso = new Date(ts + 8 * 3600e3).toISOString();
    return `${iso.slice(5, 10)} ${iso.slice(11, 16)}`.replace('-', '-');
  }

  function fmtQuakeClock(ts) {
    const iso = new Date(ts + 8 * 3600e3).toISOString();
    return iso.slice(11, 19);
  }

  function relQuakeTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 60e3) return '刚刚';
    if (diff < 3600e3) return `${Math.max(1, Math.round(diff / 60e3))} 分钟前`;
    if (diff < 86400e3) return `${Math.round(diff / 3600e3)} 小时前`;
    return fmtQuakeTime(ts).slice(0, 5);
  }

  function inQuakeBox(lon, lat, box) {
    return lon >= box.lon[0] && lon <= box.lon[1] && lat >= box.lat[0] && lat <= box.lat[1];
  }

  function magColor(mag) {
    if (mag >= 6) return '#a02020';
    if (mag >= 5) return '#d8452f';
    if (mag >= 4) return '#ea7a3b';
    if (mag >= 3) return '#e0a51b';
    return '#5f9fbf';
  }

  function fetchQuakeJson(url, ms = 9000) {
    return new Promise((resolve, reject) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), ms);
      fetch(url, { cache: 'no-store', signal: ctrl.signal })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((json) => {
          clearTimeout(timer);
          resolve(json);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  function normalizeCenc(json) {
    return Object.values(json || {})
      .filter((e) => e && e.time)
      .map((e) => {
        const lon = Number(e.longitude);
        const lat = Number(e.latitude);
        const mag = Number(e.magnitude);
        const ts = parseQuakeTs(e.time);
        return {
          id: 'cenc-' + (e.EventID || `${e.time}-${lon}-${lat}`),
          ts,
          place: e.placeName || e.location || '未知区域',
          mag,
          depth: Number(e.depth) || 0,
          lon,
          lat,
          intensity: e.intensity ? Number(e.intensity) : null,
          type: e.type || '',
          source: 'CENC',
        };
      })
      .filter(
        (e) =>
          Number.isFinite(e.mag) &&
          Number.isFinite(e.lon) &&
          Number.isFinite(e.lat) &&
          e.ts &&
          inQuakeBox(e.lon, e.lat, QUAKE_BOX)
      )
      .sort((a, b) => b.ts - a.ts);
  }

  function normalizeUsgs(json) {
    const features = (json && json.features) || [];
    return features
      .map((f) => {
        const [lon, lat, depth] = f.geometry.coordinates;
        const ts = Number(f.properties.time);
        return {
          id: 'usgs-' + f.id,
          ts,
          place: f.properties.place || '未知区域',
          mag: Number(f.properties.mag),
          depth: Number(depth) || 0,
          lon,
          lat,
          intensity: null,
          type: 'usgs',
          source: 'USGS',
        };
      })
      .filter(
        (e) =>
          Number.isFinite(e.mag) &&
          Number.isFinite(e.lon) &&
          Number.isFinite(e.lat) &&
          e.ts &&
          inQuakeBox(e.lon, e.lat, QUAKE_BOX) &&
          Date.now() - e.ts < 7 * 86400e3
      )
      .sort((a, b) => b.ts - a.ts);
  }

  function normalizeEew(json, label) {
    if (!json || !json.ReportTime) return null;
    const ts = parseQuakeTs(json.ReportTime);
    if (!ts || Date.now() - ts > 10 * 60e3) return null;
    const mag = Number(json.Magnitude != null ? json.Magnitude : json.Magunitude);
    const lon = Number(json.Longitude);
    const lat = Number(json.Latitude);
    if (!Number.isFinite(mag) || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return {
      mag,
      place: json.HypoCenter || '未知区域',
      lon,
      lat,
      depth: Number(json.Depth) || 0,
      intensity: json.MaxIntensity != null ? Number(json.MaxIntensity) : null,
      reportTime: json.ReportTime,
      ts,
      source: label,
    };
  }

  function quakeEvents() {
    if (quakeState.scope === 'south') {
      return quakeState.events.filter((e) => inQuakeBox(e.lon, e.lat, QUAKE_SOUTH));
    }
    return quakeState.events;
  }

  function setQuakeAlert(kind, label, text, time = '') {
    const el = $('#quakeAlert');
    if (!el) return;
    el.className = 'quake-alert ' + kind;
    el.querySelector('.qa-label').textContent = label;
    el.querySelector('.qa-text').textContent = text;
    el.querySelector('.qa-time').textContent = time;
  }

  function quakeStatHtml(label, value, sub) {
    return `<div class="quake-stat"><small>${label}</small><b>${value}</b><span>${sub}</span></div>`;
  }

  function renderQuakeFocus(event) {
    const el = $('#quakeFocus');
    if (!el) return;
    el.style.display = event ? '' : 'none';
    if (!event) return;
    const typeText = event.source === 'USGS' ? 'USGS' : event.type === 'reviewed' ? '正式测定' : '自动测定';
    el.style.setProperty('--m-color', magColor(event.mag));
    el.innerHTML = `<div class="qf-main">
      <span class="qf-mag" style="--m-color:${magColor(event.mag)}">${event.mag.toFixed(1)}</span>
      <div class="qf-info"><b>${event.place}</b><span>${fmtQuakeTime(event.ts)} · 深 ${event.depth} km${event.intensity ? ` · 烈度 ${event.intensity}` : ''}</span></div>
    </div>
    <div class="qf-foot">
      <div class="qf-tags"><span>${typeText}</span><span>${event.lon.toFixed(2)}°E · ${event.lat.toFixed(2)}°N</span><span>${event.source === 'CENC' ? '中国地震台网' : event.source}</span></div>
      <button class="qf-open" type="button" data-quake-open="${escHtml(event.id)}">震中地形 <span>→</span></button>
    </div>`;
  }

  function renderQuakeList(events) {
    const el = $('#quakeList');
    if (!el) return;
    if (!events.length) {
      el.innerHTML = `<div class="quake-empty">${quakeState.scope === 'south' ? '华南五省近 5 天暂无地震速报<br>可切回全国查看' : '该范围内暂无地震速报'}</div>`;
      return;
    }
    el.innerHTML = events
      .slice(0, 45)
      .map((e) => {
        const color = magColor(e.mag);
        const width = Math.min(100, Math.max(6, (e.mag / 8) * 100)).toFixed(1);
        return `<button class="quake-row${e.id === quakeState.selectedId ? ' selected' : ''}" type="button" data-quake="${e.id}" style="--m-color:${color}">
          <span class="qr-mag">${e.mag.toFixed(1)}</span>
          <span class="qr-main">
            <span class="qr-place">${e.place}</span>
            <span class="qr-meta">${fmtQuakeTime(e.ts)} · 深 ${e.depth} km</span>
            <span class="qr-bar"><i style="width:${width}%"></i></span>
          </span>
          <span class="qr-time">${relQuakeTime(e.ts)}</span>
        </button>`;
      })
      .join('');
  }

  function quakeTooltip(event) {
    if (!event) return '';
    return `<b style="font-size:13px">M${event.mag.toFixed(1)}</b><br>${event.place}<br>${fmtQuakeTime(event.ts)} · 深 ${event.depth} km`;
  }

  function renderQuakeMap(events) {
    const chart = quakeState.chart;
    if (!chart) return;
    const points = events.map((e) => ({
      id: e.id,
      name: e.place,
      value: [e.lon, e.lat, e.mag],
      itemStyle: {
        color: magColor(e.mag),
        borderColor: e.id === quakeState.selectedId ? '#17384a' : 'rgba(255,255,255,.92)',
        borderWidth: e.id === quakeState.selectedId ? 2.4 : 1,
      },
    }));
    const big = points.filter((p) => p.value[2] >= 4.5);
    const south = quakeState.scope === 'south';
    chart.setOption({
      geo: {
        center: south ? [110.6, 25.2] : [104, 36],
        zoom: south ? 3.1 : 1.15,
      },
      series: [{ id: 'quake', data: points }, { id: 'quakeBig', data: big }],
    });
  }

  let chinaGeoPromise = null;
  function loadChinaGeo() {
    if (quakeState.chinaGeo) return Promise.resolve(quakeState.chinaGeo);
    if (!chinaGeoPromise) {
      chinaGeoPromise = fetch('data/china.json', { cache: 'force-cache' })
        .then((r) => {
          if (!r.ok) throw new Error('geo failed');
          return r.json();
        })
        .then((geo) => {
          quakeState.chinaGeo = geo;
          return geo;
        })
        .catch((err) => {
          chinaGeoPromise = null;
          throw err;
        });
    }
    return chinaGeoPromise;
  }

  async function initQuakeMap() {
    if (quakeState.mapReady || quakeState.mapLoading) return;
    quakeState.mapLoading = true;
    try {
      const geo = await loadChinaGeo();
      echarts.registerMap('china', geo);
      const chart = echarts.init($('#quakeMap'));
      chart.on('click', (p) => {
        if (p.data && p.data.id) {
          selectQuake(p.data.id);
          location.hash = `#/earthquake/${encodeURIComponent(p.data.id)}`;
        }
      });
      chart.setOption({
        backgroundColor: 'transparent',
        geo: {
          map: 'china',
          roam: true,
          zoom: 1.15,
          center: [104, 36],
          itemStyle: { areaColor: '#edf5f9', borderColor: '#c9dde8', borderWidth: 0.7 },
          emphasis: { itemStyle: { areaColor: '#e3f1f8' }, label: { show: false } },
          label: { show: false },
          regions: QUAKE_HIGHLIGHT.map((name) => ({
            name,
            itemStyle: { areaColor: '#e8f3f9', borderColor: '#8ab6cd' },
          })),
        },
        tooltip: {
          trigger: 'item',
          backgroundColor: 'rgba(23,56,74,.94)',
          borderWidth: 0,
          padding: [7, 10],
          textStyle: { color: '#fff', fontSize: 12 },
          formatter: (p) => quakeTooltip(quakeState.events.find((e) => e.id === (p.data && p.data.id))),
        },
        series: [
          {
            id: 'quake',
            type: 'scatter',
            coordinateSystem: 'geo',
            zlevel: 2,
            symbolSize: (v) => 4 + v[2] * 2.3,
            itemStyle: { opacity: 0.9 },
            label: {
              show: true,
              formatter: (p) => (p.value[2] >= 5 ? `M${p.value[2].toFixed(1)}` : ''),
              position: 'right',
              color: '#37505f',
              fontSize: 10.5,
              fontWeight: 700,
            },
            emphasis: { scale: 1.25 },
            data: [],
          },
          {
            id: 'quakeBig',
            type: 'effectScatter',
            coordinateSystem: 'geo',
            zlevel: 3,
            rippleEffect: { scale: 3, brushType: 'stroke' },
            symbolSize: (v) => 5 + v[2] * 2.2,
            itemStyle: { opacity: 0.95 },
            data: [],
          },
        ],
      });
      quakeState.chart = chart;
      quakeState.mapReady = true;
      renderQuakeMap(quakeEvents());
    } catch (e) {
      const el = $('#quakeMap');
      if (el) el.innerHTML = '<div class="quake-empty">地图加载失败，仍可查看右侧列表</div>';
    } finally {
      quakeState.mapLoading = false;
    }
  }

  function renderQuake() {
    const events = quakeEvents();
    const latest = events[0] || null;
    const day = events.filter((e) => Date.now() - e.ts < 86400e3);
    const maxDay = day.reduce((acc, e) => (!acc || e.mag > acc.mag ? e : acc), null);
    const selected = events.find((e) => e.id === quakeState.selectedId) || latest;
    if (selected && selected.id !== quakeState.selectedId) quakeState.selectedId = selected.id;

    $('#quakeSource').textContent = quakeState.source;
    $('#quakeUpdated').textContent = quakeState.updatedAt ? `更新 ${fmtQuakeClock(quakeState.updatedAt)}` : '—';
    $('#quakeCount').textContent = `${events.length} 条 · 近 5 天`;

    $('#quakeStats').innerHTML = [
      quakeStatHtml('近 24 小时', `${day.length} 次`, quakeState.scope === 'south' ? '华南范围' : '全国范围'),
      quakeStatHtml('最大震级', maxDay ? `M${maxDay.mag.toFixed(1)}` : '—', maxDay ? maxDay.place : '暂无记录'),
      quakeStatHtml('M ≥ 4', `${day.filter((e) => e.mag >= 4).length} 次`, '近 24 小时'),
      quakeStatHtml('最近速报', latest ? fmtQuakeClock(latest.ts).slice(0, 5) : '—', latest ? latest.place : '暂无记录'),
    ].join('');

    const eew = quakeState.eew;
    const eewInScope =
      eew && (quakeState.scope === 'all' || inQuakeBox(eew.lon, eew.lat, QUAKE_SOUTH));
    if (eewInScope) {
      setQuakeAlert('alert', '预警', `M${eew.mag.toFixed(1)} ${eew.place}`, `${fmtQuakeClock(eew.ts)} · ${eew.source}`);
    } else if (maxDay && maxDay.mag >= 4.5) {
      setQuakeAlert(
        'warn',
        '速报',
        `M${maxDay.mag.toFixed(1)} ${maxDay.place}`,
        `${fmtQuakeTime(maxDay.ts)} · 深 ${maxDay.depth} km`
      );
    } else if (day.length) {
      setQuakeAlert(
        'calm',
        '平稳',
        `近 24 小时 ${day.length} 次地震，最大 M${maxDay ? maxDay.mag.toFixed(1) : '—'}`,
        quakeState.source
      );
    } else {
      setQuakeAlert('calm', '平稳', '近 24 小时无地震速报', quakeState.source);
    }

    renderQuakeFocus(selected);
    renderQuakeList(events);
    renderQuakeMap(events);
  }

  function selectQuake(id) {
    if (!quakeState.events.some((e) => e.id === id)) return;
    quakeState.selectedId = id;
    const selected = quakeState.events.find((e) => e.id === id);
    renderQuakeFocus(selected);
    renderQuakeList(quakeEvents());
    renderQuakeMap(quakeEvents());
    const row = document.querySelector(`.quake-row[data-quake="${id}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  async function loadQuakeData(manual = false) {
    const seq = ++quakeState.seq;
    quakeState.loading = true;
    if (!quakeState.events.length) setQuakeAlert('info', '速报', '正在获取最新地震信息…', '');
    const requests = [fetchQuakeJson(QUAKE_CENC), ...QUAKE_EEW_FEEDS.map((f) => fetchQuakeJson(f.url))];
    const results = await Promise.allSettled(requests);
    if (seq !== quakeState.seq) return;
    const listResult = results[0];
    let events = [];
    let source = '中国地震台网';
    let eew = null;
    if (listResult.status === 'fulfilled') {
      events = normalizeCenc(listResult.value);
      eew = results
        .slice(1)
        .map((r, i) => (r.status === 'fulfilled' ? normalizeEew(r.value, QUAKE_EEW_FEEDS[i].label) : null))
        .filter(Boolean)
        .sort((a, b) => b.ts - a.ts)[0] || null;
    }
    if (!events.length) {
      try {
        const usgs = await fetchQuakeJson(QUAKE_USGS);
        events = normalizeUsgs(usgs);
        source = 'USGS（备用源）';
        eew = null;
      } catch (e) {
        events = [];
      }
    }
    if (seq !== quakeState.seq) return;
    quakeState.loading = false;
    if (!events.length) {
      setQuakeAlert('warn', '提示', '地震数据暂不可用，请稍后刷新', '');
      if (!quakeState.events.length) {
        renderQuakeFocus(null);
        renderQuakeList([]);
      }
      if (manual) toast('地震数据暂不可用');
      return;
    }
    quakeState.events = events;
    quakeState.eew = eew;
    quakeState.source = source;
    quakeState.updatedAt = Date.now();
    if (!quakeState.selectedId || !events.some((e) => e.id === quakeState.selectedId)) {
      quakeState.selectedId = events[0].id;
    }
    renderQuake();
    if (manual) toast('地震信息已更新');
  }

  function startQuakeTimer() {
    stopQuakeTimer();
    quakeState.timer = setInterval(() => loadQuakeData(false), 60e3);
  }

  function stopQuakeTimer() {
    if (quakeState.timer) clearInterval(quakeState.timer);
    quakeState.timer = null;
  }

  function openQuakePage() {
    quakePageEl.setAttribute('aria-hidden', 'false');
    initQuakeMap();
    if (!quakeState.events.length || Date.now() - quakeState.updatedAt > 60e3) loadQuakeData(false);
    else renderQuake();
    startQuakeTimer();
    setTimeout(() => {
      if (quakeState.chart) quakeState.chart.resize();
    }, 80);
  }

  function closeQuakePage() {
    stopQuakeTimer();
    quakePageEl.setAttribute('aria-hidden', 'true');
  }

  /* ---------------- quake epicenter detail ---------------- */
  const quakeDetailState = {
    map: null,
    base: 'sat',
    satLayer: null,
    vecLayer: null,
    marker: null,
    rings: null,
    adminGroup: null,
    adminOn: true,
    admin: null,
    center: null,
    eventId: null,
    seq: 0,
  };
  const quakeBoundaryCache = new Map();
  const quakeDetailPageEl = $('#quakeDetailPage');

  function escHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function outOfChina(lon, lat) {
    return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
  }

  function transformLat(x, y) {
    let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
    ret += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
    ret += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
    return ret;
  }

  function transformLon(x, y) {
    let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
    ret += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
    ret += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
    return ret;
  }

  function wgs84ToGcj02(lon, lat) {
    if (outOfChina(lon, lat)) return [lon, lat];
    const a = 6378245.0;
    const ee = 0.00669342162296594323;
    let dLat = transformLat(lon - 105, lat - 35);
    let dLon = transformLon(lon - 105, lat - 35);
    const radLat = (lat / 180) * Math.PI;
    let magic = Math.sin(radLat);
    magic = 1 - ee * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180) / (((a * (1 - ee)) / (magic * sqrtMagic)) * Math.PI);
    dLon = (dLon * 180) / ((a / sqrtMagic) * Math.cos(radLat) * Math.PI);
    return [lon + dLon, lat + dLat];
  }

  function pointInRing(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function pointInGeometry(lon, lat, geometry) {
    if (!geometry) return false;
    if (geometry.type === 'Polygon') {
      if (!geometry.coordinates.length || !pointInRing(lon, lat, geometry.coordinates[0])) return false;
      for (let i = 1; i < geometry.coordinates.length; i++) {
        if (pointInRing(lon, lat, geometry.coordinates[i])) return false;
      }
      return true;
    }
    if (geometry.type === 'MultiPolygon') {
      return geometry.coordinates.some((poly) => pointInGeometry(lon, lat, { type: 'Polygon', coordinates: poly }));
    }
    return false;
  }

  function featureAt(fc, lon, lat) {
    return ((fc && fc.features) || []).find((f) => pointInGeometry(lon, lat, f.geometry)) || null;
  }

  function usesLocalMapProxy() {
    const host = location.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  }

  function fetchQuakeBoundary(adcode) {
    const key = String(adcode || '');
    if (!/^\d{6}$/.test(key)) return Promise.resolve(null);
    if (quakeBoundaryCache.has(key)) return quakeBoundaryCache.get(key);
    const boundaryUrl = usesLocalMapProxy()
      ? `geo/${key}.json`
      : `https://geo.datav.aliyun.com/areas_v3/bound/${key}_full.json`;
    const task = fetch(boundaryUrl, boundaryUrl.startsWith('http') ? { referrerPolicy: 'no-referrer' } : undefined)
      .then((r) => {
        if (!r.ok) throw new Error(`geo ${key} ${r.status}`);
        return r.json();
      })
      .catch(() => null);
    quakeBoundaryCache.set(key, task);
    return task;
  }

  async function resolveQuakeAdmin(lon, lat) {
    const china = await loadChinaGeo();
    const province = featureAt(china, lon, lat);
    if (!province) return null;
    const result = { province, city: null, county: null, citiesFC: null, countiesFC: null };
    const provinceCode = String(province.properties.adcode);
    const childFC = await fetchQuakeBoundary(provinceCode);
    if (!childFC || !childFC.features || !childFC.features.length) return result;
    if (['110000', '120000', '310000', '500000'].includes(provinceCode)) {
      result.countiesFC = childFC;
      result.county = featureAt(childFC, lon, lat);
      return result;
    }
    const city = featureAt(childFC, lon, lat);
    if (!city) {
      result.countiesFC = childFC;
      result.county = featureAt(childFC, lon, lat);
      return result;
    }
    result.city = city;
    result.citiesFC = childFC;
    const countyFC = await fetchQuakeBoundary(city.properties.adcode);
    if (countyFC && countyFC.features && countyFC.features.length) {
      result.countiesFC = countyFC;
      result.county = featureAt(countyFC, lon, lat);
    }
    return result;
  }

  function initQuakeDetailMap() {
    if (quakeDetailState.map) return;
    const map = L.map('quakeDetailMap', {
      zoomControl: false,
      attributionControl: false,
      minZoom: 4,
      maxZoom: 17,
      worldCopyJump: true,
      preferCanvas: true,
    });
    map.createPane('qdAdminPane');
    map.getPane('qdAdminPane').style.zIndex = 360;
    L.control.zoom({ position: 'topright' }).addTo(map);
    const local = usesLocalMapProxy();
    const tileOptions = { minZoom: 4, maxZoom: 17, keepBuffer: 3 };
    const sat = local
      ? L.layerGroup([
          L.tileLayer('tiles/sat/{z}/{x}/{y}.jpg', tileOptions),
          L.tileLayer('tiles/label/{z}/{x}/{y}.png', tileOptions),
        ])
      : L.layerGroup([
          L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}', { ...tileOptions, subdomains: '1234' }),
          L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}', { ...tileOptions, subdomains: '1234' }),
        ]);
    const vec = local
      ? L.layerGroup([L.tileLayer('tiles/vec/{z}/{x}/{y}.png', tileOptions)])
      : L.layerGroup([
          L.tileLayer('https://wprd0{s}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=1&style=7', { ...tileOptions, subdomains: '1234' }),
        ]);
    sat.addTo(map);
    map.setView([34, 108], 4);
    quakeDetailState.map = map;
    quakeDetailState.satLayer = sat;
    quakeDetailState.vecLayer = vec;
    quakeDetailState.base = 'sat';
    setTimeout(() => map.invalidateSize(), 80);
  }

  function addQuakeAdminLayer(group, fc, labelClass, style) {
    if (!fc || !fc.features || !fc.features.length) return;
    L.geoJSON(fc, {
      pane: 'qdAdminPane',
      style,
      onEachFeature: (feature, layer) => {
        const name = feature.properties && feature.properties.name;
        if (name) {
          layer.bindTooltip(name, {
            permanent: true,
            direction: 'center',
            className: `qd-adm-label ${labelClass}`,
            interactive: false,
          });
        }
      },
    }).addTo(group);
  }

  function renderQuakeAdminLayers(admin) {
    const map = quakeDetailState.map;
    if (!map) return;
    if (quakeDetailState.adminGroup) map.removeLayer(quakeDetailState.adminGroup);
    quakeDetailState.adminGroup = null;
    if (!admin) return;
    const group = L.layerGroup();
    const countyCode = admin.county ? String(admin.county.properties.adcode) : '';
    if (admin.citiesFC) {
      addQuakeAdminLayer(group, admin.citiesFC, 'city', {
        color: '#6f9db4',
        weight: 1.1,
        opacity: 0.9,
        dashArray: '4 4',
        fillColor: '#7fa3b6',
        fillOpacity: 0.03,
      });
    }
    if (admin.countiesFC) {
      addQuakeAdminLayer(group, admin.countiesFC, 'county', (feature) => {
        const target = countyCode && String(feature.properties.adcode) === countyCode;
        return target
          ? { color: '#d28b2f', weight: 1.8, opacity: 0.95, fillColor: '#e0a51b', fillOpacity: 0.15 }
          : { color: '#9fbccb', weight: 1, opacity: 0.9, fillColor: '#7fa3b6', fillOpacity: 0.015 };
      });
    }
    if (admin.province) {
      L.geoJSON(admin.province, {
        pane: 'qdAdminPane',
        style: { color: '#17384a', weight: 1.5, opacity: 0.65, fill: false },
      }).addTo(group);
    }
    quakeDetailState.adminGroup = group;
    if (quakeDetailState.adminOn) group.addTo(map);
  }

  function updateQuakeAdminInfo(admin) {
    const el = $('#qdAdminName');
    if (!el) return;
    const names = admin
      ? [admin.province, admin.city, admin.county]
          .filter(Boolean)
          .map((f) => f.properties && f.properties.name)
          .filter(Boolean)
      : [];
    const text = names.length ? names.join(' / ') : '境外或暂无可匹配的行政边界';
    el.textContent = text;
    const mapEl = $('#qdMapAdmin');
    if (mapEl) {
      mapEl.hidden = false;
      mapEl.textContent = names.length ? names.join(' · ') : '境外 / 暂无行政边界';
    }
  }

  function fmtQuakeFull(ts) {
    const iso = new Date(ts + 8 * 3600e3).toISOString();
    return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
  }

  function renderQuakeDetailInfo(event) {
    const el = $('#qdInfo');
    if (!el || !event) return;
    const mapAdmin = $('#qdMapAdmin');
    if (mapAdmin) mapAdmin.hidden = true;
    const typeText = event.source === 'USGS' ? 'USGS 速报' : event.type === 'reviewed' ? '正式测定' : '自动测定';
    const sourceText = event.source === 'CENC' ? '中国地震台网' : event.source;
    el.innerHTML = `<div class="qd-head">
      <span class="qd-mag" style="--m-color:${magColor(event.mag)}">${event.mag.toFixed(1)}</span>
      <div><h1>${escHtml(event.place)}</h1><p>${fmtQuakeTime(event.ts)} · ${escHtml(typeText)}</p></div>
    </div>
    <div class="qd-admin"><small>行政区划</small><b id="qdAdminName">正在识别行政区…</b></div>
    <div class="qd-facts">
      <div class="qd-fact" style="grid-column:1/-1"><small>发震时刻</small><b>${fmtQuakeFull(event.ts)}</b></div>
      <div class="qd-fact"><small>震源深度</small><b>${event.depth} km</b></div>
      <div class="qd-fact"><small>震级 / 烈度</small><b>M${event.mag.toFixed(1)}${event.intensity ? ` · ${event.intensity} 度` : ''}</b></div>
      <div class="qd-fact"><small>数据来源</small><b>${escHtml(sourceText)}</b></div>
      <div class="qd-fact"><small>测定类型</small><b>${escHtml(typeText)}</b></div>
      <div class="qd-fact" style="grid-column:1/-1"><small>震中坐标</small><b>${event.lon.toFixed(2)}°E · ${event.lat.toFixed(2)}°N</b></div>
    </div>
    <div class="qd-ringkey"><span><i></i>10 km</span><span><i style="border-color:#ea7a3b"></i>30 km</span><span><i style="border-color:#e0a51b"></i>50 km</span></div>
    <div class="qd-actions">
      <button class="qd-btn primary" type="button" data-qd-locate>回到震中</button>
      <button class="qd-btn" type="button" data-qd-back>返回列表</button>
    </div>
    <p class="qd-note">卫星影像与行政边界均为 GCJ-02 坐标，震中显示已自动纠偏；界址仅供参考，不作为权威依据。</p>`;
  }

  function renderQuakeDetailOverlays(event) {
    const map = quakeDetailState.map;
    if (!map) return;
    if (quakeDetailState.marker) map.removeLayer(quakeDetailState.marker);
    if (quakeDetailState.rings) map.removeLayer(quakeDetailState.rings);
    if (quakeDetailState.adminGroup) map.removeLayer(quakeDetailState.adminGroup);
    quakeDetailState.adminGroup = null;
    quakeDetailState.admin = null;
    const [lon, lat] = wgs84ToGcj02(event.lon, event.lat);
    quakeDetailState.center = [lat, lon];
    map.setView([lat, lon], window.innerWidth < 760 ? 9 : 10, { animate: false });
    const icon = L.divIcon({
      className: 'quake-epi',
      html: `<span class="qe-halo"></span><span class="qe-ring"></span><span class="qe-dot" style="--c:${magColor(event.mag)}"></span>`,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });
    quakeDetailState.marker = L.marker([lat, lon], { icon, zIndexOffset: 1000 })
      .addTo(map)
      .bindTooltip(`震中 M${event.mag.toFixed(1)} · ${escHtml(event.place)}`, {
        permanent: true,
        direction: 'top',
        offset: [0, -14],
        className: 'qd-epi-tip',
      });
    quakeDetailState.rings = L.layerGroup([
      L.circle([lat, lon], { radius: 10000, color: '#d8452f', weight: 1, opacity: 0.7, dashArray: '4 5', fill: false, interactive: false }),
      L.circle([lat, lon], { radius: 30000, color: '#ea7a3b', weight: 1, opacity: 0.65, dashArray: '4 5', fill: false, interactive: false }),
      L.circle([lat, lon], { radius: 50000, color: '#e0a51b', weight: 1, opacity: 0.6, dashArray: '4 5', fill: false, interactive: false }),
    ]).addTo(map);
  }

  async function openQuakeDetail(id) {
    const seq = ++quakeDetailState.seq;
    quakeDetailPageEl.setAttribute('aria-hidden', 'false');
    quakePageEl.setAttribute('aria-hidden', 'true');
    document.body.classList.add('quake-open', 'quake-detail-open');
    stopQuakeTimer();
    initQuakeDetailMap();
    if (!quakeState.events.length) await loadQuakeData(false);
    if (seq !== quakeDetailState.seq) return;
    const event = quakeState.events.find((e) => e.id === id);
    if (!event) {
      toast('该地震记录已不在最新列表中');
      closeQuakeDetail();
      location.hash = '#/earthquake';
      return;
    }
    quakeState.selectedId = id;
    quakeDetailState.eventId = id;
    renderQuakeDetailOverlays(event);
    renderQuakeDetailInfo(event);
    setTimeout(() => quakeDetailState.map && quakeDetailState.map.invalidateSize(), 80);
    const [glon, glat] = wgs84ToGcj02(event.lon, event.lat);
    resolveQuakeAdmin(glon, glat)
      .then((admin) => {
        if (seq !== quakeDetailState.seq || quakeDetailState.eventId !== id) return;
        quakeDetailState.admin = admin;
        updateQuakeAdminInfo(admin);
        renderQuakeAdminLayers(admin);
      })
      .catch(() => {
        if (seq !== quakeDetailState.seq) return;
        const el = $('#qdAdminName');
        if (el) el.textContent = '行政区识别失败，仍可查看地形';
      });
  }

  function closeQuakeDetail() {
    quakeDetailState.seq++;
    if (!quakeDetailPageEl) return;
    quakeDetailPageEl.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('quake-detail-open');
  }

  function setQuakeDetailBase(base) {
    if (!quakeDetailState.map || base === quakeDetailState.base) return;
    const map = quakeDetailState.map;
    map.removeLayer(base === 'sat' ? quakeDetailState.vecLayer : quakeDetailState.satLayer);
    (base === 'sat' ? quakeDetailState.satLayer : quakeDetailState.vecLayer).addTo(map);
    quakeDetailState.base = base;
    $$('#qdBase button').forEach((b) => b.classList.toggle('active', b.dataset.base === base));
    const label = $('#qdSceneLabel');
    if (label) label.textContent = base === 'sat' ? '卫星地形 · 行政边界' : '标准地图 · 行政边界';
  }

  function setQuakeAdminVisible(on) {
    quakeDetailState.adminOn = on;
    const group = quakeDetailState.adminGroup;
    if (!group || !quakeDetailState.map) return;
    if (on) group.addTo(quakeDetailState.map);
    else quakeDetailState.map.removeLayer(group);
  }

  /* ---------------- map title / status ---------------- */
  const fmtDate = (iso) => (iso || '').slice(0, 10);
  const fmtTime = (iso) => (iso || '').slice(11, 16);

  function renderMeta() {
    const m = METRICS[state.metric];
    $('#mapMetric').textContent = m.title;
    const t = fmtTime(state.data.fetchedAt);
    const d = fmtDate(state.data.fetchedAt);
    $('#mapTime').textContent = d && t ? `${d} ${t}` : '数据时间未知';
    $('#mapSource').textContent = state.data.source === 'cache' ? '中央气象台 · 缓存' : '中央气象台站点实况';
  }

  function setStatus(kind, text) {
    const chip = $('#statusChip');
    chip.classList.toggle('loading', kind === 'loading');
    chip.classList.toggle('warn', kind === 'warn');
    $('#statusText').textContent = text;
  }

  /* ---------------- render all ---------------- */
  function renderAll() {
    renderMeta();
    renderLegend();
    renderOverview();
    renderRankCard();
    if (!chart) {
      chart = echarts.init(mapEl, null, { renderer: 'canvas' });
      chart.setOption(buildOption());
      chart.on('click', (p) => {
        const ev = p.event || {};
        const x = Number.isFinite(ev.offsetX) ? ev.offsetX : ev.zrX;
        const y = Number.isFinite(ev.offsetY) ? ev.offsetY : ev.zrY;
        let city = null;
        if (Number.isFinite(x) && Number.isFinite(y)) {
          let bestD = Infinity;
          CITY_BY_ADCODE.forEach((entry) => {
            const pt = chart.convertToPixel({ geoIndex: 0 }, entry.center);
            const d = Math.hypot(pt[0] - x, pt[1] - y);
            if (d < bestD) { bestD = d; city = entry; }
          });
          if (bestD > (isMobile() ? 36 : 24)) city = null;
        }
        if (!city) city = (p.data && p.data.adcode && CITY_BY_ADCODE.get(p.data.adcode)) || CITY_BY_NAME.get(p.name);
        if (city) openSheet(city.adcode);
      });
      chart.on('georoam', () => {
        chart.dispatchAction({ type: 'hideTip' });
        scheduleLabelDensity();
      });
      fitMap();
    } else {
      chart.setOption({
        geo: { regions: cityRegions() },
        series: [
          { id: 'labels', data: labelSeriesData(), label: { rich: labelRich() } },
          { id: 'capLabels', data: capSeriesData(), label: { rich: labelRich() } },
        ],
      });
    }
    const t = fmtTime(state.data.fetchedAt);
    setStatus(state.data.live ? 'live' : 'warn', `${state.data.live ? '实况' : '快照'} ${t || '—'}`);
    if (state.sheet) renderSheet();
  }

  function throttle(fn, wait) {
    let last = 0;
    let timer = null;
    return function () {
      const now = Date.now();
      const remain = wait - (now - last);
      if (remain <= 0) {
        last = now;
        fn();
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          last = Date.now();
          fn();
        }, remain);
      }
    };
  }

  /* ---------------- detail sheet ---------------- */
  const sheet = $('#sheet');
  const sheetBody = $('#sheetBody');

  function openSheet(adcode) {
    if (chart) chart.dispatchAction({ type: 'hideTip' });
    state.sheet = adcode;
    state.sheetOpenedAt = Date.now();
    renderSheet();
    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');
    syncBodyLock();
    sheetBody.scrollTop = 0;
  }

  function closeSheet() {
    state.sheet = null;
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
    syncBodyLock();
  }

  function renderSheet() {
    const ad = state.sheet;
    const city = CITY_BY_ADCODE.get(ad);
    const w = state.data.cities[ad];
    const updated = $('#stUpdated');
    if (updated) updated.textContent = w && w.pub ? `${w.pub} 更新` : '';
    if (!city) return;
    if (!w) {
      sheetBody.innerHTML = `<div class="st-hero"><div class="st-loc"><h3>${city.short}</h3><span class="province">${city.province}</span></div><p class="tt-sub" style="padding:16px 0">该站点暂无实况数据</p></div>`;
      return;
    }
    const tText = w.t == null ? '—' : (Math.round(w.t * 10) / 10).toFixed(1);
    const windLevel = beaufort(w.windSpeed);
    const alert = w.alert
      ? `<div class="st-alert">⚠ ${w.alert.title || '气象预警'}${w.alert.level && !(w.alert.title || '').includes(w.alert.level) ? `（${w.alert.level}）` : ''}</div>`
      : '';
    const stats = [
      { k: '体感温度', v: w.feels == null ? '—' : fix1(w.feels), u: '°C' },
      { k: '相对湿度', v: w.rh == null ? '—' : w.rh, u: '%' },
      { k: '风向风力', v: windLevel == null ? '—' : `${windLevel} 级`, s: w.windDir || '' },
      { k: '本站气压', v: w.pressure == null ? '—' : Math.round(w.pressure), u: 'hPa' },
      { k: '空气质量', v: w.aqi == null ? '—' : w.aqi, s: w.aqiText || '' },
      { k: '日出 / 日落', v: `${w.sunrise ? w.sunrise.slice(11, 16) : '—'} / ${w.sunset ? w.sunset.slice(11, 16) : '—'}` },
    ];
    const hourly = w.hourly || [];
    sheetBody.innerHTML = `
      <header class="st-hero">
        <div class="st-loc">
          <h3>${city.short}</h3>
          <span class="province">${city.province}</span>
          <span class="station">${w.stationName || ''}站 · 站号 ${w.station || ''}</span>
        </div>
        <div class="st-now">
          <span class="w-icon">${iconSvg(w.img !== '9999' ? w.img : (w.forecast && w.forecast[0] ? w.forecast[0].dayImg : null), weatherText(w) || (w.forecast && w.forecast[0] ? w.forecast[0].dayText : ''))}</span>
          <div class="st-temp"><strong>${tText}</strong><span>°C</span></div>
          <div class="st-desc">
            ${weatherText(w) ? `<b>${weatherText(w)}</b>` : ''}
            <span>体感 ${w.feels == null ? '—' : fix1(w.feels)}° · 今日 ${w.tmin == null ? '—' : w.tmin}° ~ ${w.tmax == null ? '—' : w.tmax}°</span>
            <span>近 24 小时降水 ${fix1(w.rain24h)} mm</span>
          </div>
        </div>
      </header>
      ${alert}
      <div class="st-stats">
        ${stats
          .map(
            (s) => `<div class="st-stat"><div class="k">${s.k}</div><div class="v">${s.v}${s.u ? `<small>${s.u}</small>` : ''}${s.s ? `<small>${s.s}</small>` : ''}</div></div>`
          )
          .join('')}
      </div>
      <div class="st-charts">
        <section class="st-card">
          <h4>近 24 小时气温 <span>°C</span></h4>
          ${lineChart(hourly, 't', { color: '#ef9a5c', id: 'temp' })}
        </section>
        <section class="st-card">
          <h4>近 24 小时风速 <span>m/s</span></h4>
          ${lineChart(hourly, 'wind', { color: '#3aa3a8', id: 'wind' })}
        </section>
      </div>
      <section class="st-card st-rain">
        <h4>逐小时降水 <span>累计 ${fix1(w.rain24h)} mm</span></h4>
        ${rainChart(hourly)}
      </section>
      <section class="st-card st-week">
        <h4>未来 7 天 <span>${w.forecastPub ? '预报 ' + w.forecastPub.slice(11, 16) : ''}</span></h4>
        ${weekList(w.forecast || [])}
      </section>
      <div class="st-foot">
        数据来源：中央气象台（nmc.cn）· ${w.stationName || ''}国家气象站<br />
        实况 ${w.pub || '—'} · 预报 ${w.forecastPub || w.pub || '—'}
      </div>`;
  }

  function lineChart(hourly, field, opts) {
    const pts = (hourly || []).filter((h) => h && typeof h[field] === 'number');
    if (pts.length < 2) return `<p class="tt-sub" style="padding:6px 0">暂无逐小时观测</p>`;
    const W = 340;
    const H = 118;
    const L = 10;
    const R = 10;
    const T = 18;
    const B = 22;
    const values = pts.map((p) => p[field]);
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (max - min < 2) {
      min -= 1;
      max += 1;
    } else {
      const pad = (max - min) * 0.18;
      min -= pad;
      max += pad;
    }
    const x = (i) => L + ((W - L - R) * i) / (pts.length - 1);
    const y = (v) => T + (H - T - B) * (1 - (v - min) / (max - min));
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[field]).toFixed(1)}`).join('');
    const area = `${line}L${x(pts.length - 1).toFixed(1)},${H - B}L${L},${H - B}Z`;
    const last = pts[pts.length - 1];
    const dec = opts.id === 'wind' ? 1 : 1;
    const labels = [pts[0].time, pts[Math.floor(pts.length / 2)].time, last.time]
      .map(
        (t, i) =>
          `<text x="${i === 0 ? L : i === 1 ? W / 2 : W - R}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === 1 ? 'middle' : 'end'}">${t}</text>`
      )
      .join('');
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="grad-${opts.id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${opts.color}" stop-opacity=".26" />
          <stop offset="100%" stop-color="${opts.color}" stop-opacity=".02" />
        </linearGradient>
      </defs>
      <line x1="${L}" y1="${T}" x2="${W - R}" y2="${T}" stroke="rgba(20,60,80,.06)" />
      <line x1="${L}" y1="${(T + H - B) / 2}" x2="${W - R}" y2="${(T + H - B) / 2}" stroke="rgba(20,60,80,.05)" stroke-dasharray="3 4" />
      <line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="rgba(20,60,80,.1)" />
      <path d="${area}" fill="url(#grad-${opts.id})" />
      <path d="${line}" fill="none" stroke="${opts.color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="${x(pts.length - 1).toFixed(1)}" cy="${y(last[field]).toFixed(1)}" r="3.4" fill="#fff" stroke="${opts.color}" stroke-width="2.2" />
      <text x="${W - R}" y="${T - 4}" text-anchor="end">最大 ${Math.max(...values).toFixed(dec)}</text>
      <text x="${L}" y="${T - 4}" text-anchor="start">最小 ${Math.min(...values).toFixed(dec)}</text>
      ${labels}
    </svg>`;
  }

  function rainChart(hourly) {
    const bars = (hourly || []).map((h) => ({ time: h.time, v: typeof h.rain === 'number' ? h.rain : 0 }));
    if (!bars.length) return `<p class="tt-sub" style="padding:6px 0">暂无逐小时观测</p>`;
    const W = 340;
    const H = 96;
    const L = 10;
    const R = 10;
    const T = 12;
    const B = 20;
    const max = Math.max(0.5, ...bars.map((b) => b.v));
    const gap = (W - L - R) / bars.length;
    const bw = Math.max(2.5, gap * 0.58);
    const total = bars.reduce((s, b) => s + b.v, 0);
    if (total <= 0.05) return '<p class="chart-empty">过去 24 小时无明显降水</p>';
    const rects = bars
      .map((b, i) => {
        if (b.v <= 0) return `<rect x="${(L + gap * i + (gap - bw) / 2).toFixed(1)}" y="${H - B - 2}" width="${bw.toFixed(1)}" height="2" rx="1" fill="rgba(70,130,170,.14)" />`;
        const h = Math.max(3, ((H - T - B) * b.v) / max);
        const alpha = 0.45 + 0.55 * (b.v / max);
        return `<rect x="${(L + gap * i + (gap - bw) / 2).toFixed(1)}" y="${(H - B - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1.6" fill="rgba(58,140,200,${alpha.toFixed(2)})" />`;
      })
      .join('');
    const ticks = [0, 6, 12, 18, bars.length - 1].map(
      (i) =>
        `<text x="${(L + gap * i + gap / 2).toFixed(1)}" y="${H - 5}" text-anchor="${i === 0 ? 'start' : i === bars.length - 1 ? 'end' : 'middle'}">${bars[i].time}</text>`
    ).join('');
    const emptyText = total <= 0.05 ? `<text x="${W / 2}" y="${(H - T - B) / 2 + 4}" text-anchor="middle" fill="#93a6b2">过去 24 小时无明显降水</text>` : '';
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="rgba(20,60,80,.12)" />
      ${rects}
      ${ticks}
      ${emptyText}
    </svg>`;
  }

  const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  function weekList(days) {
    if (!days.length) return `<p class="tt-sub" style="padding:6px 0">暂无预报</p>`;
    const highs = days.map((d) => d.tmax).filter((v) => v != null);
    const lows = days.map((d) => d.tmin).filter((v) => v != null);
    const wmin = Math.min(...lows);
    const wmax = Math.max(...highs);
    const span = Math.max(1, wmax - wmin);
    const today = new Date();
    return `<ul class="week">${days
      .map((d, i) => {
        const dt = new Date(`${d.date}T00:00:00`);
        const isToday = dt.toDateString() === today.toDateString();
        const dateLabel = `${dt.getMonth() + 1}/${dt.getDate()}`;
        const dayLabel = isToday ? '今天' : i === 1 ? '明天' : WEEKDAYS[dt.getDay()];
        const left = d.tmin == null ? 0 : ((d.tmin - wmin) / span) * 100;
        const width = d.tmax == null || d.tmin == null ? 8 : Math.max(8, ((d.tmax - d.tmin) / span) * 100);
        return `<li>
          <span class="day"><b>${dayLabel}</b>${dateLabel}</span>
          <span class="icon">${iconSvg(null, d.dayText)}</span>
          <span class="range"><i style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%"></i></span>
          <span class="temps"><b>${d.tmax == null ? '—' : d.tmax}°</b><span>${d.tmin == null ? '—' : d.tmin}°</span></span>
        </li>`;
      })
      .join('')}</ul>`;
  }

  /* ---------------- live data ---------------- */
  const CACHE_KEY = 'huanan-nmc-v1';
  const CACHE_TTL = 10 * 60 * 1000;

  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.data || !parsed.ts) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function writeCache(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
    } catch (e) {
      /* quota or privacy mode */
    }
  }

  function parseStation(json, stationCode, stationName) {
    const d = json.data || {};
    const real = d.real || {};
    const weather = real.weather || {};
    const wind = real.wind || {};
    const predict = (d.predict && d.predict.detail) || [];
    const today = predict[0] || {};
    const passed = (d.passedchart || [])
      .filter((p) => p && p.time)
      .slice(0, 24)
      .reverse()
      .map((p) => ({
        time: p.time.slice(11, 16),
        t: num(p.temperature),
        rain: num(p.rain1h),
        wind: num(p.windSpeed),
      }));
    const air = d.air || {};
    const warn = real.warn || {};
    const dayW = (today.day && today.day.weather) || {};
    const nightW = (today.night && today.night.weather) || {};
    const rawPassed = (d.passedchart && d.passedchart[0]) || {};
    const sun = real.sunriseSunset || {};
    return {
      station: stationCode,
      stationName,
      pub: real.publish_time || '',
      t: num(weather.temperature),
      feels: num(weather.feelst),
      rh: num(weather.humidity),
      rainNow: num(weather.rain),
      info: weather.info && weather.info !== '9999' ? weather.info : '',
      img: weather.img || '',
      windSpeed: num(wind.speed),
      windDir: wind.direct && wind.direct !== '9999' ? wind.direct : '',
      windPower: wind.power && wind.power !== '9999' ? wind.power : '',
      aqi: num(air.aqi),
      aqiText: air.text && air.text !== '9999' ? air.text : '',
      pressure: num(rawPassed.pressure) != null ? num(rawPassed.pressure) : num(weather.airpressure),
      sunrise: sun.sunrise && sun.sunrise !== '9999' ? sun.sunrise : '',
      sunset: sun.sunset && sun.sunset !== '9999' ? sun.sunset : '',
      tmax: Number(dayW.temperature) || null,
      tmin: Number(nightW.temperature) || null,
      precipToday: num(today.precipitation),
      hourly: passed,
      alert:
        warn.alert && warn.alert !== '9999'
          ? { title: warn.alert, level: warn.signallevel, type: warn.signaltime || warn.signaltype }
          : null,
      forecast: predict.slice(0, 7).map((p) => ({
        date: p.date,
        dayText: (p.day && p.day.weather && p.day.weather.info) || '',
        nightText: (p.night && p.night.weather && p.night.weather.info) || '',
        dayImg: (p.day && p.day.weather && p.day.weather.img) || '',
        nightImg: (p.night && p.night.weather && p.night.weather.img) || '',
        tmax: Number(p.day && p.day.weather && p.day.weather.temperature) || null,
        tmin: Number(p.night && p.night.weather && p.night.weather.temperature) || null,
      })),
    };
  }

  async function fetchStation(code) {
    const res = await fetch(`https://www.nmc.cn/rest/weather?stationid=${encodeURIComponent(code)}`, {
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.data) throw new Error('empty');
    return json;
  }

  async function refreshLive(manual) {
    if (state.refreshing) return;
    const cache = readCache();
    if (!manual && cache && Date.now() - cache.ts < CACHE_TTL) {
      state.data = { ...normalize(cache.data), live: true };
      renderAll();
      return;
    }
    const entries = Object.entries(state.data.cities);
    if (!entries.length) return;
    state.refreshing = true;
    $('#refreshBtn').classList.add('loading');
    const total = entries.length;
    let done = 0;
    let failed = 0;
    const cities = { ...state.data.cities };
    const queue = entries.slice();
    setStatus('loading', `更新实况 0/${total}`);

    async function worker() {
      while (queue.length) {
        const [ad, old] = queue.shift();
        try {
          const json = await fetchStation(old.station);
          const city = CITY_BY_ADCODE.get(Number(ad));
          cities[ad] = parseStation(json, old.station, city ? city.short : '');
        } catch (e) {
          failed++;
        }
        await new Promise((r) => setTimeout(r, 60));
        done++;
        if (done % 4 === 0 || done === total) setStatus('loading', `更新实况 ${done}/${total}`);
      }
    }

    try {
      await Promise.all([worker(), worker(), worker(), worker()]);
      if (failed === total) throw new Error('all failed');
      let latest = '';
      Object.values(cities).forEach((c) => {
        if (c.pub && c.pub > latest) latest = c.pub;
      });
      const data = normalize({ source: 'nmc', fetchedAt: latest.replace(' ', 'T'), cities });
      data.live = true;
      state.data = data;
      writeCache({ source: 'nmc', fetchedAt: data.fetchedAt, cities: data.cities });
      renderAll();
      loadRanking(state.metric, true);
      if (manual) toast(failed ? `已更新 ${total - failed} 个城市，${failed} 个站点失败` : '已更新全部城市实况');
    } catch (e) {
      state.data.live = false;
      renderAll();
      if (manual) toast('中央气象台暂不可用，正在显示离线快照');
    } finally {
      state.refreshing = false;
      $('#refreshBtn').classList.remove('loading');
    }
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  /* ---------------- zoom ---------------- */
  function setZoom(next) {
    if (!chart) return;
    const opt = chart.getOption();
    const current = (opt.geo && opt.geo[0] && opt.geo[0].zoom) || 1;
    const zoom = Math.min(8, Math.max(0.9, next));
    if (Math.abs(zoom - current) < 0.001) return;
    chart.setOption({ geo: { zoom } });
    setTimeout(updateLabelDensity, 60);
  }

  function selectMetric(metric) {
    if (!METRICS[metric] || metric === state.metric) return;
    state.metric = metric;
    $$('#metricTabs .tab').forEach((t) => {
      const active = t.dataset.metric === metric;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    renderMeta();
    renderLegend();
    renderOverview();
    if (chart) {
      chart.setOption({
        geo: { regions: cityRegions() },
        series: [
          { id: 'labels', data: labelSeriesData(), label: { rich: labelRich() }, labelLayout: labelLayoutForZoom(currentGeoZoom()) },
          { id: 'capLabels', data: capSeriesData(), label: { rich: labelRich() } },
        ],
      });
    }
    if (state.sheet) renderSheet();
    loadRanking(metric);
  }

  function bindUI() {
    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-warning-view]');
      if (!button) return;
      const view = button.dataset.warningView;
      try { localStorage.setItem('qxksh.warningView', view); } catch (e) { /* ignore */ }
      document.querySelectorAll('[data-warning-view]').forEach((item) => {
        const active = item.dataset.warningView === view;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
      });
      const hash = view === 'classic' ? '#/warning-classic' : '#/warning';
      if (location.hash === hash) applyRoute();
      else location.hash = hash;
    });
    $('#funcEntry').addEventListener('click', openCenter);
    $('#centerBack').addEventListener('click', closeCenter);
    $('#centerSearch').addEventListener('input', (e) => {
      centerState.query = e.target.value;
      renderCenterCards();
    });
    $('#centerChips').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      centerState.filter = btn.dataset.cat;
      renderCenterCards();
    });
    $('#centerGrid').addEventListener('click', (e) => {
      const star = e.target.closest('.fc-star');
      if (star) {
        const id = star.dataset.fav;
        const wasFav = centerState.favs.has(id);
        if (wasFav) centerState.favs.delete(id);
        else centerState.favs.add(id);
        saveCenterFavs();
        renderCenterCards();
        toast(wasFav ? '已取消收藏' : '已收藏');
        return;
      }
      const card = e.target.closest('.feature-card');
      if (!card) return;
      activateFeature(card);
    });
    $('#centerGrid').addEventListener('keydown', (e) => {
      if (e.target.closest('.fc-star')) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('.feature-card');
      if (!card) return;
      e.preventDefault();
      activateFeature(card);
    });
    $('#quakeBack').addEventListener('click', () => {
      location.hash = '#/center';
    });
    $('#quakeRefresh').addEventListener('click', () => loadQuakeData(true));
    $('#quakeScope').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      quakeState.scope = btn.dataset.scope;
      $$('#quakeScope button').forEach((b) => b.classList.toggle('active', b === btn));
      renderQuake();
    });
    $('#quakeList').addEventListener('click', (e) => {
      const row = e.target.closest('.quake-row');
      if (row) selectQuake(row.dataset.quake);
    });
    $('#quakeFocus').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-quake-open]');
      if (btn) location.hash = `#/earthquake/${encodeURIComponent(btn.dataset.quakeOpen)}`;
    });
    $('#quakeDetailBack').addEventListener('click', () => {
      location.hash = '#/earthquake';
    });
    $('#qdBase').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-base]');
      if (btn) setQuakeDetailBase(btn.dataset.base);
    });
    $('#qdAdminToggle').addEventListener('change', (e) => {
      setQuakeAdminVisible(e.target.checked);
    });
    $('#qdInfo').addEventListener('click', (e) => {
      if (e.target.closest('[data-qd-back]')) {
        location.hash = '#/earthquake';
        return;
      }
      if (e.target.closest('[data-qd-locate]') && quakeDetailState.map && quakeDetailState.center) {
        quakeDetailState.map.setView(quakeDetailState.center, window.innerWidth < 760 ? 9 : 10);
      }
    });
    window.addEventListener(
      'resize',
      throttle(() => {
        if (document.body.classList.contains('quake-open') && quakeState.chart) quakeState.chart.resize();
        if (quakeDetailState.map && document.body.classList.contains('quake-detail-open')) quakeDetailState.map.invalidateSize();
      }, 150)
    );
    window.addEventListener('hashchange', applyRoute);

    $('#metricTabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      if (tab.dataset.action === 'radar') {
        openRadarSheet();
        return;
      }
      selectMetric(tab.dataset.metric);
    });

    $$('.zoom-controls button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.zoom;
        if (action === 'reset') {
          chart.setOption({ geo: { zoom: 1, center: INITIAL_CENTER } });
          setTimeout(updateLabelDensity, 60);
          return;
        }
        const opt = chart.getOption();
        const current = (opt.geo && opt.geo[0] && opt.geo[0].zoom) || 1;
        setZoom(current * (action === 'in' ? 1.35 : 1 / 1.35));
      });
    });

    $('#refreshBtn').addEventListener('click', () => refreshLive(true));

    $('#rankOpen').addEventListener('click', openRankSheet);
    $('#rankMore').addEventListener('click', openRankSheet);
    $('#rankList').addEventListener('click', (e) => {
      const row = e.target.closest('.rank-row');
      if (row && row.dataset.ad) openSheet(Number(row.dataset.ad));
    });
    rankSheetEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-close-rank]')) closeRankSheet();
    });
    $('#rankScope').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.scope === 'station' && !state.rank.supportsAll) return;
      state.rank.scope = btn.dataset.scope;
      renderRankSheet();
    });
    $('#rankSearch').addEventListener('input', throttle(renderRankSheet, 120));
    radarSheetEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-close-radar]')) closeRadarSheet();
    });
    $('#radarPlay').addEventListener('click', toggleRadarPlay);
    $('#radarEntry').addEventListener('click', openRadarSheet);
    $('#radarThumbs').addEventListener('click', (e) => {
      const tb = e.target.closest('.radar-thumb');
      if (!tb) return;
      stopRadarPlay();
      renderRadarFrame(Number(tb.dataset.index));
    });
    $('#radarSlider').addEventListener('input', (e) => {
      stopRadarPlay();
      renderRadarFrame(Number(e.target.value));
    });

    $$('#radarModes button').forEach((b) => b.addEventListener('click', () => switchRadarMode(b.dataset.mode)));
    $$('#radarProvs button').forEach((b) =>
      b.addEventListener('click', () => {
        const mode = RADAR_PROVINCE_MODE[b.dataset.prov] || 'nation';
        switchRadarMode(mode);
        $$('#radarProvs button').forEach((x) => x.classList.toggle('active', x === b));
      })
    );
    $$('#radarZoom button').forEach((b) =>
      b.addEventListener('click', () => {
        if (!radarState.view) return;
        const cx = radarStage.clientWidth / 2;
        const cy = radarStage.clientHeight / 2;
        const action = b.dataset.rzoom;
        if (action === 'in') zoomRadar(1.35, cx, cy);
        else if (action === 'out') zoomRadar(1 / 1.35, cx, cy);
        else if (radarState.mode === 'nation') centerRadarCrop();
        else centerRadarWhole();
      })
    );
    radarStage.addEventListener(
      'wheel',
      (e) => {
        if (!radarState.view) return;
        e.preventDefault();
        const r = radarStage.getBoundingClientRect();
        zoomRadar(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX - r.left, e.clientY - r.top);
      },
      { passive: false }
    );
    let radarDrag = null;
    let radarPinch = null;
    const radarPointers = new Map();

    function radarPointPos(e) {
      const r = radarStage.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function radarPinchState() {
      const [a, b] = [...radarPointers.values()];
      return { dist: Math.hypot(b.x - a.x, b.y - a.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }

    function beginRadarPinch() {
      const v = radarState.view;
      if (!v || radarPointers.size < 2) return;
      const s = radarPinchState();
      radarDrag = null;
      radarPinch = { dist: Math.max(1, s.dist), mx: s.mx, my: s.my, tx: v.tx, ty: v.ty, scale: v.scale };
      radarStage.classList.add('dragging');
    }

    radarStage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button') || !radarState.view) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (radarPointers.size >= 2) return;
      const pos = radarPointPos(e);
      radarPointers.set(e.pointerId, pos);
      try {
        radarStage.setPointerCapture(e.pointerId);
      } catch (err) {
        /* Synthetic or already released pointer. */
      }
      if (radarPointers.size === 1) {
        radarDrag = { x: pos.x, y: pos.y, tx: radarState.view.tx, ty: radarState.view.ty };
        radarStage.classList.add('dragging');
      } else {
        beginRadarPinch();
      }
    });

    radarStage.addEventListener('pointermove', (e) => {
      const v = radarState.view;
      if (!v || !radarPointers.has(e.pointerId)) return;
      const pos = radarPointPos(e);
      radarPointers.set(e.pointerId, pos);
      if (radarPointers.size >= 2) {
        if (!radarPinch) beginRadarPinch();
        if (!radarPinch) return;
        const s = radarPinchState();
        const next = Math.min(v.maxScale, Math.max(v.minScale, radarPinch.scale * (s.dist / radarPinch.dist)));
        const k = next / radarPinch.scale;
        v.scale = next;
        v.tx = s.mx - (radarPinch.mx - radarPinch.tx) * k;
        v.ty = s.my - (radarPinch.my - radarPinch.ty) * k;
        clampRadarView();
        applyRadarView();
        return;
      }
      if (!radarDrag) return;
      v.tx = radarDrag.tx + (pos.x - radarDrag.x);
      v.ty = radarDrag.ty + (pos.y - radarDrag.y);
      clampRadarView();
      applyRadarView();
    });

    function endRadarPointer(e) {
      if (!radarPointers.has(e.pointerId)) return;
      radarPointers.delete(e.pointerId);
      radarPinch = null;
      if (radarPointers.size === 1) {
        const pos = radarPointers.values().next().value;
        radarDrag = { x: pos.x, y: pos.y, tx: radarState.view.tx, ty: radarState.view.ty };
      } else if (!radarPointers.size) {
        radarDrag = null;
        radarStage.classList.remove('dragging');
      } else {
        beginRadarPinch();
      }
    }
    radarStage.addEventListener('pointerup', endRadarPointer);
    radarStage.addEventListener('pointercancel', endRadarPointer);
    radarStage.addEventListener('dblclick', () => {
      const v = radarState.view;
      if (!v) return;
      if (v.scale <= v.minScale * 1.05) centerRadarCrop();
      else centerRadarWhole();
    });
    $('#radarImg').addEventListener('load', () => {
      if (!radarState.view && radarState.frames.length) setupRadarView(true);
    });
    window.addEventListener(
      'resize',
      throttle(() => {
        if (radarSheetEl.classList.contains('open')) setupRadarView(true);
      }, 160)
    );
    ['#rankChips', '#rankChipsSheet'].forEach((sel) => {
      const el = $(sel);
      if (!el) return;
      el.addEventListener('click', (e) => {
        const chip = e.target.closest('.rank-chip');
        if (!chip) return;
        state.rank.province = chip.dataset.prov;
        renderRankCard();
        renderRankSheet();
      });
    });
    $('#rankFull').addEventListener('click', (e) => {
      const row = e.target.closest('.rank-row');
      if (row && row.dataset.ad) {
        closeRankSheet();
        openSheet(Number(row.dataset.ad));
      }
    });

    sheet.addEventListener('click', (e) => {
      const closer = e.target.closest('[data-close-sheet]');
      if (!closer) return;
      // Ignore only the synthetic backdrop click that follows the opening touch.
      if (closer.classList.contains('sheet-backdrop') && Date.now() - state.sheetOpenedAt < 450) return;
      closeSheet();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (document.body.classList.contains('center-open')) closeCenter();
      else if (radarSheetEl.classList.contains('open')) closeRadarSheet();
      else if (rankSheetEl.classList.contains('open')) closeRankSheet();
      else closeSheet();
    });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!chart) return;
        state.detailed = false;
        fitMap();
        renderHint();
        renderLegend();
        renderOverview();
        refreshLabels();
        setTimeout(updateLabelDensity, 120);
      }, 120);
    });

    window.addEventListener('orientationchange', () => {
      setTimeout(() => {
        fitMap();
        refreshLabels();
      }, 350);
    });
  }

  /* ---------------- boot ---------------- */
  function boot() {
    const cache = readCache();
    const fresh = cache && Date.now() - cache.ts < CACHE_TTL;
    const initial = fresh ? { ...normalize(cache.data), live: true } : normalize(SNAP);
    state.data = initial;
    renderTabs();
    bindUI();
    renderHint();
    renderAll();
    fitMap();
    loadRanking(state.metric);
    applyRoute();
    setTimeout(prefetchRanks, 3000);
    if (!fresh) refreshLive(false);
    setInterval(() => refreshLive(false), CACHE_TTL);
  }

  window.__app = {
    get chart() { return chart; },
    state,
    openSheet,
    closeSheet,
    openRankSheet,
    closeRankSheet,
    openRadarSheet,
    closeRadarSheet,
    openCenter,
    closeCenter,
    centerState,
    loadQuakeData,
    selectQuake,
    openQuakeDetail,
    quakeState,
    quakeDetailState,
    radarState,
    zoomToProvince,
  };

  boot();
})();
