(function () {
  'use strict';

  const NMC_API = 'https://typhoon.nmc.cn/weatherservice/typhoon/jsons/';
  const ZJ_API = 'https://typhoon.slt.zj.gov.cn/Api/';
  const CURRENT_YEAR = new Date(Date.now() + 8 * 3600e3).getUTCFullYear();
  const $ = (selector) => document.querySelector(selector);
  const pageEl = $('#typhoonPage');
  const colors = ['#38bdf8', '#22c55e', '#eab308', '#f97316', '#ef4444', '#c026d3'];
  const agencyColors = { 中国: '#e23b46', 中国台湾: '#a855f7', 日本: '#2563eb', 美国: '#0f9f88', 中国香港: '#d97706', 韩国: '#64748b' };
  const sourceNames = { nmc: '中央气象台', zj: '浙江省水利厅' };
  const categoryNames = { TD: '热带低压', TS: '热带风暴', STS: '强热带风暴', TY: '台风', STY: '强台风', SuperTY: '超强台风', EX: '温带气旋', LO: '低压区' };
  const agencyNames = { BABJ: '中国', RJTD: '日本', KWBC: '美国', PGTW: '美国', VHHH: '中国香港', RCTP: '中国台湾', RKSL: '韩国' };
  const windLevelByCode = { '30KTS': 7, '50KTS': 10, '64KTS': 12 };
  const compass = { N: '北', NNE: '北东北', NE: '东北', ENE: '东东北', E: '东', ESE: '东东南', SE: '东南', SSE: '南东南', S: '南', SSW: '南西南', SW: '西南', WSW: '西西南', W: '西', WNW: '西北西', NW: '西北', NNW: '北西北' };
  const state = {
    open: false, local: true, project: null, year: CURRENT_YEAR, list: [], storm: null,
    points: [], selected: 0, agencies: new Set(), forecasts: [], listSeq: 0, detailSeq: 0,
    map: null, base: 'vec', layers: {}, track: null, forecastLayer: null, windLayer: null,
    marker: null, timer: null, playTimer: null, listMeta: null, detailMeta: null,
  };
  const cache = new Map();
  const snapshotPromises = { nmc: null, zj: null };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function number(value) {
    if (value == null || String(value).trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function positive(value) {
    const n = number(value);
    return n != null && n > 0 && n < 9999 ? n : null;
  }

  function timestamp(value) {
    const text = String(value || '').trim();
    if (!text) return NaN;
    return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(text) ? text : text.replace(' ', 'T') + '+08:00');
  }

  function nmcUtc(value) {
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(value || '').trim());
    return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])) : NaN;
  }

  function timeLabel(ts, year = false) {
    if (!Number.isFinite(ts)) return '—';
    const iso = new Date(ts + 8 * 3600e3).toISOString();
    return `${iso.slice(year ? 0 : 5, 10)} ${iso.slice(11, 16)}`;
  }

  function valueLabel(value, unit = '') {
    return value == null ? '—' : `${value}${unit}`;
  }

  function beaufort(speed) {
    if (speed == null) return null;
    const bounds = [0.3, 1.6, 3.4, 5.5, 8, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7, 37, 41.5, 46.2, 51, 56.1, 61.3];
    let level = 0;
    for (const bound of bounds) {
      if (speed < bound) break;
      level++;
    }
    return Math.min(level, 17);
  }

  function strengthColor(point) {
    const speed = point.speed;
    if (speed == null) return '#8ca3b4';
    return colors[speed >= 51 ? 5 : speed >= 41.5 ? 4 : speed >= 32.7 ? 3 : speed >= 24.5 ? 2 : speed >= 17.2 ? 1 : 0];
  }

  function categoryLabel(code, speed) {
    const key = String(code || '').trim();
    if (categoryNames[key]) return categoryNames[key];
    if (speed == null) return '强度未知';
    return speed >= 51 ? '超强台风' : speed >= 41.5 ? '强台风' : speed >= 32.7 ? '台风' : speed >= 24.5 ? '强热带风暴' : speed >= 17.2 ? '热带风暴' : '热带低压';
  }

  function directionLabel(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text === '0' || text === '少动' || /^calm$/i.test(text)) return '少动';
    return compass[text.toUpperCase()] || text;
  }

  function zjWind(raw) {
    const parse = (value) => {
      const radii = String(value || '').split('|').map(number);
      if (radii.length !== 4 || !radii.every((n) => n != null && n >= 0 && n <= 2000) || !radii.some((n) => n > 0)) return null;
      return [radii[0], radii[1], radii[3], radii[2]];
    };
    return { 7: parse(raw.radius7), 10: parse(raw.radius10), 12: parse(raw.radius12) };
  }

  function zjPoint(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const lon = number(raw.lng);
    const lat = number(raw.lat);
    const ts = timestamp(raw.time);
    if (lon == null || lat == null || Math.abs(lon) > 180 || Math.abs(lat) > 85 || !Number.isFinite(ts)) return null;
    const speed = positive(raw.speed);
    return {
      lon, lat, ts,
      strong: String(raw.strong || '强度未知'),
      power: positive(raw.power) || beaufort(speed),
      speed,
      pressure: positive(raw.pressure),
      moveSpeed: number(raw.movespeed),
      direction: directionLabel(raw.movedirection),
      wind: zjWind(raw),
      raw,
    };
  }

  function nmcPoint(row) {
    if (!Array.isArray(row) || row.length < 10) return null;
    const ts = Number(row[2]);
    const lon = number(row[4]);
    const lat = number(row[5]);
    if (!Number.isFinite(ts) || lon == null || lat == null || Math.abs(lon) > 180 || Math.abs(lat) > 85) return null;
    const speed = positive(row[7]);
    const wind = {};
    for (const circle of Array.isArray(row[10]) ? row[10] : []) {
      const level = windLevelByCode[String(circle && circle[0])];
      const radii = Array.isArray(circle) ? circle.slice(1, 5).map(number) : [];
      if (level && radii.length === 4 && radii.every((n) => n != null && n >= 0 && n <= 2000) && radii.some((n) => n > 0)) wind[level] = radii;
    }
    return {
      lon, lat, ts,
      strong: categoryLabel(row[3], speed),
      power: beaufort(speed),
      speed,
      pressure: positive(row[6]),
      moveSpeed: positive(row[9]),
      direction: directionLabel(row[8]),
      wind,
      raw: { forecasts: row[11], issueUtc: row[1], issueBeijing: row[12] && row[12][0] },
    };
  }

  function nmcDisplayId(code) {
    const text = String(code == null ? '' : code).trim();
    if (/^\d{4}$/.test(text)) return `20${text}`;
    if (/^\d{8}$/.test(text)) return text;
    return '';
  }

  function nmcList(rows) {
    const seen = new Set();
    const list = [];
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 8) continue;
      const nmcId = String(row[0]);
      if (!/^\d{1,10}$/.test(nmcId)) continue;
      const number = nmcDisplayId(row[3]);
      let id = number && !seen.has(number) ? number : `nmc-${nmcId}`;
      if (seen.has(id)) id = `nmc-${nmcId}-${list.length}`;
      seen.add(id);
      const enname = String(row[1] || '').trim();
      const name = String(row[2] || '').trim() || (enname.toLowerCase() === 'nameless' ? '未命名台风' : enname || '未命名台风');
      list.push({
        id, nmcId, number, name,
        enname: enname.toLowerCase() === 'nameless' ? '' : enname,
        active: row[7] === 'start',
        start: 0, end: 0, source: 'nmc',
        zjId: /^(?:\d{6}|\d{8})$/.test(number) ? number : '',
      });
    }
    return list.sort((a, b) => Number(b.active) - Number(a.active) || Number(b.number || b.nmcId) - Number(a.number || a.nmcId));
  }

  function zjList(data) {
    return data.filter((item) => item && /^(?:\d{6}|\d{8})$/.test(String(item.tfid))).map((item) => ({
      id: String(item.tfid), nmcId: '', number: String(item.tfid), name: String(item.name || '未命名台风').trim(), enname: String(item.enname || '').trim(),
      active: String(item.isactive) === '1', start: timestamp(item.starttime), end: timestamp(item.endtime), source: 'zj', zjId: String(item.tfid),
    })).sort((a, b) => Number(b.active) - Number(a.active) || (b.start || 0) - (a.start || 0));
  }

  function nmcForecasts(point) {
    const groups = point.raw.forecasts;
    if (!groups || typeof groups !== 'object') return [];
    const result = [];
    for (const [agency, rows] of Object.entries(groups)) {
      if (!Array.isArray(rows)) continue;
      const points = rows.map((row) => {
        if (!Array.isArray(row) || row.length < 8) return null;
        const offset = number(row[0]);
        const base = nmcUtc(row[1]);
        const ts = base + offset * 3600e3;
        const lon = number(row[2]);
        const lat = number(row[3]);
        if (offset == null || !Number.isFinite(base) || lon == null || lat == null || Math.abs(lon) > 180 || Math.abs(lat) > 85) return null;
        const speed = positive(row[5]);
        return {
          lon, lat, ts, strong: categoryLabel(row[7], speed), power: beaufort(speed),
          speed, pressure: positive(row[4]), moveSpeed: null, direction: '', wind: {}, raw: {},
        };
      }).filter((item) => item && item.ts > point.ts).sort((a, b) => a.ts - b.ts);
      if (points.length) result.push({ name: agencyNames[agency] || agency, source: 'nmc', points });
    }
    return result;
  }

  function zjForecasts(point) {
    const rows = Array.isArray(point.raw.forecast) ? point.raw.forecast : [];
    return rows.filter((item) => item && Array.isArray(item.forecastpoints)).map((item) => ({
      name: String(item.tm || '未标注机构'), source: 'zj',
      points: item.forecastpoints.map(zjPoint).filter(Boolean).sort((a, b) => a.ts - b.ts),
    })).filter((item) => item.points.some((p) => p.ts > point.ts));
  }

  function mergeForecasts(...groups) {
    const merged = new Map();
    for (const group of groups) for (const forecast of group) if (!merged.has(forecast.name)) merged.set(forecast.name, forecast);
    return [...merged.values()].sort((a, b) => (a.name === '中国' ? -1 : b.name === '中国' ? 1 : 0) || a.name.localeCompare(b.name, 'zh'));
  }

  function validNmc(kind, data, id) {
    if (!data || typeof data !== 'object') return false;
    if (kind === 'list') return Array.isArray(data.typhoonList);
    return Array.isArray(data.typhoon) && String(data.typhoon[0]) === String(id) && Array.isArray(data.typhoon[8]);
  }

  function validZj(kind, data, id) {
    return kind === 'list' ? Array.isArray(data) : data && String(data.tfid) === String(id) && Array.isArray(data.points);
  }

  function parseJsonp(text) {
    const start = text.indexOf('(');
    const end = text.lastIndexOf(')');
    if (start < 0 || end <= start) throw new Error('中央气象台响应不是有效 JSONP');
    return JSON.parse(text.slice(start + 1, end));
  }

  async function requestJson(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(18000), cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function requestText(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(18000), cache: 'no-store', referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  function loadSnapshot(source) {
    if (!snapshotPromises[source]) {
      const file = source === 'nmc' ? 'data/typhoons-nmc.json' : 'data/typhoons.json';
      snapshotPromises[source] = requestJson(file).catch((error) => { snapshotPromises[source] = null; throw error; });
    }
    return snapshotPromises[source];
  }

  async function nmcResource(kind, id) {
    const key = `nmc/${kind}/${id}`;
    try {
      let data;
      let fetchedAt;
      let stale = false;
      if (state.local) {
        const payload = await requestJson(`api/typhoon/nmc/${kind}/${id}`);
        data = payload.data;
        fetchedAt = timestamp(payload.fetchedAt);
        stale = Boolean(payload.stale);
      } else {
        data = parseJsonp(await requestText(`${NMC_API}${kind === 'list' ? `list_${id}` : `view_${id}`}`));
        fetchedAt = Date.now();
      }
      if (!validNmc(kind, data, id)) throw new Error('中央气象台数据格式异常');
      const result = { data, fetchedAt, mode: stale ? 'cache' : 'live', source: 'nmc' };
      cache.set(key, result);
      return result;
    } catch (error) {
      if (cache.has(key)) return { ...cache.get(key), mode: 'cache' };
      const snapshot = await loadSnapshot('nmc').catch(() => null);
      const data = snapshot && (kind === 'list' ? (String(snapshot.year) === String(id) ? snapshot.list : null) : snapshot.storms && snapshot.storms[id]);
      if (!validNmc(kind, data, id)) throw error;
      return { data, fetchedAt: timestamp(snapshot.fetchedAt), mode: 'snapshot', source: 'nmc' };
    }
  }

  async function zjResource(kind, id) {
    const key = `zj/${kind}/${id}`;
    try {
      let data;
      let fetchedAt;
      let stale = false;
      if (state.local) {
        const payload = await requestJson(`api/typhoon/${kind}/${id}`);
        data = payload.data;
        fetchedAt = timestamp(payload.fetchedAt);
        stale = Boolean(payload.stale);
      } else {
        data = await requestJson(`${ZJ_API}${kind === 'list' ? 'TyphoonList' : 'TyphoonInfo'}/${id}`);
        fetchedAt = Date.now();
      }
      if (!validZj(kind, data, id)) throw new Error('浙江省水利厅数据格式异常');
      const result = { data, fetchedAt, mode: stale ? 'cache' : 'live', source: 'zj' };
      cache.set(key, result);
      return result;
    } catch (error) {
      if (cache.has(key)) return { ...cache.get(key), mode: 'cache' };
      const snapshot = await loadSnapshot('zj').catch(() => null);
      const data = snapshot && (kind === 'list' ? (String(snapshot.year) === String(id) ? snapshot.list : null) : snapshot.storms && snapshot.storms[id]);
      if (!validZj(kind, data, id)) throw error;
      return { data, fetchedAt: timestamp(snapshot.fetchedAt), mode: 'snapshot', source: 'zj' };
    }
  }

  function setMessage(text) {
    const el = $('#tpMapMessage');
    el.textContent = text;
    el.hidden = !text;
  }

  function updateSource() {
    const meta = state.detailMeta || state.listMeta;
    const el = $('#tpUpdated');
    if (!meta) { el.textContent = '尚未取得数据'; el.className = 'is-stale'; return; }
    const old = !Number.isFinite(meta.fetchedAt) || Date.now() - meta.fetchedAt > 15 * 60e3;
    const mode = meta.mode === 'snapshot' ? '离线快照' : meta.mode === 'cache' ? '缓存数据' : old ? '较早数据' : '实时同步';
    el.textContent = `${sourceNames[meta.source] || '数据'} · ${mode} · ${timeLabel(meta.fetchedAt, true)}`;
    el.className = meta.mode !== 'live' || old ? 'is-stale' : '';
  }

  function coordinate(point) {
    const [lon, lat] = state.project(point.lon, point.lat);
    return [lat, lon];
  }

  function initMap() {
    if (state.map) return;
    const map = L.map('typhoonMap', { zoomControl: false, minZoom: 3, maxZoom: 12, preferCanvas: true, worldCopyJump: false });
    L.control.zoom({ position: 'topright' }).addTo(map);
    map.attributionControl.setPrefix(false);
    const options = { minZoom: 3, maxZoom: 12, noWrap: true, keepBuffer: 2, attribution: '底图 © 高德地图' };
    const tiles = (kind) => {
      const remote = kind === 'vec'
        ? 'https://wprd0{s}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=1&style=7'
        : `https://webst0{s}.is.autonavi.com/appmaptile?style=${kind === 'sat' ? 6 : 8}&x={x}&y={y}&z={z}`;
      const layer = L.tileLayer(state.local ? `tiles/${kind}/{z}/{x}/{y}.${kind === 'sat' ? 'jpg' : 'png'}` : remote, { ...options, subdomains: '1234' });
      layer.on('tileerror', () => { $('#tpTileNote').hidden = false; });
      layer.on('tileload', () => { $('#tpTileNote').hidden = true; });
      return layer;
    };
    state.layers.vec = tiles('vec');
    state.layers.sat = L.layerGroup([tiles('sat'), tiles('label')]);
    state.layers.vec.addTo(map);
    state.track = L.layerGroup().addTo(map);
    state.forecastLayer = L.layerGroup().addTo(map);
    state.windLayer = L.layerGroup().addTo(map);
    state.map = map;
    map.setView([23, 132], 4);
  }

  function stopPlay() {
    clearInterval(state.playTimer);
    state.playTimer = null;
    $('#tpPlay').textContent = '播放';
    $('#tpPlay').setAttribute('aria-label', '播放历史路径');
  }

  function clearStorm() {
    stopPlay();
    hideHover();
    state.storm = null;
    state.points = [];
    state.forecasts = [];
    state.detailMeta = null;
    state.track.clearLayers();
    state.forecastLayer.clearLayers();
    state.windLayer.clearLayers();
    if (state.marker) state.marker.remove();
    state.marker = null;
    $('#tpStormOverview').innerHTML = '<p class="tp-muted">选择台风后查看实况与预报。</p>';
    $('#tpPointInfo').innerHTML = '<p class="tp-muted">暂无实况点数据。</p>';
    $('#tpPointHeading').textContent = '最新实况';
    $('#tpPointTime').textContent = '—';
    $('#tpForecastOptions').innerHTML = '<span class="tp-muted">暂无预报</span>';
    $('#tpForecastNote').textContent = '预报路径可能调整，不代表确定的影响区域。';
    $('#tpTimelineTime').textContent = '实况时间轴';
    $('#tpPointCount').textContent = '0 / 0';
    $('#tpTimeline').value = '0';
    $('#tpTimeline').max = '0';
    for (const id of ['tpTimeline', 'tpPlay', 'tpLatest']) $('#' + id).disabled = true;
  }

  function fitTrack() {
    if (!state.points.length) { state.map.setView([23, 132], 4); return; }
    const coords = state.points.map(coordinate);
    state.forecasts.filter((f) => state.agencies.has(f.name)).forEach((f) => f.points.forEach((p) => coords.push(coordinate(p))));
    const mobile = innerWidth <= 760;
    state.map.fitBounds(L.latLngBounds(coords), { paddingTopLeft: [35, 72], paddingBottomRight: [35, mobile ? 100 : 78], maxZoom: 7, animate: false });
  }

  function popup(point, title) {
    return `<div class="tp-popup"><b>${esc(title)}</b><time>${esc(timeLabel(point.ts, true))} 北京时</time><strong style="color:${strengthColor(point)}">${esc(point.strong)}</strong><span>风速 ${valueLabel(point.speed, ' m/s')} · 气压 ${valueLabel(point.pressure, ' hPa')}</span><span>${point.lat.toFixed(1)}°N · ${point.lon.toFixed(1)}°E</span></div>`;
  }

  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  let hoverPopup = null;

  function showHover(point, title) {
    if (!canHover) return;
    if (!hoverPopup) {
      hoverPopup = L.popup({ className: 'tp-hover-popup', closeButton: false, autoPan: false, offset: [0, -10], interactive: false });
    }
    hoverPopup.setLatLng(coordinate(point)).setContent(popup(point, title)).openOn(state.map);
  }

  function hideHover() {
    if (!canHover || !hoverPopup || !state.map || !state.map.hasLayer(hoverPopup)) return;
    state.map.closePopup(hoverPopup);
  }

  function bindPointHover(layer, point, title, baseRadius, hoverRadius) {
    if (!canHover) return;
    layer.on('mouseover', () => {
      layer.setRadius(hoverRadius);
      showHover(point, title);
    }).on('mouseout', () => {
      layer.setRadius(baseRadius);
      hideHover();
    });
  }

  function drawTrack() {
    state.track.clearLayers();
    state.points.forEach((point, i) => {
      if (i) L.polyline([coordinate(state.points[i - 1]), coordinate(point)], { color: strengthColor(point), weight: 3, opacity: .95, interactive: false }).addTo(state.track);
      const dot = L.circleMarker(coordinate(point), { radius: 4, color: '#fff', weight: 1, fillColor: strengthColor(point), fillOpacity: 1 })
        .bindPopup(popup(point, '实况路径点'))
        .on('click', () => { stopPlay(); selectPoint(i); })
        .addTo(state.track);
      bindPointHover(dot, point, '实况路径点', 4, 6.5);
    });
  }

  function renderForecastOptions() {
    if (!state.agencies.size && state.forecasts.length) {
      state.agencies.add(state.forecasts.some((f) => f.name === '中国') ? '中国' : state.forecasts[0].name);
    }
    $('#tpForecastOptions').innerHTML = state.forecasts.length
      ? state.forecasts.map((f, i) => `<label style="--agency:${agencyColors[f.name] || '#64748b'}"><input type="checkbox" data-tp-agency="${i}"${state.agencies.has(f.name) ? ' checked' : ''} /><i></i>${esc(f.name)}</label>`).join('')
      : '<span class="tp-muted">该台风最新记录暂无预报路径。</span>';
    const others = state.forecasts.map((f) => f.name).filter((name) => name !== '中国');
    let note;
    if (!state.forecasts.length) note = '历史归档或停编记录可能没有后续预报，实况路径仍可查询。';
    else if (state.storm && state.storm.source === 'nmc') {
      note = others.length
        ? `中国预报来自中央气象台（BABJ），${others.join('、')}预报来自浙江省水利厅；各机构发布时间与强度标准可能不同。`
        : '预报来自中央气象台（BABJ），可能随最新实况调整，不代表确定的影响范围。';
    } else {
      note = '预报来自浙江省水利厅汇总的多机构数据，发布时间与强度标准可能不同，不代表确定的影响区域。';
    }
    $('#tpForecastNote').textContent = note;
  }

  function drawForecasts() {
    state.forecastLayer.clearLayers();
    const latest = state.points.at(-1);
    if (!latest) return;
    for (const forecast of state.forecasts) {
      if (!state.agencies.has(forecast.name)) continue;
      const color = agencyColors[forecast.name] || '#64748b';
      const line = [coordinate(latest), ...forecast.points.map(coordinate)];
      L.polyline(line, { color, weight: 2.5, dashArray: '7 7', opacity: .9, interactive: false }).addTo(state.forecastLayer);
      for (const point of forecast.points.filter((p) => p.ts > latest.ts)) {
        const dot = L.circleMarker(coordinate(point), { radius: 5, color, weight: 2, fillColor: '#fff', fillOpacity: .95 })
          .bindPopup(popup(point, `${forecast.name}预报 · 非实况`)).addTo(state.forecastLayer);
        bindPointHover(dot, point, `${forecast.name}预报 · 非实况`, 5, 7);
      }
    }
  }

  function destination(point, km, bearing) {
    const rad = Math.PI / 180;
    const distance = km / 6371;
    const lat = point.lat * rad;
    const lon = point.lon * rad;
    const angle = bearing * rad;
    const lat2 = Math.asin(Math.sin(lat) * Math.cos(distance) + Math.cos(lat) * Math.sin(distance) * Math.cos(angle));
    const lon2 = lon + Math.atan2(Math.sin(angle) * Math.sin(distance) * Math.cos(lat), Math.cos(distance) - Math.sin(lat) * Math.sin(lat2));
    return coordinate({ lat: lat2 / rad, lon: ((lon2 / rad + 540) % 360) - 180 });
  }

  function drawWind(point) {
    state.windLayer.clearLayers();
    if (!$('#tpWindToggle').checked) return;
    for (const [level, color] of [[7, '#19a4b4'], [10, '#f59e0b'], [12, '#ef4444']]) {
      const radii = point.wind[level];
      if (!radii) continue;
      const polygon = [];
      radii.forEach((radius, quadrant) => {
        for (let angle = quadrant * 90; angle <= quadrant * 90 + 90; angle += 5) polygon.push(destination(point, radius, angle));
      });
      L.polygon(polygon, { color, weight: 1, opacity: .7, fillOpacity: .09, interactive: false }).addTo(state.windLayer);
    }
  }

  function renderOverview() {
    const storm = state.storm;
    const latest = state.points.at(-1);
    const active = storm.active;
    const outdated = active && Date.now() - latest.ts > 18 * 3600e3;
    const status = !active ? '历史归档' : outdated ? '活跃记录 · 时间待核实' : state.detailMeta.mode !== 'live' ? '活跃记录 · 数据非实时' : '活跃中';
    const position = latest.raw.ckposition || `中心位于 ${latest.lat.toFixed(1)}°N、${latest.lon.toFixed(1)}°E`;
    const movement = latest.raw.jl || (latest.moveSpeed
      ? latest.direction === '少动' ? '移动缓慢' : `以 ${latest.moveSpeed} 公里/小时向${latest.direction || '未知方向'}移动`
      : '');
    $('#tpStormOverview').innerHTML = `<div class="tp-storm-kicker"><span>${esc(storm.number || '编号未提供')} · 台风编号</span><b class="${active && !outdated ? 'is-active' : ''}">${status}</b></div><h2>${esc(storm.name || '未命名台风')}</h2><p class="tp-enname">${esc(storm.enname || '')}</p><div class="tp-storm-status" style="--storm:${strengthColor(latest)}"><i></i><strong>${esc(latest.strong)}</strong><span>截至 ${timeLabel(latest.ts)}</span></div>${outdated ? '<p class="tp-stale-warning">最新实况已超过 18 小时，请核对官方更新，勿视为当前位置。</p>' : ''}<p class="tp-position">${esc(position)}</p>${movement ? `<p class="tp-movement">${esc(movement)}</p>` : ''}<p class="tp-obs-source">实况路径：${sourceNames[storm.source] || '—'}</p>`;
  }

  function selectPoint(index) {
    const point = state.points[index];
    if (!point) return;
    state.selected = index;
    const latest = index === state.points.length - 1;
    $('#tpPointHeading').textContent = latest ? '最新实况' : '历史实况';
    $('#tpPointTime').textContent = timeLabel(point.ts);
    const windInfo = [7, 10, 12].map((level) => {
      const radii = point.wind[level];
      return radii ? `<span>${level}级 <b>${Math.min(...radii)}–${Math.max(...radii)} km</b></span>` : '';
    }).join('');
    $('#tpPointInfo').innerHTML = `<div class="tp-metrics"><div><span>最大风速</span><b>${valueLabel(point.speed)}<small>m/s</small></b></div><div><span>中心气压</span><b>${valueLabel(point.pressure)}<small>hPa</small></b></div><div><span>最大风力</span><b>${valueLabel(point.power)}<small>级</small></b></div><div><span>移动速度</span><b>${valueLabel(point.moveSpeed)}<small>km/h</small></b></div></div><p class="tp-coordinates">${point.lat.toFixed(1)}°N · ${point.lon.toFixed(1)}°E <span>${esc(point.direction || '方向未提供')}</span></p><div class="tp-wind-values">${windInfo || '<span>该时刻未提供风圈半径</span>'}</div><p class="tp-layer-note">风圈值为四象限半径范围，非降雨或灾害影响范围。</p>`;
    $('#tpTimeline').value = String(index);
    $('#tpTimeline').setAttribute('aria-valuetext', `${timeLabel(point.ts, true)}，${point.strong}`);
    $('#tpTimelineTime').textContent = `${latest ? '最新实况' : '历史实况'} · ${timeLabel(point.ts)}`;
    $('#tpPointCount').textContent = `${index + 1} / ${state.points.length}`;
    if (state.marker) state.marker.remove();
    state.marker = L.marker(coordinate(point), {
      zIndexOffset: 600,
      icon: L.divIcon({ className: 'tp-eye-marker', html: `<span style="--storm:${strengthColor(point)}"><i></i></span>`, iconSize: [44, 44], iconAnchor: [22, 22] }),
      title: `${state.storm.name} ${timeLabel(point.ts)}`,
    }).bindPopup(popup(point, latest ? '最新实况点' : '所选历史点'))
      .on('mouseover', () => showHover(point, latest ? '最新实况点' : '所选历史点'))
      .on('mouseout', hideHover)
      .addTo(state.map);
    drawWind(point);
  }

  function nmcDetail(data, entry) {
    const storm = data.typhoon;
    const points = storm[8].map(nmcPoint).filter(Boolean).sort((a, b) => a.ts - b.ts);
    if (!points.length) throw new Error('该记录暂无有效路径点');
    return {
      id: entry.id, nmcId: String(storm[0]), number: nmcDisplayId(storm[3]) || entry.number || '',
      name: String(storm[2] || entry.name || '未命名台风').trim(), enname: String(storm[1] || entry.enname || '').trim(),
      active: storm[7] === 'start', start: points[0].ts, end: points.at(-1).ts, points, source: 'nmc',
    };
  }

  function zjDetail(data, entry) {
    const points = data.points.map(zjPoint).filter(Boolean).sort((a, b) => a.ts - b.ts);
    if (!points.length) throw new Error('该记录暂无有效路径点');
    return {
      id: entry.id, nmcId: entry.nmcId || '', number: String(data.tfid || entry.number || ''),
      name: String(data.name || entry.name || '未命名台风').trim(), enname: String(data.enname || entry.enname || '').trim(),
      active: String(data.isactive) === '1', start: timestamp(data.starttime), end: timestamp(data.endtime), points, source: 'zj',
    };
  }

  async function fetchDetail(entry) {
    if (entry.nmcId) {
      try {
        const meta = await nmcResource('detail', entry.nmcId);
        return { storm: nmcDetail(meta.data, entry), meta };
      } catch (error) {
        /* Fall back to the Zhejiang track below. */
      }
    }
    const zjId = entry.zjId || entry.id;
    if (!/^(?:\d{6}|\d{8})$/.test(zjId)) throw new Error('没有可用的台风详情编号');
    const meta = await zjResource('detail', zjId);
    return { storm: zjDetail(meta.data, entry), meta };
  }

  async function augmentForecasts(entry, seq) {
    if (entry.source !== 'nmc' || !entry.zjId) return;
    const meta = await zjResource('detail', entry.zjId).catch(() => null);
    if (!meta || seq !== state.detailSeq || !state.open || !state.storm || state.storm.source !== 'nmc' || state.storm.id !== entry.id) return;
    const extra = zjForecasts(zjDetail(meta.data, entry).points.at(-1));
    if (!extra.length) return;
    const merged = mergeForecasts(state.forecasts, extra);
    if (merged.length === state.forecasts.length) return;
    state.forecasts = merged;
    renderForecastOptions();
    drawForecasts();
  }

  async function loadStorm(id) {
    const seq = ++state.detailSeq;
    clearStorm();
    updateSource();
    setMessage('正在读取台风路径…');
    try {
      const entry = state.list.find((item) => item.id === id);
      if (!entry) throw new Error('台风记录已更新');
      const detail = await fetchDetail(entry);
      if (seq !== state.detailSeq || !state.open) return;
      state.storm = detail.storm;
      state.points = detail.storm.points;
      state.detailMeta = detail.meta;
      $('#tpTimeline').max = String(state.points.length - 1);
      $('#tpTimeline').disabled = false;
      $('#tpPlay').disabled = state.points.length < 2;
      $('#tpLatest').disabled = false;
      const latest = state.points.at(-1);
      state.forecasts = detail.storm.source === 'nmc' ? nmcForecasts(latest) : zjForecasts(latest);
      state.agencies = new Set();
      renderOverview();
      drawTrack();
      renderForecastOptions();
      drawForecasts();
      selectPoint(state.points.length - 1);
      fitTrack();
      updateSource();
      setMessage('');
      if (detail.storm.source === 'nmc') augmentForecasts(entry, seq);
    } catch (error) {
      if (seq !== state.detailSeq || !state.open) return;
      setMessage('该台风路径暂不可用，请切换台风或点击“刷新数据”。');
      $('#tpStormOverview').innerHTML = '<p class="tp-stale-warning">中央气象台与浙江省水利厅均未取得有效路径。离线快照只保存部分近期台风，其余历史记录需联网读取。</p>';
    }
  }

  async function resolveList(year) {
    try {
      const meta = await nmcResource('list', String(year));
      return { storms: nmcList(meta.data.typhoonList), meta };
    } catch (error) {
      /* Use the Zhejiang list when the central feed is unavailable. */
    }
    const meta = await zjResource('list', String(year));
    return { storms: zjList(meta.data), meta };
  }

  async function loadList() {
    const seq = ++state.listSeq;
    ++state.detailSeq;
    const previous = $('#tpStorm').value;
    clearStorm();
    state.list = [];
    state.listMeta = null;
    $('#tpStorm').disabled = true;
    $('#tpStorm').innerHTML = '<option>读取中…</option>';
    $('#typhoonRefresh').disabled = true;
    $('#tpListMeta').textContent = '正在连接中央气象台…';
    setMessage('正在读取台风数据…');
    updateSource();
    try {
      const result = await resolveList(state.year);
      if (seq !== state.listSeq || !state.open) return;
      state.list = result.storms;
      state.listMeta = result.meta;
      const active = state.list.filter((s) => s.active).length;
      const archived = state.year === CURRENT_YEAR ? '暂无活跃记录，可查看历史台风' : '历史年度档案';
      $('#tpListMeta').textContent = `${sourceNames[result.meta.source]} · ${state.year} 年共 ${state.list.length} 个记录 · ${active ? `${active} 个活跃记录` : archived}${result.meta.mode === 'snapshot' ? '（离线快照）' : ''}`;
      updateSource();
      if (!state.list.length) {
        $('#tpStorm').innerHTML = '<option>暂无台风记录</option>';
        setMessage(`${state.year} 年暂无台风记录`);
        fitTrack();
        return;
      }
      $('#tpStorm').innerHTML = state.list.map((storm) => `<option value="${storm.id}">${esc(storm.name)} · ${esc(storm.number || '未编号')}${storm.active ? ' · 活跃记录' : ''}</option>`).join('');
      $('#tpStorm').disabled = false;
      const id = state.list.some((s) => s.id === previous) ? previous : state.list[0].id;
      $('#tpStorm').value = id;
      await loadStorm(id);
    } catch (error) {
      if (seq !== state.listSeq || !state.open) return;
      $('#tpStorm').innerHTML = '<option>列表读取失败</option>';
      $('#tpListMeta').textContent = '中央气象台、浙江省水利厅与离线快照均不可用，请检查网络后重试。';
      setMessage('台风列表读取失败，点击右上角“刷新数据”重试。');
    } finally {
      if (seq === state.listSeq) $('#typhoonRefresh').disabled = false;
    }
  }

  function open(options) {
    if (state.open) return;
    state.open = true;
    state.local = options.local;
    state.project = options.project;
    pageEl.setAttribute('aria-hidden', 'false');
    document.body.classList.add('typhoon-open');
    initMap();
    requestAnimationFrame(() => state.map.invalidateSize());
    loadList();
    state.timer = setInterval(() => { if (state.open && !document.hidden && !$('#typhoonRefresh').disabled) loadList(); }, 5 * 60e3);
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    ++state.listSeq;
    ++state.detailSeq;
    clearInterval(state.timer);
    state.timer = null;
    stopPlay();
    state.map.closePopup();
    pageEl.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('typhoon-open');
  }

  $('#tpYear').innerHTML = Array.from({ length: CURRENT_YEAR - 1949 + 1 }, (_, i) => `<option value="${CURRENT_YEAR - i}">${CURRENT_YEAR - i} 年</option>`).join('');
  $('#typhoonBack').addEventListener('click', () => { location.hash = '#/center'; });
  $('#typhoonRefresh').addEventListener('click', loadList);
  $('#tpYear').addEventListener('change', () => { state.year = Number($('#tpYear').value); loadList(); });
  $('#tpStorm').addEventListener('change', () => loadStorm($('#tpStorm').value));
  $('#tpFit').addEventListener('click', fitTrack);
  $('#tpLatest').addEventListener('click', () => { stopPlay(); selectPoint(state.points.length - 1); state.map.panTo(coordinate(state.points.at(-1))); });
  $('#tpTimeline').addEventListener('input', () => { stopPlay(); selectPoint(Number($('#tpTimeline').value)); });
  $('#tpWindToggle').addEventListener('change', () => { if (state.points.length) drawWind(state.points[state.selected]); });
  $('#tpForecastOptions').addEventListener('change', (event) => {
    const input = event.target.closest('[data-tp-agency]');
    if (!input) return;
    const forecast = state.forecasts[Number(input.dataset.tpAgency)];
    if (input.checked) state.agencies.add(forecast.name); else state.agencies.delete(forecast.name);
    drawForecasts();
  });
  pageEl.querySelectorAll('[data-tp-base]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.tpBase === state.base) return;
    state.map.removeLayer(state.layers[state.base]);
    state.base = button.dataset.tpBase;
    state.layers[state.base].addTo(state.map);
    pageEl.querySelectorAll('[data-tp-base]').forEach((b) => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
  }));
  $('#tpPlay').addEventListener('click', () => {
    if (state.playTimer) { stopPlay(); return; }
    if (state.selected >= state.points.length - 1) selectPoint(0);
    $('#tpPlay').textContent = '暂停';
    $('#tpPlay').setAttribute('aria-label', '暂停历史路径');
    state.playTimer = setInterval(() => {
      if (state.selected >= state.points.length - 1) { stopPlay(); return; }
      selectPoint(state.selected + 1);
    }, 700);
  });
  new ResizeObserver(() => { if (state.open && state.map) state.map.invalidateSize(); }).observe($('#typhoonMap'));
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopPlay(); });
  window.TyphoonPage = { open, close, state };
})();
