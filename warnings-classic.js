(function () {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const pageEl = $('#warningClassicPage');
  const listEl = $('#warningClassicList');
  const pagerEl = $('#warningClassicPager');
  const LEVEL_COLORS = { white: '#e6f0f5', blue: '#3b82f6', yellow: '#eab308', orange: '#f97316', red: '#dc2626' };
  const LEVEL_NAMES = { white: '白色', blue: 'Ⅳ级', yellow: 'Ⅲ级', orange: 'Ⅱ级', red: 'Ⅰ级' };
  const LEVEL_TITLES = { white: '白色', blue: '蓝色', yellow: '黄色', orange: '橙色', red: '红色' };
  const state = { open: false, province: '广东省', type: 'all', level: 'all', time: 'all', city: 'all', page: 0 };
  const warningUtils = (window.WarningPage && window.WarningPage.utils) || {
    listPageSize: () => 10,
    clampPage: (page, pages) => Math.max(0, Math.min(Math.max(1, pages) - 1, page)),
    pagerHtml: () => '',
  };
  let chart = null;
  const charts = new Map();
  let provinceTouched = false;
  const registeredMaps = new Set();
  const constants = (window.WarningPage && window.WarningPage.constants) || { PROVINCES: [], PROVINCE_SHORT: {} };
  const MAP_DATA = window.MAP_DATA || { cities: { features: [] }, provinces: [] };
  const PROVINCES = constants.PROVINCES.map((full) => {
    const meta = MAP_DATA.provinces.find((item) => item.full === full) || {};
    return { full, short: meta.name || constants.PROVINCE_SHORT[full] || full, adcode: meta.adcode || null };
  });
  const HKMO_GEO = (window.HKMO_GEO && Array.isArray(window.HKMO_GEO.features)) ? window.HKMO_GEO.features : [];
  const GD_COUNTIES = (window.GD_COUNTIES && Array.isArray(window.GD_COUNTIES.features)) ? window.GD_COUNTIES.features : [];
  const GD_ROTATION = 0;
  const GD_ROTATION_CENTER = [113.48, 22.85];

  function rotatePoint(point, deg = GD_ROTATION, center = GD_ROTATION_CENTER) {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = point[0] - center[0];
    const dy = point[1] - center[1];
    return [center[0] + dx * cos - dy * sin, center[1] + dx * sin + dy * cos];
  }

  function rotateFeatures(features, deg = GD_ROTATION, center = GD_ROTATION_CENTER) {
    if (!deg) return features;
    const walk = (coords) => (typeof coords[0] === 'number' ? rotatePoint(coords, deg, center) : coords.map(walk));
    return features.map((feature) => ({
      ...feature,
      geometry: { type: feature.geometry.type, coordinates: walk(feature.geometry.coordinates) },
    }));
  }

  let gdRotated = null;

  function rotatedGd() {
    if (gdRotated) return gdRotated;
    const counties = rotateFeatures(GD_COUNTIES);
    const hkmo = rotateFeatures(HKMO_GEO);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const scan = (features) => features.forEach((feature) => {
      const walk = (coords) => {
        if (typeof coords[0] === 'number') {
          if (coords[0] < minX) minX = coords[0];
          if (coords[0] > maxX) maxX = coords[0];
          if (coords[1] < minY) minY = coords[1];
          if (coords[1] > maxY) maxY = coords[1];
          return;
        }
        coords.forEach(walk);
      };
      walk(feature.geometry.coordinates);
    });
    scan(counties);
    scan(hkmo);
    gdRotated = { counties, hkmo, bounds: [minX, minY, maxX, maxY] };
    return gdRotated;
  }

  function countyLayout(el = $('#warningClassicMap')) {
    const width = (el && el.clientWidth) || 800;
    const height = (el && el.clientHeight) || 700;
    const [minX, minY, maxX, maxY] = rotatedGd().bounds;
    const aspect = (maxX - minX) / (maxY - minY);
    const target = Math.min(width * 0.94, height * 0.92 * aspect);
    const sizePct = (target / height) * 100;
    return { layoutCenter: ['50%', '50%'], layoutSize: `${sizePct.toFixed(2)}%` };
  }

  const HKMO_META = {
    hk: { short: '香港', province: '香港特别行政区', lon: 114.17, lat: 22.32, anchor: [114.34, 22.22] },
    mo: { short: '澳门', province: '澳门特别行政区', lon: 113.55, lat: 22.19, anchor: [113.9, 21.8] },
  };
  const HKMO_PROVINCE = '广东省';

  const TEST_MODE = new URLSearchParams(location.search).get('warnTest') === '1'
    || new URLSearchParams(location.search).get('hkmoMock') === '1';
  const TEST_TYPES = Array.isArray(constants.TYPES) ? constants.TYPES : [];
  const TEST_LEVELS = constants.LEVELS || {};
  const HK_ICON = 'https://www.hko.gov.hk/tc/wxinfo/dailywx/images/';
  const HK_SIGNALS = [
    { group: 'hk', id: 'hk1', name: '一号戒备信号', rank: 30, tone: '#3b82f6', icon: `${HK_ICON}tc1.gif` },
    { group: 'hk', id: 'hk3', name: '三号强风信号', rank: 40, tone: '#eab308', icon: `${HK_ICON}tc3.gif` },
    { group: 'hk', id: 'hk8ne', name: '八号东北烈风或暴风信号', rank: 70, tone: '#ea580c', icon: `${HK_ICON}tc8ne.gif` },
    { group: 'hk', id: 'hk8nw', name: '八号西北烈风或暴风信号', rank: 70, tone: '#ea580c', icon: `${HK_ICON}tc8nw.gif` },
    { group: 'hk', id: 'hk8se', name: '八号东南烈风或暴风信号', rank: 70, tone: '#ea580c', icon: `${HK_ICON}tc8se.gif` },
    { group: 'hk', id: 'hk8sw', name: '八号西南烈风或暴风信号', rank: 70, tone: '#ea580c', icon: `${HK_ICON}tc8sw.gif` },
    { group: 'hk', id: 'hk9', name: '九号烈风或暴风风力增强信号', rank: 80, tone: '#b91c1c', icon: `${HK_ICON}tc9.gif` },
    { group: 'hk', id: 'hk10', name: '十号飓风信号', rank: 90, tone: '#991b1b', icon: `${HK_ICON}tc10.gif` },
    { group: 'hk', id: 'hkRainY', name: '黄色暴雨警告信号', rank: 40, tone: '#eab308', icon: `${HK_ICON}raina.gif` },
    { group: 'hk', id: 'hkRainR', name: '红色暴雨警告信号', rank: 50, tone: '#dc2626', icon: `${HK_ICON}rainr.gif` },
    { group: 'hk', id: 'hkRainB', name: '黑色暴雨警告信号', rank: 60, tone: '#1f2937', icon: `${HK_ICON}rainb.gif` },
    { group: 'hk', id: 'hkThunder', name: '雷暴警告', rank: 20, tone: '#6a5f9e', icon: `${HK_ICON}ts.gif` },
    { group: 'hk', id: 'hkCold', name: '寒冷天气警告', rank: 20, tone: '#2563eb', icon: `${HK_ICON}cold.gif` },
    { group: 'hk', id: 'hkHot', name: '酷热天气警告', rank: 20, tone: '#c56a23', icon: `${HK_ICON}vhot.gif` },
    { group: 'hk', id: 'hkMonsoon', name: '强烈季候风信号', rank: 30, tone: '#5f8b9e', icon: `${HK_ICON}msn.gif` },
    { group: 'hk', id: 'hkLandslip', name: '山泥倾泻警告', rank: 20, tone: '#8a5a3a', icon: `${HK_ICON}landslip.gif` },
    { group: 'hk', id: 'hkFireY', name: '火灾危险警告（黄色）', rank: 30, tone: '#eab308', icon: `${HK_ICON}firey.gif` },
    { group: 'hk', id: 'hkFireR', name: '火灾危险警告（红色）', rank: 40, tone: '#dc2626', icon: `${HK_ICON}firer.gif` },
    { group: 'hk', id: 'hkFlood', name: '新界北部水浸特别报告', rank: 20, tone: '#2f6fa8', icon: `${HK_ICON}ntfl.gif` },
  ];
  const OFFICIAL_ICON_NAMES = {
    typhoon: '台风',
    rain: '暴雨',
    cold: '寒冷',
    wind: '雷雨大风',
    heat: '高温',
    drought: '干旱',
    fire: '森林火险',
    lightning: '雷电',
    hail: '冰雹',
    frost: '霜冻',
    fog: '大雾',
    haze: '霾',
    ice: '道路结冰',
  };
  const MO_SIGNALS = [
    { group: 'mo', id: 'mo1', name: '一号风球', rank: 30, tone: '#3b82f6', icon: '' },
    { group: 'mo', id: 'mo3', name: '三号风球', rank: 40, tone: '#eab308', icon: '' },
    { group: 'mo', id: 'mo8ne', name: '八号东北风球', rank: 70, tone: '#ea580c', icon: '' },
    { group: 'mo', id: 'mo8se', name: '八号东南风球', rank: 70, tone: '#ea580c', icon: '' },
    { group: 'mo', id: 'mo8sw', name: '八号西南风球', rank: 70, tone: '#ea580c', icon: '' },
    { group: 'mo', id: 'mo8nw', name: '八号西北风球', rank: 70, tone: '#ea580c', icon: '' },
    { group: 'mo', id: 'mo9', name: '九号风球', rank: 80, tone: '#b91c1c', icon: '' },
    { group: 'mo', id: 'mo10', name: '十号风球', rank: 90, tone: '#991b1b', icon: '' },
    { group: 'mo', id: 'moRainY', name: '黄色暴雨警告信号', rank: 40, tone: '#eab308', icon: '' },
    { group: 'mo', id: 'moRainR', name: '红色暴雨警告信号', rank: 50, tone: '#dc2626', icon: '' },
    { group: 'mo', id: 'moRainB', name: '黑色暴雨警告信号', rank: 60, tone: '#1f2937', icon: '' },
    { group: 'mo', id: 'moStormBlue', name: '风暴潮警告（蓝色）', rank: 30, tone: '#3b82f6', icon: '' },
    { group: 'mo', id: 'moStormYellow', name: '风暴潮警告（黄色）', rank: 40, tone: '#eab308', icon: '' },
    { group: 'mo', id: 'moStormOrange', name: '风暴潮警告（橙色）', rank: 45, tone: '#ea580c', icon: '' },
    { group: 'mo', id: 'moStormRed', name: '风暴潮警告（红色）', rank: 50, tone: '#dc2626', icon: '' },
    { group: 'mo', id: 'moStormBlack', name: '风暴潮警告（黑色）', rank: 60, tone: '#1f2937', icon: '' },
    { group: 'mo', id: 'moThunder', name: '雷暴警告', rank: 20, tone: '#6a5f9e', icon: '' },
    { group: 'mo', id: 'moMonsoon', name: '强烈季候风信号', rank: 30, tone: '#5f8b9e', icon: '' },
  ];
  let testAlerts = [];
  let testSignals = [];
  let testSeq = 0;
  let mockSignalsHidden = false;

  function signalTypeKey(name) {
    if (/台风|风球|热带气旋|飓风/.test(name)) return 'typhoon';
    if (/暴雨|水浸|风暴潮/.test(name)) return 'rain';
    if (/雷暴|闪电/.test(name)) return 'lightning';
    if (/寒冷|低温/.test(name)) return 'cold';
    if (/酷热|高温/.test(name)) return 'heat';
    if (/火灾|火险/.test(name)) return 'fire';
    if (/霜冻/.test(name)) return 'frost';
    return 'other';
  }

  function signalLevel(rank) {
    if (rank >= 70) return 'red';
    if (rank >= 55) return 'orange';
    if (rank >= 40) return 'yellow';
    return 'blue';
  }

  function hkmoItemsAll() {
    const snap = warningState();
    const mock = Boolean(snap.hkmo && snap.hkmo.mock && mockSignalsHidden);
    const regions = snap.hkmo && Array.isArray(snap.hkmo.regions) && !mock ? snap.hkmo.regions : [];
    const items = [];
    regions.forEach((region) => {
      (region.items || []).forEach((item) => items.push({ ...item, regionKey: region.key }));
    });
    testSignals.forEach((item) => items.push(item));
    return items;
  }

  const MO_ICON_BASE = 'assets/mo-signals/';

  function macauSignalIcon(name) {
    const text = String(name || '');
    if (/十号/.test(text)) return `${MO_ICON_BASE}typhoon-t10.gif`;
    if (/九号/.test(text)) return `${MO_ICON_BASE}typhoon-t9.gif`;
    if (/八号/.test(text)) {
      if (/东南/.test(text)) return `${MO_ICON_BASE}typhoon-t8se.gif`;
      if (/西南/.test(text)) return `${MO_ICON_BASE}typhoon-t8sw.gif`;
      if (/西北/.test(text)) return `${MO_ICON_BASE}typhoon-t8nw.gif`;
      return `${MO_ICON_BASE}typhoon-t8ne.gif`;
    }
    if (/三号/.test(text)) return `${MO_ICON_BASE}typhoon-t3.gif`;
    if (/一号/.test(text)) return `${MO_ICON_BASE}typhoon-t1.gif`;
    if (/黑色暴雨/.test(text)) return `${MO_ICON_BASE}rain-black.jpg`;
    if (/红色暴雨/.test(text)) return `${MO_ICON_BASE}rain-red.jpg`;
    if (/黄色暴雨/.test(text)) return `${MO_ICON_BASE}rain-yellow.jpg`;
    if (/暴雨/.test(text)) return `${MO_ICON_BASE}rain-red.jpg`;
    if (/风暴潮/.test(text)) {
      if (/黑色/.test(text)) return `${MO_ICON_BASE}surge-black.gif`;
      if (/红色/.test(text)) return `${MO_ICON_BASE}surge-red.gif`;
      if (/橙色/.test(text)) return `${MO_ICON_BASE}surge-orange.gif`;
      if (/黄色/.test(text)) return `${MO_ICON_BASE}surge-yellow.gif`;
      return `${MO_ICON_BASE}surge-blue.gif`;
    }
    if (/雷暴|雷电/.test(text)) return `${MO_ICON_BASE}thunder.jpg`;
    if (/季候风/.test(text)) return `${MO_ICON_BASE}monsoon.gif`;
    return '';
  }

  function localHkIcon(icon) {
    const file = String(icon || '').split('/').pop();
    const stem = file.replace(/\.gif$/i, '').toLowerCase();
    const map = window.HK_SIGNAL_ICONS;
    return map && map[stem] ? map[stem] : '';
  }

  function resolveSignalIcon(item) {
    if (item.regionKey === 'mo') return macauSignalIcon(item.name) || item.icon || '';
    return localHkIcon(item.icon) || item.icon || '';
  }

  function hkmoRows() {
    return hkmoItemsAll().map((item, i) => {
      const meta = HKMO_META[item.regionKey];
      if (!meta) return null;
      return {
        id: item.id || `hkmo-${item.regionKey}-${i}`,
        hkmo: true,
        regionKey: item.regionKey,
        place: meta.short,
        province: meta.province,
        city: meta.short,
        typeKey: signalTypeKey(item.name),
        typeName: item.name,
        levelKey: signalLevel(item.rank || 0),
        levelRank: Math.round((item.rank || 0) / 20),
        tone: item.tone || '#64748b',
        icon: resolveSignalIcon(item),
        ts: item.ts || 0,
        clock: item.clock || '',
      };
    }).filter(Boolean);
  }

  function timeCutoff() {
    const hours = { '1h': 1, '6h': 6, '24h': 24, '72h': 72 }[state.time];
    return hours ? Date.now() - hours * 3600e3 : 0;
  }

  function hkmoVisible() {
    if (state.province !== HKMO_PROVINCE) return [];
    const cutoff = timeCutoff();
    return hkmoRows()
      .filter((row) => state.city === 'all' || row.city === state.city)
      .filter((row) => state.type === 'all' || row.typeKey === state.type)
      .filter((row) => state.level === 'all' || row.levelKey === state.level)
      .filter((row) => !cutoff || (row.ts && row.ts >= cutoff));
  }

  function hkmoMapPoints(mobile = window.innerWidth <= 860) {
    if (state.province !== HKMO_PROVINCE) return [];
    const cutoff = timeCutoff();
    const groups = new Map();
    hkmoItemsAll().forEach((item) => {
      if (!HKMO_META[item.regionKey]) return;
      if (state.type !== 'all' && signalTypeKey(item.name) !== state.type) return;
      if (state.level !== 'all' && signalLevel(item.rank || 0) !== state.level) return;
      if (cutoff && !(item.ts && item.ts >= cutoff)) return;
      const list = groups.get(item.regionKey) || [];
      list.push(item);
      groups.set(item.regionKey, list);
    });
    const out = [];
    Object.keys(HKMO_META).forEach((key) => {
      const meta = HKMO_META[key];
      const items = (groups.get(key) || []).slice().sort((a, b) => (b.rank || 0) - (a.rank || 0));
      const anchor = rotatePoint(meta.anchor);
      if (!items.length) return;
      const step = mobile ? 16 : 34;
      const rowStep = mobile ? 16 : 32;
      const perRow = key === 'mo' ? 4 : items.length;
      items.forEach((item, i) => {
        const icon = resolveSignalIcon(item);
        const row = Math.floor(i / perRow);
        const col = i % perRow;
        const rowCount = Math.min(perRow, items.length - row * perRow);
        const offsetX = key === 'mo'
          ? (rowCount > 3 ? col - 1 : col - (rowCount - 1) / 2) * step
          : (items.length > 3 ? i - 1 : i - (items.length - 1) / 2) * step;
        out.push({
          name: meta.short,
          value: anchor,
          count: items.length,
          signalName: item.name,
          symbol: icon ? `image://${icon}` : 'circle',
          tone: item.tone || '#64748b',
          offsetX,
          offsetY: row * rowStep,
          label: false,
        });
      });
    });
    return out;
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmtTime(ts) {
    if (!Number.isFinite(ts)) return '—';
    const iso = new Date(ts + 8 * 3600e3).toISOString();
    return `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
  }

  function fmtDateTime(ts) {
    if (!Number.isFinite(ts)) return '—';
    return new Date(ts + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  }

  function mapClockText(ts = Date.now()) {
    const iso = new Date(ts + 8 * 3600e3).toISOString();
    return `${iso.slice(0, 4)}年${iso.slice(5, 7)}月${iso.slice(8, 10)}日 ${iso.slice(11, 13)}时${iso.slice(14, 16)}分`;
  }

  function tickMapClock() {
    const el = $('#warningClassicClock');
    if (!el || el.hidden) return;
    const text = mapClockText();
    if (el.textContent !== text) el.textContent = text;
  }

  function warningState() {
    return (window.WarningPage && window.WarningPage.state) || { alerts: [], groups: [], source: '中央气象台', updatedAt: 0, loading: false };
  }

  function provinceInfo(value = state.province) {
    return PROVINCES.find((item) => item.full === value) || null;
  }

  function mapInfo() {
    const info = provinceInfo();
    if (!info) {
      const key = 'wcm-all';
      const cities = MAP_DATA.cities.features;
      if (!registeredMaps.has(key) && window.echarts) {
        echarts.registerMap(key, { type: 'FeatureCollection', features: cities });
        registeredMaps.add(key);
      }
      return { key, features: cities, cities, info: null };
    }
    const key = `wcm-${info.adcode}`;
    const cities = MAP_DATA.cities.features.filter((feature) => feature.properties.provinceAdcode === info.adcode);
    const gd = String(info.adcode) === '440000';
    let features = gd && GD_COUNTIES.length ? GD_COUNTIES : cities;
    if (gd && GD_COUNTIES.length) {
      const rotated = rotatedGd();
      features = rotated.counties.concat(rotated.hkmo);
    }
    if (!registeredMaps.has(key) && window.echarts) {
      echarts.registerMap(key, { type: 'FeatureCollection', features });
      registeredMaps.add(key);
    }
    return { key, features, cities, info };
  }

  function cityKey(alert, features) {
    const place = String(alert.place || '');
    const hit = features.find((feature) => {
      const props = feature.properties;
      return place.includes(props.name) || place.includes(props.short);
    });
    return hit ? hit.properties.short : place.split(' · ')[0].trim();
  }

  function timeAlerts(alerts) {
    const hours = { '1h': 1, '6h': 6, '24h': 24, '72h': 72 }[state.time];
    if (!hours) return alerts;
    const cutoff = Date.now() - hours * 3600e3;
    return alerts.filter((alert) => alert.ts >= cutoff);
  }

  function baseAlerts(alerts) {
    return timeAlerts(alerts)
      .filter((alert) => state.province === 'all' || alert.province === state.province)
      .filter((alert) => state.type === 'all' || alert.typeKey === state.type)
      .filter((alert) => state.level === 'all' || alert.levelKey === state.level);
  }

  function hkmoRowHtml(alert) {
    const tone = /^#[0-9a-f]{3,8}$/i.test(alert.tone) ? alert.tone : '#64748b';
    const icon = alert.icon
      ? `<img class="wcv-hk-icon" src="${esc(alert.icon)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
      : `<span class="wcv-hk-dot" style="--tone:${tone}"></span>`;
    return `<div class="wcv-row is-hkmo" style="--lv:${tone};--tone:${tone}">
      <span class="wcv-icon">${icon}</span>
      <span class="wcv-main"><b>${esc(alert.place)} · ${esc(alert.typeName)}</b><small>${esc(alert.province)} · 官方信号</small></span>
      <span class="wcv-time">${esc(alert.clock || '—')}</span>
      <span class="wcv-arrow" aria-hidden="true"></span>
    </div>`;
  }

  function rowHtml(alert, features) {
    if (alert.hkmo) return hkmoRowHtml(alert);
    const color = LEVEL_COLORS[alert.levelKey] || LEVEL_COLORS.blue;
    const icon = window.WarningPage && window.WarningPage.iconSvg ? window.WarningPage.iconSvg(alert.icon) : '';
    return `<button class="wcv-row" type="button" data-warning-id="${esc(alert.id)}" style="--lv:${color};--tone:${esc(alert.tone)}" aria-label="${esc(alert.place)}，${esc(alert.levelLabel)}预警，查看详情">
      <span class="wcv-icon">${icon}</span>
      <span class="wcv-main"><b>${esc(alert.place)}</b><small>${esc(alert.typeName)} · ${esc(alert.levelLabel)}预警 · ${esc(alert.levelGrade)}</small></span>
      <span class="wcv-time">${esc(fmtTime(alert.ts))}<small>${esc(cityKey(alert, features))}</small></span>
      <span class="wcv-arrow" aria-hidden="true">›</span>
    </button>`;
  }

  function ensureChart() {
    if (chart || !window.echarts) return chart;
    const el = $('#warningClassicMap');
    if (!el) return null;
    chart = echarts.init(el);
    chart.on('click', (params) => {
      const data = params.data;
      if (!data) return;
      if (data.hkmo) {
        state.city = state.city === data.name ? 'all' : data.name;
        render();
        return;
      }
      if (!data.cityKey || !data.value) return;
      state.city = state.city === data.cityKey ? 'all' : data.cityKey;
      render();
    });
    return chart;
  }

  function mapRowsByArea(alerts, map) {
    const byName = new Map();
    const countyMode = Boolean(map.info && String(map.info.adcode) === '440000' && GD_COUNTIES.length);
    const push = (key, alert) => {
      const list = byName.get(key) || [];
      list.push(alert);
      byName.set(key, list);
    };
    if (countyMode) {
      const countyByName = new Map(GD_COUNTIES.map((feature) => [feature.properties.name, feature]));
      const countiesByCity = new Map();
      GD_COUNTIES.forEach((feature) => {
        const city = feature.properties.city;
        const list = countiesByCity.get(city) || [];
        list.push(feature);
        countiesByCity.set(city, list);
      });
      for (const alert of alerts) {
        const place = String(alert.place || '').trim();
        const parts = place.split('·').map((part) => part.trim()).filter(Boolean);
        const last = parts[parts.length - 1] || place;
        const hit = countyByName.get(last);
        if (hit) {
          push(hit.properties.name, alert);
          continue;
        }
        const cityName = parts[0];
        const list = countiesByCity.get(cityName);
        if (list) {
          list.forEach((feature) => push(feature.properties.name, alert));
          continue;
        }
        if (/广东省/.test(place)) GD_COUNTIES.forEach((feature) => push(feature.properties.name, alert));
      }
      return { byName, countyMode: true };
    }
    for (const alert of alerts) push(cityKey(alert, map.cities), alert);
    return { byName, countyMode: false };
  }

  function buildMapOption(alerts, map, opts = {}) {
    const mobile = opts.mobile == null ? window.innerWidth <= 860 : opts.mobile;
    const target = opts.el || $('#warningClassicMap');
    const base = baseAlerts(alerts);
    const { byName, countyMode } = mapRowsByArea(base, map);
    const showAllLabels = Boolean(provinceInfo());
    const anyLevel = [...byName.values()].some((rows) => rows.length);
    const points = hkmoMapPoints(mobile).map((point) => ({ ...point, hkmo: true }));
    const pointMap = new Map(points.map((point) => [point.name, point]));
    const data = map.features.map((feature) => {
      const props = feature.properties;
      const special = props.adcode === '810000' || props.adcode === '820000';
      const areaKey = countyMode && !special ? props.name : props.short;
      const cityLabel = countyMode && !special ? String(props.city || '').replace(/市$/, '') : props.short;
      const rows = (byName.get(areaKey) || []).slice().sort((a, b) => b.levelRank - a.levelRank);
      const top = rows[0];
      const color = top ? LEVEL_COLORS[top.levelKey] : null;
      const selected = state.city === cityLabel || state.city === props.short;
      const point = special ? pointMap.get(props.short) : null;
      const shenzhen = countyMode && String(props.city || '') === '深圳市';
      const showLabel = special
        ? false
        : countyMode
          ? Boolean(top) && !shenzhen
          : Boolean(top) || (showAllLabels && !anyLevel);
      const blankFill = countyMode ? '#9b9b9b' : '#edf5f8';
      const labelColor = countyMode || color ? '#ffffff' : '#607b89';
      return {
        name: props.name,
        value: point ? point.count : rows.length,
        cityKey: cityLabel,
        special: Boolean(special),
        signalName: point ? point.signalName : '',
        level: top ? top.levelKey : '',
        levelName: top ? top.levelLabel : '',
        itemStyle: special
          ? { areaColor: countyMode ? '#9b9b9b' : '#edf5f8', borderColor: selected ? '#14303f' : countyMode ? '#2f2f2f' : '#b9cfdb', borderWidth: selected ? 2 : 0.5 }
          : {
            areaColor: color || blankFill,
            borderColor: selected ? '#14303f' : countyMode ? '#2f2f2f' : color ? 'rgba(255,255,255,.82)' : '#b9cfdb',
            borderWidth: selected ? 2 : countyMode ? 0.5 : color ? 1 : 0.7,
          },
        label: {
          show: showLabel,
          formatter: props.short || props.name,
          // 非粤港澳地图有预警的城市统一白字；整张图都没有预警时才用深灰字标出城市
          color: labelColor,
          fontWeight: top ? 700 : 500,
          fontSize: countyMode ? (mobile ? 8 : 9) : undefined,
          textBorderColor: countyMode ? 'rgba(0, 0, 0, .38)' : color ? 'rgba(0,0,0,.3)' : '#ffffff',
          textBorderWidth: 2,
        },
        // 悬停态显式指定：否则 ECharts 会用主题默认的金色底和暗红地名
        emphasis: {
          itemStyle: { areaColor: color || blankFill, borderColor: '#14303f', borderWidth: 1.5 },
          label: showLabel
            ? {
              show: true,
              color: labelColor,
              fontWeight: 800,
              textBorderColor: labelColor === '#ffffff' ? 'rgba(0, 0, 0, .45)' : '#ffffff',
            }
            : { show: false },
        },
      };
    });
    const layout = countyMode
      ? countyLayout(target)
      : { layoutCenter: ['50%', '50%'], layoutSize: '96%' };
    const series = [{
      type: 'map',
      map: map.key,
      roam: false,
      selectedMode: false,
      aspectScale: countyMode ? 1 : 0.75,
      ...layout,
      itemStyle: { areaColor: '#edf5f8', borderColor: '#b9cfdb', borderWidth: 0.7 },
      label: { show: true, fontSize: mobile ? 9.5 : 11, fontFamily: 'inherit' },
      labelLayout: { hideOverlap: true },
      data,
    }];
    if (points.length) {
      series.push({
        type: 'scatter',
        coordinateSystem: 'geo',
        z: 12,
        cursor: 'pointer',
        symbolSize: (value, params) => {
          if (params.data.symbol !== 'circle') return mobile ? 14 : 30;
          return params.data.count ? (mobile ? 10 : 14) : 6;
        },
        data: points.map((point) => ({
          ...point,
          symbolOffset: [point.offsetX || 0, point.offsetY || 0],
          itemStyle: point.symbol === 'circle'
            ? (point.count
              ? { color: point.tone, borderColor: '#fff', borderWidth: 1.5 }
              : { color: '#fff', borderColor: '#8aa3b2', borderWidth: 1.2 })
            : undefined,
          label: {
            show: Boolean(point.label),
            position: 'bottom',
            distance: 3,
            formatter: point.name,
            color: '#ffffff',
            fontSize: mobile ? 9.5 : 11,
            fontWeight: 800,
            textBorderColor: 'rgba(0, 0, 0, .45)',
            textBorderWidth: 2.5,
          },
        })),
        emphasis: { scale: 1.12 },
      });
    }
    const option = {
      animationDuration: 0,
      geo: points.length ? {
        map: map.key,
        roam: false,
        aspectScale: countyMode ? 1 : 0.75,
        ...layout,
        silent: true,
        itemStyle: { areaColor: 'transparent', borderColor: 'transparent' },
        label: { show: false },
        emphasis: { disabled: true },
      } : undefined,
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(21,45,61,.94)',
        borderWidth: 0,
        padding: [8, 10],
        textStyle: { color: '#f4fbff', fontSize: 12 },
        formatter: (params) => {
          const item = params.data;
          if (!item) return esc(params.name);
          if (params.seriesType === 'scatter') {
            if (!item.count) return `<b>${esc(item.name)}</b><br>暂无生效信号`;
            return `<b>${esc(item.name)}</b><br>${esc(item.signalName)}${item.count > 1 ? ` 等 ${item.count} 条信号` : ''}`;
          }
          if (item.special) {
            return `<b>${esc(item.name)}</b><br>${item.value ? `${item.value} 条信号${item.signalName ? ` · 最高 ${esc(item.signalName)}` : ''}` : '暂无生效信号'}`;
          }
          return `<b>${esc(item.name)}</b><br>${item.value} 条预警${item.value ? ` · 最高 ${esc(item.levelName)}预警` : ' · 暂无生效预警'}`;
        },
      },
      series,
    };
    return { option, data, points, countyMode };
  }

  function renderMap(alerts, map) {
    ensureChart();
    if (!chart) return;
    const built = buildMapOption(alerts, map);
    $('#warningClassicMapEmpty').hidden = built.data.some((item) => item.value > 0) || built.points.some((point) => point.count > 0);
    const mapEl = $('#warningClassicMap');
    if (mapEl) mapEl.classList.toggle('is-county', built.countyMode);
    chart.setOption(built.option, true);
    setTimeout(() => chart && chart.resize(), 30);
    const clockEl = $('#warningClassicClock');
    if (clockEl) {
      clockEl.hidden = !built.countyMode;
      if (built.countyMode) clockEl.textContent = mapClockText();
    }
    const downloadBtn = $('#warningClassicDownload');
    if (downloadBtn) downloadBtn.hidden = !built.countyMode;
  }

  function loadCanvasImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  const CLOCK_STAMP_REF = 853; // 桌面端地图宽度：导出图时间条固定按它等比，保证各设备下载一致

  function drawClockStamp(ctx, canvasWidth) {
    const k = canvasWidth / CLOCK_STAMP_REF;
    const text = mapClockText();
    const font = 13 * k;
    const padX = 10 * k;
    const padY = 5 * k;
    ctx.save();
    ctx.font = `700 ${font}px "PingFang SC","Microsoft YaHei",sans-serif`;
    const w = Math.ceil(ctx.measureText(text).width) + padX * 2;
    const h = font * 1.3 + padY * 2 + 2 * k;
    const x = canvasWidth - 12 * k - w;
    const y = 10 * k;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 4 * k);
    else ctx.rect(x, y, w, h);
    ctx.fillStyle = 'rgba(255, 255, 255, .96)';
    ctx.fill();
    ctx.lineWidth = Math.max(1, k);
    ctx.strokeStyle = 'rgba(20, 60, 80, .18)';
    ctx.stroke();
    ctx.fillStyle = '#101c24';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + h / 2 + 0.5 * k);
    ctx.restore();
  }

  async function composeWarningLegend(chartUrl, alerts) {
    const baseImg = await loadCanvasImage(chartUrl);
    const canvas = document.createElement('canvas');
    canvas.width = baseImg.naturalWidth;
    canvas.height = baseImg.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(baseImg, 0, 0);
    drawClockStamp(ctx, canvas.width);
    const pairs = buildLegendPairs(alerts);
    if (!pairs.length) return canvas.toDataURL('image/png');
    const scale = canvas.width / 900;
    const cellW = 46 * scale;
    const cellH = cellW * 0.8;
    const gap = 6 * scale;
    const rowGap = 8 * scale;
    const left = 16 * scale;
    const top = 16 * scale;
    const iconSvg = window.WarningPage && window.WarningPage.iconSvg ? window.WarningPage.iconSvg : () => '';
    const columns = legendColumns(pairs);
    for (let c = 0; c < columns.length; c += 1) {
      const col = columns[c];
      for (let i = 0; i < col.length; i += 1) {
        const item = col[i];
        const x = left + c * (cellW + gap);
        const y = top + i * (cellH + rowGap);
        const key = legendIconKey(item);
        const local = key && window.WX_SIGNAL_ICONS ? window.WX_SIGNAL_ICONS[key] : '';
        let drawn = false;
        if (local) {
          try {
            const img = await loadCanvasImage(local);
            const nw = img.naturalWidth || 160;
            const nh = img.naturalHeight || 128;
            const k = Math.min(cellW / nw, cellH / nh);
            const dw = nw * k;
            const dh = nh * k;
            ctx.drawImage(img, x + (cellW - dw) / 2, y + (cellH - dh) / 2, dw, dh);
            drawn = true;
          } catch (e) {
            drawn = false;
          }
        }
        if (drawn) continue;
        const tone = item.levelKey === 'white' ? '#b9cfdb' : LEVEL_COLORS[item.levelKey];
        const badge = cellH;
        const bx = x + (cellW - badge) / 2;
        ctx.save();
        ctx.fillStyle = '#ffffff';
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(bx, y, badge, badge, 3 * scale);
          ctx.fill();
        } else {
          ctx.fillRect(bx, y, badge, badge);
        }
        const svg = iconSvg(item.icon || 'other')
          .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
          .replace(/currentColor/g, tone);
        try {
          const img = await loadCanvasImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
          ctx.drawImage(img, bx + badge * 0.16, y + badge * 0.16, badge * 0.68, badge * 0.68);
        } catch (e) {
          /* ignore */
        }
        ctx.restore();
      }
    }
    return canvas.toDataURL('image/png');
  }

  async function downloadWarningMap() {
    const map = mapInfo();
    if (!map.info || String(map.info.adcode) !== '440000') return;
    const snap = warningState();
    const alerts = Array.isArray(snap.alerts) ? snap.alerts : [];
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;height:620px;';
    document.body.appendChild(container);
    const inst = echarts.init(container);
    try {
      const built = buildMapOption(alerts, map, { mobile: false, el: container });
      inst.setOption(built.option, true);
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        inst.on('finished', finish);
        setTimeout(finish, 1200);
      });
      const chartUrl = inst.getDataURL({ type: 'png', pixelRatio: 3840 / 900, backgroundColor: '#a9cbe8' });
      if (!chartUrl) return;
      const url = await composeWarningLegend(chartUrl, alerts);
      const now = new Date(Date.now() + 8 * 3600e3);
      const stamp = `${now.toISOString().slice(0, 10)}-${now.toISOString().slice(11, 13)}${now.toISOString().slice(14, 16)}`;
      const link = document.createElement('a');
      link.href = url;
      link.download = `粤港澳气象预警-${stamp}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      inst.dispose();
      container.remove();
    }
  }

  function buildLegendPairs(alerts) {
    const pairs = new Map();
    for (const alert of baseAlerts(alerts)) {
      if (alert.typeKey === 'rain' && alert.levelKey === 'blue') continue;
      const key = `${alert.typeKey}|${alert.levelKey}`;
      const hit = pairs.get(key);
      if (hit) {
        hit.count += 1;
        continue;
      }
      pairs.set(key, {
        typeKey: alert.typeKey,
        typeName: alert.typeName,
        levelKey: alert.levelKey,
        icon: alert.icon,
        count: 1,
      });
    }
    const levelRank = { red: 5, orange: 4, yellow: 3, blue: 2, white: 1 };
    const typeOrder = TEST_TYPES.map((def) => def.key);
    return [...pairs.values()].sort((a, b) => (levelRank[b.levelKey] || 0) - (levelRank[a.levelKey] || 0)
      || typeOrder.indexOf(a.typeKey) - typeOrder.indexOf(b.typeKey));
  }

  function legendIconKey(item) {
    const official = OFFICIAL_ICON_NAMES[item.typeKey];
    return official ? `${official}-${LEVEL_TITLES[item.levelKey]}` : '';
  }

  function legendIconSrc(item) {
    const key = legendIconKey(item);
    if (!key) return '';
    const local = window.WX_SIGNAL_ICONS && window.WX_SIGNAL_ICONS[key];
    if (local) return local;
    return `https://weather.zhuhai.gov.cn/files/wx-warn/${encodeURIComponent(key)}.jpg`;
  }

  function legendColumns(list) {
    const total = list.length;
    let colOne = total;
    if (total > 5) colOne = total <= 10 ? 5 : 5 + Math.ceil((total - 10) / 2);
    return [list.slice(0, colOne), list.slice(colOne)].filter((col) => col.length);
  }

  function renderLegend(alerts, iconsMode) {
    const base = baseAlerts(alerts);
    const legendEl = $('#warningClassicLegend');
    const counts = { red: 0, orange: 0, yellow: 0, blue: 0, white: 0 };
    for (const alert of base) if (counts[alert.levelKey] != null) counts[alert.levelKey] += 1;
    legendEl.classList.toggle('is-icons', Boolean(iconsMode));
    if (!iconsMode) {
      legendEl.innerHTML = ['red', 'orange', 'yellow', 'blue'].map((level) => `<span class="wcm-legend-item"><i style="--c:${LEVEL_COLORS[level]}"></i>${LEVEL_NAMES[level]}<b>${counts[level]}</b></span>`).join('') + `<span class="wcm-legend-total">共 <b>${base.length}</b> 条</span>`;
      return;
    }
    const list = buildLegendPairs(alerts);
    if (!list.length) {
      legendEl.hidden = true;
      legendEl.innerHTML = '';
      return;
    }
    legendEl.hidden = false;
    const iconSvg = window.WarningPage && window.WarningPage.iconSvg ? window.WarningPage.iconSvg : () => '';
    legendEl.innerHTML = legendColumns(list).map((col) => `<div class="wcm-legend-col">${col.map((item) => {
      const tone = item.levelKey === 'white' ? '#b9cfdb' : LEVEL_COLORS[item.levelKey];
      const key = legendIconKey(item);
      const local = key && window.WX_SIGNAL_ICONS ? window.WX_SIGNAL_ICONS[key] : '';
      const remote = key ? `https://weather.zhuhai.gov.cn/files/wx-warn/${encodeURIComponent(key)}.jpg` : '';
      const src = local || remote;
      const img = src
        ? `<img src="${src}" ${local ? `data-remote="${remote}"` : ''} alt="" loading="lazy" referrerpolicy="no-referrer" onerror="if(this.dataset.remote){this.src=this.dataset.remote;this.removeAttribute('data-remote')}else{this.parentNode.parentNode.classList.add('is-fallback');this.remove()}" />`
        : '';
      const fallback = src ? '' : ' is-fallback';
      return `<span class="wcm-legend-item${fallback}" style="--c:${tone}" title="${esc(item.typeName)} · ${LEVEL_TITLES[item.levelKey]}（${item.count} 条）"><i class="wcm-legend-icon">${iconSvg(item.icon || 'other')}${img}</i></span>`;
    }).join('')}</div>`).join('');
  }

  function chartFor(id) {
    if (!window.echarts) return null;
    const el = document.getElementById(id);
    if (!el) return null;
    let instance = charts.get(id);
    if (!instance) {
      instance = echarts.init(el);
      charts.set(id, instance);
    }
    return instance;
  }

  function barLimit(instance) {
    const height = (instance && instance.getHeight()) || (instance && instance.getDom().clientHeight) || 300;
    return height >= 300 ? 10 : height >= 180 ? 8 : 6;
  }

  // 电脑端图表字号偏小看着吃力，桌面端整体放大一档
  const isDesktop = () => window.innerWidth > 860;

  function barOption(entries, colors, label, limit) {
    const top = entries.slice(0, limit).reverse();
    const max = top.length ? Math.ceil(top[top.length - 1][1] * 1.16) : 1;
    const fontSize = isDesktop() ? 12 : 10;
    return {
      animationDuration: 320,
      grid: { left: 4, right: isDesktop() ? 34 : 30, top: 6, bottom: 2, containLabel: true },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params) => `${params[0].name}：${params[0].value} ${label}` },
      xAxis: { type: 'value', show: false, max },
      yAxis: {
        type: 'category', data: top.map((item) => item[0]),
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: '#5d7482', fontSize, width: isDesktop() ? 90 : 76, overflow: 'truncate' },
      },
      series: [{
        type: 'bar', barWidth: 9,
        data: top.map(([name, value]) => ({
          value,
          itemStyle: { color: colors(name), borderRadius: [0, 5, 5, 0] },
        })),
        label: { show: true, position: 'right', fontSize, color: '#376479' },
      }],
    };
  }

  function renderLevelChart(rows) {
    document.getElementById('warningClassicLevelTotal').textContent = `${rows.length} 条`;
    const instance = chartFor('warningClassicLevelChart');
    if (!instance) return;
    const order = ['red', 'orange', 'yellow', 'blue', 'white'];
    const data = order
      .map((key) => ({ key, level: LEVEL_NAMES[key], value: rows.filter((alert) => alert.levelKey === key).length }))
      .filter((item) => item.value)
      .map((item) => ({ value: item.value, name: item.level, itemStyle: { color: LEVEL_COLORS[item.key] } }));
    instance.setOption({
      animationDuration: 320,
      title: {
        text: String(rows.length), subtext: '条预警', left: 'center', top: '40%',
        textStyle: { color: '#14303f', fontSize: isDesktop() ? 22 : 20, fontWeight: 800 },
        subtextStyle: { color: '#7d919d', fontSize: isDesktop() ? 11 : 9 },
      },
      tooltip: { trigger: 'item', formatter: '{b}：{c} 条（{d}%）' },
      series: [{
        type: 'pie', radius: ['50%', '68%'], center: ['50%', '54%'],
        itemStyle: { borderColor: '#fff', borderWidth: 2 },
        label: { show: true, fontSize: isDesktop() ? 12 : 10, color: '#5d7482', formatter: '{b} {c}' },
        labelLine: { length: 5, length2: 5, lineStyle: { color: '#c9dbe6' } },
        data,
      }],
    }, true);
  }

  function renderTypeChart(rows) {
    const counts = new Map();
    const tones = new Map();
    for (const alert of rows) {
      counts.set(alert.typeName, (counts.get(alert.typeName) || 0) + 1);
      if (!tones.has(alert.typeName)) tones.set(alert.typeName, alert.tone || '#2f6fa8');
    }
    document.getElementById('warningClassicTypeTotal').textContent = counts.size ? `${counts.size} 类` : '—';
    const instance = chartFor('warningClassicTypeChart');
    if (!instance) return;
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    instance.setOption(barOption(entries, (name) => tones.get(name) || '#2f6fa8', '条', barLimit(instance)), true);
  }

  function renderCityChart(rows, features) {
    const counts = new Map();
    for (const alert of rows) {
      const city = cityKey(alert, features);
      counts.set(city, (counts.get(city) || 0) + 1);
    }
    document.getElementById('warningClassicCityTotal').textContent = counts.size ? `${counts.size} 个` : '—';
    const instance = chartFor('warningClassicCityChart');
    if (!instance) return;
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    instance.setOption(barOption(entries, () => '#2f7fb6', '条', barLimit(instance)), true);
  }

  function trendBuckets(rows) {
    const now = Date.now();
    const shift = 8 * 3600e3;
    const recent = rows.some((alert) => alert.ts >= now - 36 * 3600e3);
    const step = recent ? 3600e3 : 86400e3;
    const count = recent ? 24 : 10;
    const edge = Math.floor((now + shift) / step) * step - shift;
    const labels = [];
    const values = [];
    for (let i = count - 1; i >= 0; i--) {
      const start = edge - i * step;
      labels.push(recent ? new Date(start + shift).toISOString().slice(11, 16) : new Date(start + shift).toISOString().slice(5, 10));
      values.push(0);
    }
    for (const alert of rows) {
      const index = count - 1 - Math.floor((edge - alert.ts) / step);
      if (index >= 0 && index < count) values[index] += 1;
    }
    return { labels, values, recent, title: recent ? '近 24 小时发布趋势' : '近 10 天发布趋势' };
  }

  function renderTrendChart(rows) {
    const instance = chartFor('warningClassicTrendChart');
    const trend = trendBuckets(rows);
    document.getElementById('warningClassicTrendTitle').textContent = trend.title;
    document.getElementById('warningClassicTrendTotal').textContent = `${rows.length} 条`;
    if (!instance) return;
    instance.setOption({
      animationDuration: 320,
      grid: { left: 4, right: 10, top: 12, bottom: 2, containLabel: true },
      tooltip: { trigger: 'axis', formatter: (params) => `${params[0].name}：${params[0].value} 条` },
      xAxis: {
        type: 'category', boundaryGap: false, data: trend.labels,
        axisLine: { lineStyle: { color: '#dbe9f0' } }, axisTick: { show: false },
        axisLabel: { color: '#7d919d', fontSize: isDesktop() ? 11 : 9, interval: trend.recent ? 3 : 0 },
      },
      yAxis: {
        type: 'value', minInterval: 1,
        splitLine: { lineStyle: { color: '#eef5f9' } },
        axisLabel: { color: '#7d919d', fontSize: isDesktop() ? 11 : 9 },
      },
      series: [{
        type: 'line', smooth: true, symbol: 'none', data: trend.values,
        lineStyle: { width: 2, color: '#2f7fb6' },
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: 'rgba(47, 127, 182, .28)' }, { offset: 1, color: 'rgba(47, 127, 182, .02)' }],
          },
        },
      }],
    }, true);
  }

  function renderAnalytics(rows, features) {
    renderLevelChart(rows);
    renderTypeChart(rows);
    renderCityChart(rows, features);
    renderTrendChart(rows);
  }

  function render() {
    if (!state.open) return;
    const snap = warningState();
    const alerts = Array.isArray(snap.alerts) ? snap.alerts : [];
    const groups = Array.isArray(snap.groups) ? snap.groups : [];
    if (!provinceTouched && alerts.length && !alerts.some((alert) => alert.province === state.province)) state.province = 'all';
    const map = mapInfo();
    const cityFeatures = map.cities;
    const countyMode = Boolean(map.info && String(map.info.adcode) === '440000' && GD_COUNTIES.length);
    const activeGroups = groups.filter((group) => group.alerts.length);
    if (state.type !== 'all' && !activeGroups.some((group) => group.key === state.type)) state.type = 'all';

    const typeSelect = $('#warningClassicType');
    typeSelect.innerHTML = `<option value="all">全部类型</option>${activeGroups.map((group) => `<option value="${esc(group.key)}">${esc(group.name)}（${group.alerts.length}）</option>`).join('')}`;
    typeSelect.value = state.type;
    const provinceOptions = '<option value="all">全部五省</option>' + PROVINCES.map((item) => `<option value="${esc(item.full)}">${esc(item.full === HKMO_PROVINCE ? '粤港澳' : item.short)}</option>`).join('');
    $('#warningClassicProvince').innerHTML = provinceOptions;
    $('#warningClassicProvince').value = state.province;
    $('#warningClassicProvinceRight').innerHTML = provinceOptions;
    $('#warningClassicProvinceRight').value = state.province;
    $('#warningClassicTime').value = state.time;
    document.querySelectorAll('#warningClassicColors [data-level]').forEach((button) => {
      const active = button.dataset.level === state.level;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    const cityInfo = provinceInfo();
    const availableCities = cityInfo
      ? cityFeatures.map((feature) => feature.properties.short)
      : PROVINCES.flatMap((province) => cityFeatures.filter((feature) => feature.properties.provinceAdcode === province.adcode).map((feature) => feature.properties.short));
    const withSar = Boolean(cityInfo && String(cityInfo.adcode) === '440000');
    const specialCities = withSar ? ['香港', '澳门'] : [];
    const cityPool = availableCities.concat(specialCities);
    if (state.city !== 'all' && !cityPool.includes(state.city)) state.city = 'all';
    const cityLabel = $('#warningClassicCity') && $('#warningClassicCity').closest('label');
    if (cityLabel && cityLabel.firstChild && cityLabel.firstChild.nodeType === 3) {
      cityLabel.firstChild.nodeValue = withSar ? '地级市/特别行政区' : '地级市';
    }
    let cityOptions = `<option value="all">${withSar ? '全部地级市/特别行政区' : '全部地级市'}</option>`;
    if (cityInfo) {
      const normal = availableCities.slice().sort((a, b) => a.localeCompare(b, 'zh'));
      if (normal.length) cityOptions += `<optgroup label="地级市">${normal.map((city) => `<option value="${esc(city)}">${esc(city)}</option>`).join('')}</optgroup>`;
      if (specialCities.length) cityOptions += `<optgroup label="特别行政区">${specialCities.map((city) => `<option value="${esc(city)}">${esc(city)}</option>`).join('')}</optgroup>`;
    } else {
      cityOptions += PROVINCES.map((province) => {
        const list = cityFeatures.filter((feature) => feature.properties.provinceAdcode === province.adcode).map((feature) => feature.properties.short).sort((a, b) => a.localeCompare(b, 'zh'));
        return list.length ? `<optgroup label="${esc(province.short)}">${list.map((city) => `<option value="${esc(city)}">${esc(city)}</option>`).join('')}</optgroup>` : '';
      }).join('');
    }
    $('#warningClassicCity').innerHTML = cityOptions;
    $('#warningClassicCity').value = state.city;

    const base = baseAlerts(alerts);
    const rows = base
      .filter((alert) => state.city === 'all' || cityKey(alert, cityFeatures) === state.city)
      .concat(hkmoVisible())
      .sort((a, b) => (b.ts - a.ts) || (b.levelRank - a.levelRank));
    $('#warningClassicCount').textContent = `${rows.length} 条`;
    $('#warningClassicUpdated').textContent = snap.updatedAt ? `更新 ${fmtDateTime(snap.updatedAt)}` : '连接中…';
    $('#warningClassicSource').textContent = `${snap.source || '中央气象台'} · 按城市最高等级着色 · 港澳信号不计入统计${snap.hkmo && snap.hkmo.mock ? ' · 港澳为模拟数据' : ''}`;
    const refresh = $('#warningClassicRefresh');
    refresh.disabled = Boolean(snap.loading);
    refresh.textContent = snap.loading ? '刷新中…' : '刷新';

    const size = window.innerWidth > 860 ? 8 : warningUtils.listPageSize();
    const pages = Math.max(1, Math.ceil(rows.length / size));
    state.page = warningUtils.clampPage(state.page, pages);
    const shown = rows.slice(state.page * size, state.page * size + size);
    if (snap.loading && !alerts.length) {
      listEl.innerHTML = '<div class="wcv-loading">正在读取全国预警…</div>';
    } else if (!rows.length) {
      listEl.innerHTML = '<div class="wcv-empty">当前筛选条件下暂无生效预警。<br>可调整省份、类型、时间或颜色，或点击右上角刷新。</div>';
    } else {
      listEl.innerHTML = shown.map((alert) => rowHtml(alert, cityFeatures)).join('');
    }
    pagerEl.innerHTML = rows.length
      ? warningUtils.pagerHtml({
        pages,
        page: state.page,
        kind: 'classic',
        label: '预警明细分页',
        light: true,
        info: `${state.page * size + 1}–${state.page * size + shown.length} / ${rows.length}`,
      })
      : '';
    const specialCity = state.city === '香港' || state.city === '澳门';
    renderMap(alerts, map);
    renderLegend(alerts, countyMode);
    renderAnalytics(specialCity ? base.filter((row) => !row.hkmo) : rows.filter((row) => !row.hkmo), cityFeatures);
  }

  function open() {
    if (state.open) return;
    state.open = true;
    try { localStorage.setItem('qxksh.warningView', 'classic'); } catch (e) { /* ignore */ }
    pageEl.setAttribute('aria-hidden', 'false');
    document.body.classList.add('warning-classic-open');
    render();
    if (window.WarningPage) {
      window.WarningPage.ensureData(false);
      window.WarningPage.loadHkMo(false);
    }
    setTimeout(resizeCharts, 80);
    setTimeout(resizeCharts, 260);
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    pageEl.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('warning-classic-open');
    if (window.WarningPage && window.WarningPage.closeSheet) window.WarningPage.closeSheet();
  }

  $('#warningClassicBack').addEventListener('click', () => { location.hash = '#/center'; });
  $('#warningClassicRefresh').addEventListener('click', () => {
    if (window.WarningPage) window.WarningPage.ensureData(true);
    render();
  });
  function setProvince(value) {
    provinceTouched = true;
    state.province = value;
    state.city = 'all';
    state.page = 0;
    render();
  }
  $('#warningClassicProvince').addEventListener('change', (event) => setProvince(event.target.value));
  $('#warningClassicProvinceRight').addEventListener('change', (event) => setProvince(event.target.value));
  $('#warningClassicType').addEventListener('change', (event) => {
    state.type = event.target.value;
    state.page = 0;
    render();
  });
  $('#warningClassicTime').addEventListener('change', (event) => {
    state.time = event.target.value;
    state.page = 0;
    render();
  });
  $('#warningClassicCity').addEventListener('change', (event) => {
    state.city = event.target.value;
    state.page = 0;
    render();
  });
  $('#warningClassicColors').addEventListener('click', (event) => {
    const button = event.target.closest('[data-level]');
    if (!button) return;
    state.level = button.dataset.level;
    state.page = 0;
    render();
  });
  pagerEl.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-page]');
    if (!button || button.disabled) return;
    const pages = Number(pagerEl.querySelector('.wx-pager') && pagerEl.querySelector('.wx-pager').dataset.pages) || 1;
    const raw = button.dataset.page;
    const target = raw === 'prev' ? state.page - 1 : raw === 'next' ? state.page + 1 : Number(raw);
    const page = warningUtils.clampPage(target, pages);
    if (page === state.page) return;
    state.page = page;
    render();
    const active = pagerEl.querySelector('button[aria-current="page"]');
    if (active) active.focus({ preventScroll: true });
  });
  listEl.addEventListener('click', (event) => {
    const row = event.target.closest('.wcv-row[data-warning-id]');
    if (!row || !window.WarningPage) return;
    const alert = warningState().alerts.find((item) => item.id === row.dataset.warningId);
    if (alert) window.WarningPage.openSheet(alert);
  });
  function resizeCharts() {
    if (chart) chart.resize();
    charts.forEach((instance) => instance.resize());
  }
  let layoutTimer = null;
  document.addEventListener('warnings:update', render);
  window.addEventListener('warning:hkmo', () => { if (state.open) render(); });
  window.addEventListener('resize', () => {
    if (!state.open) return;
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => {
      resizeCharts();
      render();
    }, 180);
  });

  function testCities() {
    const gd = PROVINCES.find((item) => item.full === HKMO_PROVINCE);
    const adcode = String(gd && gd.adcode ? gd.adcode : '440000');
    return MAP_DATA.cities.features
      .filter((feature) => String(feature.properties.provinceAdcode) === adcode)
      .map((feature) => feature.properties.short)
      .sort((a, b) => a.localeCompare(b, 'zh'));
  }

  function fillTestPanel() {
    const region = $('#wctRegion');
    const type = $('#wctType');
    if (!region || !type) return;
    region.innerHTML = [
      '<option value="hk">香港</option>',
      '<option value="mo">澳门</option>',
      `<optgroup label="广东地级市">${testCities().map((city) => `<option value="gd:${esc(city)}">${esc(city)}</option>`).join('')}</optgroup>`,
    ].join('');
    type.innerHTML = [
      `<optgroup label="14 类预警">${TEST_TYPES.map((def) => `<option value="type:${esc(def.key)}">${esc(def.name)}</option>`).join('')}</optgroup>`,
      `<optgroup label="香港信号">${HK_SIGNALS.map((sig) => `<option value="signal:${esc(sig.id)}">${esc(sig.name)}</option>`).join('')}</optgroup>`,
      `<optgroup label="澳门信号">${MO_SIGNALS.map((sig) => `<option value="signal:${esc(sig.id)}">${esc(sig.name)}</option>`).join('')}</optgroup>`,
    ].join('');
  }

  function testMsg(text, isError) {
    const el = $('#wctMsg');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('is-error', Boolean(isError));
  }

  function renderTestList() {
    const el = $('#wctList');
    if (!el) return;
    const rows = [
      ...testSignals.map((item) => ({
        id: item.id,
        label: `${HKMO_META[item.regionKey] ? HKMO_META[item.regionKey].short : item.regionKey} · ${item.name}`,
      })),
      ...testAlerts.map((item) => ({
        id: item.id,
        label: `${item.place.replace(/市$/, '')} · ${item.typeName}${item.levelLabel}预警`,
      })),
    ];
    el.innerHTML = rows.length
      ? rows.map((row) => `<span class="wct-chip">${esc(row.label)}<button type="button" data-wct-del="${esc(row.id)}" aria-label="移除">×</button></span>`).join('')
      : '<span class="wct-empty">还没有添加测试信号</span>';
  }

  function syncTests() {
    const api = window.WarningPage;
    if (!api) return;
    if (api.setTestAlerts) api.setTestAlerts(testAlerts);
    if (api.setTestSignals) api.setTestSignals(testSignals);
  }

  function addTestItem() {
    const region = $('#wctRegion');
    const type = $('#wctType');
    const level = $('#wctLevel');
    if (!region || !type) return;
    const regionValue = region.value;
    const typeValue = type.value;
    if (regionValue === 'hk' || regionValue === 'mo') {
      const pool = regionValue === 'hk' ? HK_SIGNALS : MO_SIGNALS;
      const sig = pool.find((item) => `signal:${item.id}` === typeValue);
      if (!sig) {
        testMsg(regionValue === 'hk' ? '香港请选择“香港信号”里的项目' : '澳门请选择“澳门信号”里的项目', true);
        return;
      }
      testSignals.push({
        id: `test-signal-${++testSeq}`,
        regionKey: regionValue,
        name: sig.name,
        rank: sig.rank,
        tone: sig.tone,
        icon: regionValue === 'hk' ? sig.icon : '',
        ts: Date.now(),
        clock: fmtTime(Date.now()).slice(-5),
      });
    } else {
      const city = regionValue.slice(3);
      const def = TEST_TYPES.find((item) => `type:${item.key}` === typeValue);
      if (!def) {
        testMsg('广东地级市请选择 14 类预警', true);
        return;
      }
      const levelKey = level ? level.value : 'yellow';
      const lv = TEST_LEVELS[levelKey] || {};
      testAlerts.push({
        id: `test-${++testSeq}`,
        title: `${city}发布${def.name}${lv.label || ''}预警`,
        place: `${city}市`,
        province: HKMO_PROVINCE,
        typeKey: def.key,
        typeName: def.name,
        tone: def.tone,
        icon: def.icon,
        scene: def.scene,
        levelKey,
        levelLabel: lv.label || '黄色',
        levelRank: Number(lv.rank) || 2,
        levelGrade: lv.grade || '',
        ts: Date.now(),
        source: 'test',
        url: '',
      });
    }
    if (state.province !== HKMO_PROVINCE) {
      provinceTouched = true;
      state.province = HKMO_PROVINCE;
      state.city = 'all';
    }
    testMsg('已添加');
    syncTests();
    renderTestList();
    render();
  }

  const RADAR_TOKEN_KEY = 'qxksh.radarToken';

  function readRadarToken() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(RADAR_TOKEN_KEY) || 'null');
      if (saved && typeof saved.token === 'string' && Number(saved.exp) > Date.now()) return saved.token;
    } catch (e) {
      /* ignore */
    }
    return '';
  }

  if (TEST_MODE) {
    const panel = $('#warningTestPanel');
    if (panel) {
      panel.hidden = false;
      const gate = $('#wctGate');
      const main = $('#wctMain');
      const gateMsg = (text, tone) => {
        const el = $('#wctGateMsg');
        if (!el) return;
        el.textContent = text || '';
        el.classList.toggle('is-ok', tone === 'ok');
      };
      const unlockUi = () => {
        if (gate) gate.hidden = true;
        if (main) main.hidden = false;
        fillTestPanel();
        renderTestList();
      };
      if (readRadarToken()) unlockUi();
      else if (gate) gate.hidden = false;

      const passEl = $('#wctPass');
      const unlockBtn = $('#wctUnlock');
      if (unlockBtn) {
        unlockBtn.addEventListener('click', async () => {
          const pass = passEl ? passEl.value.trim() : '';
          if (!pass) {
            gateMsg('请输入访问密码');
            return;
          }
          unlockBtn.disabled = true;
          gateMsg('正在验证…', 'ok');
          try {
            const res = await fetch('/api/radar/auth', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pass }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data && data.ok && data.token) {
              try {
                sessionStorage.setItem(RADAR_TOKEN_KEY, JSON.stringify({ token: data.token, exp: data.exp }));
              } catch (e) {
                /* ignore */
              }
              if (passEl) passEl.value = '';
              gateMsg('');
              unlockUi();
            } else {
              gateMsg(res.status === 401 ? '密码错误，请重新输入' : '验证服务不可用，请稍后再试');
            }
          } catch (e) {
            gateMsg('无法连接验证服务');
          } finally {
            unlockBtn.disabled = false;
          }
        });
      }

      const typeSel = $('#wctType');
      const levelSel = $('#wctLevel');
      if (typeSel) {
        typeSel.addEventListener('change', () => {
          if (levelSel) levelSel.disabled = typeSel.value.startsWith('signal:');
          testMsg('');
        });
      }
      const regionSel = $('#wctRegion');
      if (regionSel) regionSel.addEventListener('change', () => testMsg(''));
      const addBtn = $('#wctAdd');
      if (addBtn) addBtn.addEventListener('click', addTestItem);
      const clearBtn = $('#wctClear');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          testAlerts = [];
          testSignals = [];
          const snap = warningState();
          mockSignalsHidden = Boolean(snap.hkmo && snap.hkmo.mock);
          if (window.WarningPage && window.WarningPage.setMockHidden) window.WarningPage.setMockHidden(mockSignalsHidden);
          syncTests();
          renderTestList();
          testMsg('已清空');
          render();
        });
      }
      const listEl2 = $('#wctList');
      if (listEl2) {
        listEl2.addEventListener('click', (event) => {
          const btn = event.target.closest('[data-wct-del]');
          if (!btn) return;
          const id = btn.dataset.wctDel;
          testAlerts = testAlerts.filter((row) => row.id !== id);
          testSignals = testSignals.filter((row) => row.id !== id);
          syncTests();
          renderTestList();
          render();
        });
      }
    }
  }

  const downloadBtnEl = $('#warningClassicDownload');
  if (downloadBtnEl) downloadBtnEl.addEventListener('click', downloadWarningMap);
  setInterval(tickMapClock, 1000);

  window.WarningClassicPage = { open, close, render, state };
})();
